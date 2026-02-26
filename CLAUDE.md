# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## プロジェクト概要

freee会計データを用いた法人税務申告自動化MCPサーバー。Claude Code/Desktopをインターフェースとし、税務調整→別表計算→整合性チェック→電子申告ファイル出力を実現。35のMCPツールを提供。

## コマンド

```bash
npm run build          # TypeScriptビルド + JSONデータコピー + chmod
npm test               # Vitest全テスト実行（97テスト: 単体84+統合13）
npm run test:watch     # Vitest watchモード
npm run lint           # TypeScript型チェック（tsc --noEmit）
npm run dev            # TypeScript watchビルド
```

単一テストファイル実行: `npx vitest run test/services/consumption-tax.test.ts`

## アーキテクチャ

### ツール定義パターン

各ツールは `ToolDefinition<T>` インターフェースに従う:

```typescript
// src/types/tool-definition.ts
interface ToolDefinition<T extends z.ZodType> {
  name: string;
  description: string;
  schema: T;           // Zodスキーマ（パラメータ定義兼バリデーション）
  handler: ToolCallback<...>;
}
```

ツール登録は `src/helpers/register-tool.ts` の `registerTool(server, ToolDef)` で行う。新規ツール追加時は:
1. `src/tools/<category>/` にツールファイル作成
2. `src/tools/index.ts` でimport + `registerAllTools()` に追加

### 別表計算の依存関係

`calculate-all-schedules` が依存順序を制御:

```
別表16(減価償却) → 別表15(交際費) → 別表8(受取配当) → 別表14(寄附金)
                    ↓
               別表4(所得計算) → 別表7(欠損金控除) → 別表6(税額控除)
                    ↓
               別表1(法人税額) → 別表5(二)(租税公課) → 別表5(一)(利益積立金)
```

各別表の計算結果は `schedule_results` テーブルにJSON保存され、後続の別表が参照する。

### 消費税計算のデータフロー

```
freee仕訳 (tax_code付き)
  → tax-code-mapping.ts     : ~120のtax_code → カテゴリ/税率/用途にマッピング
  → aggregator.service.ts   : 課税区分別・税率別・用途別に集計 (ConsumptionTaxAggregation)
  → adapter.service.ts      : 構造化データ → フラット形式に変換 (FlatConsumptionTaxData)
  → calculate-general.tool.ts : 付表2-3 → 付表1-3 → 第一表
```

消費税のカテゴリ: `taxable_sales`, `exempt_sales`, `taxable_purchase`, `non_taxable_purchase`, `common_purchase`, `sales_return`, `bad_debt`, `bad_debt_recovered`, `purchase_return`, `import_taxable`, `import_tax_payment`, `securities_transfer`, `simplified_type_1`〜`6` 等

### 2つのMCPサーバー連携（ブリッジパターン）

freee会計データの取得には [freee MCP](https://github.com/freee/freee-mcp)（freee公式）を使用。Claudeが2つのMCPを橋渡しする:

1. **freee MCP** でdeals/manual_journalsを取得
2. **本サーバー** の `fetch-freee-data` でキャッシュ
3. **本サーバー** の計算ツールを実行

freee MCPなしでも手動数値入力で計算可能。

### データベース

SQLite（`node:sqlite` 組み込み）、WALモード + 外部キー制約ON。9テーブル:

| テーブル | 用途 |
|---------|------|
| companies | 会社情報 |
| fiscal_years | 事業年度 |
| tax_adjustments | 税務調整項目（加算/減算、留保/社外流出） |
| schedule_results | 別表計算結果（JSON） |
| prior_year_data | 前期データ（繰越欠損金等） |
| filing_history | 電子申告ファイル出力履歴 |
| audit_log | 操作ログ |
| freee_cache | freeeから取得したデータのキャッシュ |
| shareholders | 株主情報（別表二用） |

### テストパターン

- **DB**: `getTestDb()` でインメモリDB生成、`setDb()` でシングルトン差し替え
- **統合テスト**: `InMemoryTransport.createLinkedPair()` でMCPクライアント↔サーバーをE2E接続
- テストファイルは `test/` ディレクトリに配置

## 規約

- **金額は全て整数（円単位）**。浮動小数点は使用禁止
- 端数処理: 課税標準額は千円未満切捨て、税額は円未満切捨て、差引税額・地方消費税は百円未満切捨て
- 別表番号は文字列: `"01"`, `"04"`, `"05-1"`, `"05-2"` 等
- コード内変数名・コメントは英語、ドキュメント・ユーザー報告は日本語
- ビルド時 `src/data/` のJSONファイルが `dist/data/` にコピーされる。税率JSONを変更したらビルド必須

## MCP設定

```json
{
  "mcpServers": {
    "tax-filing": {
      "command": "node",
      "args": ["/Users/kanekomasato/freee法人税申告/dist/index.js"]
    }
  }
}
```

## freee会社情報

- 会社: 株式会社Scalar（freee会社ID: 1356167）
- 事業年度: 4月〜3月
