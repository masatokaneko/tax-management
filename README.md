# freee法人税申告 MCP サーバー

freee会計データを用いた法人税務申告自動化のためのMCPサーバー。Claude DesktopやClaude Codeをインターフェースとして、税務調整 → 別表計算 → 整合性チェック → 電子申告ファイル出力までを一貫して実行します。

## 特徴

- **全主要別表に対応** — 別表一・二・四・五(一)(二)・六・七・八・十四・十五・十六
- **消費税** — 一般課税（原則課税）・簡易課税
- **地方税** — 法人住民税・法人事業税・特別法人事業税
- **電子申告ファイル出力** — e-Tax XML / eLTAX XML / 財務諸表XBRL
- **整合性チェック** — 別表間の自動検算（別表四⇔五(一)等）
- **AI税務調整推定** — Claudeが仕訳データから税務調整項目を推定、ユーザー確認後に確定

## 必要環境

- Node.js 22以上（`node:sqlite` を使用）
- Claude Desktop または Claude Code
- [freee MCP](https://github.com/freee/freee-mcp) — freee会計APIへのアクセスに必要

## セットアップ

### 1. freee MCPのセットアップ

本サーバーはfreee会計データの取得に [freee MCP](https://github.com/freee/freee-mcp) を使用します。先にfreee MCPをセットアップしてください。

```bash
npx freee-mcp configure
```

freee開発者ページでアプリ登録が必要です。詳細は [freee MCPのREADME](https://github.com/freee/freee-mcp) を参照してください。

### 2. 本サーバーのビルド

```bash
git clone https://github.com/masatokaneko/tax-management.git
cd tax-management
npm install
npm run build
```

### 3. MCPサーバーの設定

freee MCPと本サーバーの**両方**を設定します。Claudeが2つのMCPサーバーを橋渡しして動作します。

#### Claude Desktop

`~/Library/Application Support/Claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "freee": {
      "command": "npx",
      "args": ["freee-mcp"]
    },
    "tax-filing": {
      "command": "node",
      "args": ["<プロジェクトの絶対パス>/dist/index.js"],
      "cwd": "<プロジェクトの絶対パス>"
    }
  }
}
```

設定後、Claude Desktopを再起動してください。

#### Claude Code

`~/.mcp.json`:

```json
{
  "mcpServers": {
    "freee": {
      "command": "npx",
      "args": ["freee-mcp"]
    },
    "tax-filing": {
      "command": "node",
      "args": ["<プロジェクトの絶対パス>/dist/index.js"],
      "cwd": "<プロジェクトの絶対パス>"
    }
  }
}
```

## 仕組み — 2つのMCPサーバー連携

本サーバー単体では freee APIにアクセスしません。Claudeが **freee MCP** と **本サーバー (tax-filing)** の2つを仲介するブリッジパターンで動作します。

```
┌──────────────────────────────────────────────────────┐
│                    Claude (AI)                        │
│                                                      │
│   ① freee MCPで会計データを取得                        │
│   ② 取得データをtax-filingのfetch-freee-dataでキャッシュ │
│   ③ tax-filingの計算ツールを実行                       │
└──────┬───────────────────────┬────────────────────────┘
       │                       │
       ▼                       ▼
┌──────────────┐      ┌───────────────────┐
│  freee MCP   │      │  tax-filing MCP   │
│  (freee公式)  │      │  (本サーバー)      │
│              │      │                   │
│ freee API    │      │ 別表計算           │
│ OAuth認証    │      │ 消費税計算          │
│ 取引/仕訳取得 │      │ 地方税計算          │
│              │      │ 電子申告出力        │
└──────────────┘      └───────────────────┘
```

freee MCPなしでも、手動で数値を入力して別表計算や消費税計算を行うことは可能です。

## 使い方

Claude Desktop/Claude Codeで対話的に利用します。

### 1. 会社情報と事業年度の設定

> 「会社情報を設定して。会社名は株式会社テスト、決算月は3月、資本金1000万円。事業年度は2024年4月から2025年3月。」

### 2. 税務調整項目の追加

> 「交際費の損金不算入額50万円を加算項目として追加して」

### 3. 全別表の一括計算

> 「当期純利益800万円で全別表を一括計算して」

### 4. 消費税の計算（freee MCPと連携）

> 「freeeから取引データと振替伝票を取得して、消費税を一般課税で計算して」

Claudeが自動的にfreee MCPで仕訳データを取得 → tax-filingにキャッシュ → 消費税計算を実行します。

### 5. 結果の確認

> 「申告書のプレビューを見せて」
> 「整合性チェックをして」

### 6. 電子申告ファイルの出力

> 「e-Tax用XMLファイルを出力して」
> 「eLTAX用XMLファイルを出力して」

## ツール一覧

### セットアップ

| ツール名 | 説明 |
|---------|------|
| `set-company-info` | 会社情報の設定（会社名・資本金・所在地等） |
| `init-fiscal-year` | 事業年度の作成 |
| `import-prior-data` | 前期データの取り込み（繰越欠損金・利益積立金等） |

### データ取得

| ツール名 | 説明 |
|---------|------|
| `get-tax-rates` | 適用税率テーブルの表示 |
| `fetch-freee-data` | freeeから取得した会計データのキャッシュ |

### 税務調整

| ツール名 | 説明 |
|---------|------|
| `add-adjustment` | 税務調整項目の追加（加算/減算、留保/社外流出） |
| `list-adjustments` | 調整項目一覧の表示 |
| `update-adjustment` | 調整項目の修正 |
| `delete-adjustment` | 調整項目の削除 |
| `confirm-adjustment` | 調整項目の確認済みマーク |

### 別表計算

| ツール名 | 対応別表 |
|---------|---------|
| `calculate-schedule-01` | 別表一（法人税額の計算） |
| `calculate-schedule-02` | 別表二（同族会社等の判定） |
| `calculate-schedule-04` | 別表四（所得の金額の計算） |
| `calculate-schedule-05-1` | 別表五(一)（利益積立金額） |
| `calculate-schedule-05-2` | 別表五(二)（租税公課の納付状況） |
| `calculate-schedule-06` | 別表六(一)（所得税額の控除） |
| `calculate-schedule-07` | 別表七(一)（欠損金の繰越控除） |
| `calculate-schedule-08` | 別表八(一)（受取配当等の益金不算入） |
| `calculate-schedule-14` | 別表十四(二)（寄附金の損金算入） |
| `calculate-schedule-15` | 別表十五（交際費等の損金不算入） |
| `calculate-schedule-16` | 別表十六（減価償却資産の計算） |
| `calculate-all-schedules` | 全別表を依存順序で一括計算 |

### 消費税

| ツール名 | 説明 |
|---------|------|
| `calculate-consumption-tax-general` | 一般課税（付表2-3→付表1-3→第一表、freee自動集計対応） |
| `calculate-consumption-tax-simplified` | 簡易課税（75%特例自動判定、freee自動集計対応） |

### 地方税

| ツール名 | 説明 |
|---------|------|
| `calculate-resident-tax` | 法人住民税の計算（法人税割+均等割） |
| `calculate-enterprise-tax` | 法人事業税の計算（3段階累進税率） |
| `calculate-special-enterprise-tax` | 特別法人事業税の計算 |

### 検証・出力

| ツール名 | 説明 |
|---------|------|
| `validate-schedules` | 別表間の整合性チェック |
| `preview-return` | 申告書プレビュー（Markdown形式） |
| `export-etax-xml` | e-Tax XML出力（国税） |
| `export-eltax-xml` | eLTAX XML出力（地方税） |
| `export-financial-xbrl` | 財務諸表XBRL出力 |
| `get-filing-status` | 申告進捗状況の確認 |

## 計算フロー

別表は以下の依存順序で計算されます（`calculate-all-schedules`で自動制御）:

```
別表十六（減価償却）─┐
別表十五（交際費）──┤
別表八 （受取配当）──┼→ 別表四（所得計算）→ 別表七（欠損金控除）─┐
                    │                                           │
別表十四（寄附金）──┘     別表六（税額控除）──────────────────────┤
                                                               │
                         別表一（法人税額）←────────────────────┘
                              │
                         別表五(二)（租税公課）
                              │
                         別表五(一)（利益積立金）

別表二（同族会社判定）── 独立して計算可能
```

## 消費税計算の仕組み

### データフロー

```
freee仕訳データ（税区分コード付き）
    ↓
tax-code-mapping.ts         freee tax_code → 消費税区分マッピング（~120コード）
    ↓
aggregator.service.ts       課税区分別・税率別・用途別に自動集計
    ↓
adapter.service.ts          構造化データ → フラット形式に変換
    ↓
calculate-general.tool.ts   付表2-3 → 付表1-3 → 第一表
```

### 一般課税で対応している計算

- **仕入税額控除方式**: 個別対応方式 / 一括比例配分方式 / 全額控除（95%ルール自動判定）
- **課税売上割合**: 売上返還控除、有価証券譲渡5%算入（No.6405）
- **95%ルール**: 短期事業年度の年換算判定対応
- **インボイス経過措置**: 80%控除（~2026/9）/ 50%控除（~2029/9）
- **仕入返還**: 用途別に控除対象仕入税額から差し引き
- **貸倒れ・貸倒回収**: 貸倒税額は控除、貸倒回収は③控除過大調整税額に計上
- **輸入取引**: 本体額コード（税額計算）と税額コード（直接加算）を分離
- **還付申告**: 差引税額がマイナスの場合の還付処理（Math.max(0)で潰さない）

### 簡易課税で対応している計算

- **6事業区分**: 第一種（卸売90%）～ 第六種（不動産40%）
- **75%特例**: パターン1（1業種≥75%）、パターン2（2業種合計≥75%）、標準の3方式から最有利自動選択
- **freee自動集計**: 簡易課税用tax_code（課売上一～六）からの自動分類

### 税率

| 区分 | 合計税率 | 国税分 | 地方分 |
|------|---------|--------|--------|
| 標準税率 | 10% | 7.8% | 2.2% |
| 軽減税率 | 8% | 6.24% | 1.76% |
| 旧8% | 8% | 6.3% | 1.7% |
| 旧5% | 5% | 4.0% | 1.0% |

### 端数処理

| 項目 | ルール |
|------|--------|
| 課税標準額 | 千円未満切捨 |
| 税額計算 | 円未満切捨 |
| 差引税額・地方消費税 | 百円未満切捨 |

## 対応税率

| 年度 | 法人税率 | 中小法人軽減税率 | 地方法人税率 | 防衛特別法人税 |
|------|---------|----------------|------------|-------------|
| 2019-2025 | 23.2% | 15%（800万円以下） | 10.3% | 非適用 |
| 2026〜 | 23.2% | 15%（800万円以下） | 10.3% | 4%（適用） |

## 開発

```bash
npm test           # テスト実行
npm run test:watch # テストwatch
npm run lint       # 型チェック
npm run build      # ビルド（dist/ + JSONデータコピー）
```

### テスト構成

- **単体テスト**: 84件（法人税・消費税・地方税・端数処理・別表計算・DB・XML生成）
- **統合テスト**: 13件（InMemoryTransportによるMCPサーバーE2E）
- **合計**: 97テスト

## 技術スタック

| 技術 | 用途 |
|------|------|
| TypeScript (ESM) | 実装言語 |
| @modelcontextprotocol/sdk ^1.27 | MCP サーバーフレームワーク |
| Zod ^3.24 | パラメータバリデーション |
| node:sqlite | データベース（Node.js組み込み） |
| Vitest | テストフレームワーク |
| stdio transport | Claude連携 |

## ライセンス

MIT

## 関連プロジェクト

- [freee MCP](https://github.com/freee/freee-mcp) — freee API をClaudeから使えるようにするMCPサーバー（freee公式・Apache-2.0）
