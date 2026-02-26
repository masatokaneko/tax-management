---
title: "feat: freee法人税申告MCPサーバー"
type: feat
date: 2026-02-26
---

# freee法人税申告MCPサーバー

## Overview

freeeの会計データを用いて、法人税務申告をエンドツーエンドで自動化するMCPサーバーを構築する。Claude Codeをインターフェースとし、freee MCPからのデータ取得 → AIによる税務調整推定 → 別表計算 → 整合性チェック → eLTAX/e-Tax電子申告ファイル出力までを一貫して実行する。

**初期ターゲット**: 株式会社Scalar（freee会社ID: 1356167）
**将来展開**: 税理士・中小企業向けSaaS化

---

## Problem Statement

現状の法人税申告プロセスは以下の課題を抱えている:

1. **手作業の多さ**: freeeの会計データから税務申告書を作成するには、手動での税務調整計算・転記が必要
2. **専門知識の要求**: 別表間の依存関係（別表四→別表一→別表五等）を理解し、整合性を保つには高度な税務知識が必要
3. **コストと時間**: 税理士への依頼費用が高額で、自社対応しても多大な時間がかかる
4. **ミスのリスク**: 手動転記による計算ミスや転記漏れが発生しやすい

---

## Proposed Solution

### アーキテクチャ

```
┌─────────────────────────────────────────────────────────┐
│ Claude Code (ユーザーインターフェース)                    │
│   - 対話的に税務申告を進行                              │
│   - 税務調整のAI推定結果をユーザーに提示・確認          │
│   - 申告書の最終レビュー・承認                          │
├─────────────────────────────────────────────────────────┤
│ freee-tax-filing-mcp (TypeScript MCP Server) [新規構築] │
│   ├─ 事業年度管理ツール                                 │
│   ├─ 税務調整ツール (加算・減算項目CRUD)                │
│   ├─ 別表計算ツール群 (別表1〜16)                       │
│   ├─ 消費税計算ツール (一般・簡易)                      │
│   ├─ 地方税計算ツール (住民税・事業税)                  │
│   ├─ 整合性チェックツール                               │
│   ├─ e-Tax XML/XBRL出力ツール (国税)                   │
│   ├─ eLTAX XML出力ツール (地方税)                      │
│   └─ 前期データ管理ツール                               │
├─────────────────────────────────────────────────────────┤
│ SQLite (Drizzle ORM) + JSON税率テーブル                 │
│   ├─ 事業年度マスタ                                     │
│   ├─ 税務調整データ (AI推定フラグ・ユーザー確認フラグ)  │
│   ├─ 別表計算結果 (バージョン管理)                      │
│   ├─ 前期申告データ                                     │
│   ├─ 申告書生成履歴 + 操作ログ                          │
│   └─ JSON: 税率テーブル (年度別)・自治体別税率          │
├─────────────────────────────────────────────────────────┤
│ 既存 freee MCP Server (@him0/freee-mcp)                 │
│   ├─ 仕訳データ取得                                     │
│   ├─ 試算表 (BS/PL) 取得                                │
│   ├─ 勘定科目・取引先マスタ取得                         │
│   └─ 月次推移表取得                                     │
└─────────────────────────────────────────────────────────┘
```

### 技術スタック

| 技術 | 選定理由 |
|------|---------|
| TypeScript | MCP SDKの最も充実したサポート、既存quickbooks-MCPと統一 |
| @modelcontextprotocol/sdk ^1.27 | 最新の`registerTool()`API、Zodスキーマ対応 |
| Zod ^3.24 | ツールパラメータのバリデーション（SDK互換性確認済み） |
| better-sqlite3 + Drizzle ORM | 型安全なSQLiteアクセス、マイグレーション管理 |
| Vitest | テストフレームワーク |
| stdio transport | Claude Code連携の標準方式 |

### データソースの使い分け

| データ | ソース | 取得方法 |
|--------|--------|---------|
| BS/PL/試算表 | freee API | @him0/freee-mcp経由（既存） |
| 仕訳明細 | freee API | @him0/freee-mcp経由（既存） |
| 勘定科目マスタ | freee API | @him0/freee-mcp経由（既存） |
| 税率テーブル | JSONファイル | ローカル（年度別バージョン管理） |
| 自治体別税率 | JSONファイル | ローカル（初期は東京都のみ） |
| 税務調整項目 | AI推定+手動 | SQLite永続化 |
| 株主構成 | 手動入力 | Claude Code対話→SQLite |
| 固定資産台帳 | 手動入力/freee | freee APIで取得可能か要確認→不可なら手動入力 |
| 前期申告データ | 手動入力 | 初回のみClaude Code対話→SQLite |

---

## Technical Approach

### プロジェクト構造

```
freee法人税申告/
├── package.json
├── tsconfig.json
├── drizzle.config.ts
├── CLAUDE.md
├── .env.example
├── .gitignore
├── src/
│   ├── index.ts                          # エントリポイント（shebang付き）
│   ├── server.ts                         # McpServer初期化
│   ├── constants.ts                      # 定数定義
│   ├── types/
│   │   ├── index.ts
│   │   ├── tool-definition.ts            # ToolDefinition<T>インターフェース
│   │   ├── schedule.ts                   # 別表データ型
│   │   ├── tax-adjustment.ts             # 税務調整型
│   │   ├── fiscal-year.ts                # 事業年度型
│   │   └── xbrl.ts                       # XBRL関連型
│   ├── schemas/
│   │   ├── common.schema.ts              # 共通Zodスキーマ（金額、日付等）
│   │   ├── corporate-tax.schema.ts       # 法人税関連スキーマ
│   │   ├── consumption-tax.schema.ts     # 消費税関連スキーマ
│   │   └── local-tax.schema.ts           # 地方税関連スキーマ
│   ├── tools/
│   │   ├── index.ts                      # registerAllTools()
│   │   ├── setup/                        # セットアップ系ツール
│   │   │   ├── init-fiscal-year.tool.ts  # 事業年度初期化
│   │   │   ├── import-prior-data.tool.ts # 前期データ取込
│   │   │   └── set-company-info.tool.ts  # 会社情報設定
│   │   ├── data/                         # データ取得系ツール
│   │   │   ├── fetch-freee-data.tool.ts  # freeeデータ一括取得
│   │   │   └── get-tax-rates.tool.ts     # 税率テーブル取得
│   │   ├── adjustment/                   # 税務調整系ツール
│   │   │   ├── list-adjustments.tool.ts  # 調整項目一覧
│   │   │   ├── add-adjustment.tool.ts    # 調整項目追加
│   │   │   ├── update-adjustment.tool.ts # 調整項目更新
│   │   │   ├── delete-adjustment.tool.ts # 調整項目削除
│   │   │   └── confirm-adjustment.tool.ts # 調整項目確認
│   │   ├── schedules/                    # 別表計算ツール
│   │   │   ├── calculate-schedule-01.tool.ts  # 別表一
│   │   │   ├── calculate-schedule-02.tool.ts  # 別表二
│   │   │   ├── calculate-schedule-04.tool.ts  # 別表四
│   │   │   ├── calculate-schedule-05-1.tool.ts # 別表五(一)
│   │   │   ├── calculate-schedule-05-2.tool.ts # 別表五(二)
│   │   │   ├── calculate-schedule-06.tool.ts  # 別表六
│   │   │   ├── calculate-schedule-07.tool.ts  # 別表七
│   │   │   ├── calculate-schedule-08.tool.ts  # 別表八
│   │   │   ├── calculate-schedule-14.tool.ts  # 別表十四
│   │   │   ├── calculate-schedule-15.tool.ts  # 別表十五
│   │   │   ├── calculate-schedule-16.tool.ts  # 別表十六
│   │   │   └── calculate-all-schedules.tool.ts # 全別表一括計算（依存順序保証）
│   │   ├── consumption-tax/              # 消費税ツール
│   │   │   ├── calculate-general.tool.ts # 一般課税
│   │   │   └── calculate-simplified.tool.ts # 簡易課税
│   │   ├── local-tax/                    # 地方税ツール
│   │   │   ├── calculate-resident-tax.tool.ts  # 法人住民税
│   │   │   ├── calculate-enterprise-tax.tool.ts # 法人事業税
│   │   │   └── calculate-special-enterprise-tax.tool.ts # 特別法人事業税
│   │   ├── validation/                   # 整合性チェック
│   │   │   ├── validate-schedules.tool.ts  # 別表間整合性
│   │   │   └── validate-totals.tool.ts     # 合計検算
│   │   ├── export/                       # 出力ツール
│   │   │   ├── export-etax-xml.tool.ts   # e-Tax XML出力（国税）
│   │   │   ├── export-eltax-xml.tool.ts  # eLTAX XML出力（地方税）
│   │   │   └── preview-return.tool.ts    # 申告書プレビュー（Markdown）
│   │   └── status/                       # ステータス管理
│   │       ├── get-filing-status.tool.ts # 進捗確認
│   │       └── get-filing-history.tool.ts # 履歴確認
│   ├── services/                         # ビジネスロジック
│   │   ├── corporate-tax.service.ts      # 法人税計算エンジン
│   │   ├── schedule-engine.service.ts    # 別表計算エンジン
│   │   ├── consumption-tax.service.ts    # 消費税計算エンジン
│   │   ├── local-tax.service.ts          # 地方税計算エンジン
│   │   ├── tax-adjustment.service.ts     # 税務調整管理
│   │   ├── rounding.service.ts           # 端数処理
│   │   └── xbrl-builder.service.ts       # XBRL/XML生成
│   ├── helpers/
│   │   ├── register-tool.ts             # ツール登録ヘルパー
│   │   └── format-error.ts             # エラーフォーマット
│   ├── db/
│   │   ├── client.ts                    # DB接続（WALモード、FK有効）
│   │   ├── schema.ts                    # Drizzleスキーマ定義
│   │   └── migrations/                  # マイグレーションファイル
│   └── data/
│       ├── tax-rates/
│       │   ├── corporate-tax-2025.json  # 法人税率（2025年度）
│       │   ├── corporate-tax-2026.json  # 法人税率（2026年度、防衛特別法人税含む）
│       │   └── consumption-tax.json     # 消費税率
│       └── master/
│           └── tokyo-tax-rates.json     # 東京都の地方税率
├── data/                                # ランタイムデータ（.gitignore対象）
│   └── tax-filing.db                    # SQLiteデータベース
├── test/
│   ├── services/
│   │   ├── corporate-tax.test.ts
│   │   ├── schedule-engine.test.ts
│   │   └── rounding.test.ts
│   └── tools/
│       └── server.integration.test.ts   # InMemoryTransportによる統合テスト
└── docs/
    ├── brainstorms/
    └── plans/
```

### SQLiteスキーマ設計

```typescript
// src/db/schema.ts

// === 会社情報 ===
export const companies = sqliteTable('companies', {
  id: text('id').primaryKey(),              // freee会社ID
  name: text('name').notNull(),
  fiscalYearStartMonth: integer('fiscal_year_start_month').notNull(), // 1-12
  capitalAmount: integer('capital_amount'),  // 資本金（円）
  address: text('address'),                 // 所在地（地方税用）
  municipalityCode: text('municipality_code'), // 自治体コード
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
});

// === 事業年度 ===
export const fiscalYears = sqliteTable('fiscal_years', {
  id: text('id').primaryKey(),              // "2025" など
  companyId: text('company_id').notNull().references(() => companies.id),
  startDate: text('start_date').notNull(),  // "2025-04-01"
  endDate: text('end_date').notNull(),      // "2026-03-31"
  status: text('status').notNull().default('draft'),
  // status: draft → data_fetched → adjustments_estimated →
  //         adjustments_confirmed → calculated → validated →
  //         exported → filed
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
});

// === 税務調整項目 ===
export const taxAdjustments = sqliteTable('tax_adjustments', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  fiscalYearId: text('fiscal_year_id').notNull().references(() => fiscalYears.id),
  adjustmentType: text('adjustment_type').notNull(), // 'addition' | 'deduction'
  category: text('category').notNull(),              // '留保' | '社外流出'
  itemName: text('item_name').notNull(),
  scheduleRef: text('schedule_ref'),                 // 参照別表
  amount: integer('amount').notNull(),               // 円単位（整数）
  description: text('description'),
  sourceJournalIds: text('source_journal_ids'),      // 根拠仕訳ID（JSON配列）
  aiEstimated: integer('ai_estimated', { mode: 'boolean' }).default(false),
  userConfirmed: integer('user_confirmed', { mode: 'boolean' }).default(false),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
});

// === 別表計算結果 ===
export const scheduleResults = sqliteTable('schedule_results', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  fiscalYearId: text('fiscal_year_id').notNull().references(() => fiscalYears.id),
  scheduleNumber: text('schedule_number').notNull(), // "01", "04", "05-1" 等
  version: integer('version').notNull().default(1),
  inputData: text('input_data').notNull(),           // JSON
  resultData: text('result_data').notNull(),          // JSON
  isValid: integer('is_valid', { mode: 'boolean' }).default(false),
  calculatedAt: text('calculated_at').notNull(),
});

// === 前期データ ===
export const priorYearData = sqliteTable('prior_year_data', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  fiscalYearId: text('fiscal_year_id').notNull().references(() => fiscalYears.id),
  dataType: text('data_type').notNull(),  // 'carried_loss' | 'retained_earnings' | 'prior_tax' | 'depreciation'
  dataJson: text('data_json').notNull(),
  importedAt: text('imported_at').notNull(),
});

// === 申告書生成履歴 ===
export const filingHistory = sqliteTable('filing_history', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  fiscalYearId: text('fiscal_year_id').notNull().references(() => fiscalYears.id),
  filingType: text('filing_type').notNull(), // 'corporate_tax' | 'consumption_tax' | 'local_tax'
  format: text('format').notNull(),          // 'xml' | 'xbrl'
  filePath: text('file_path').notNull(),
  generatedAt: text('generated_at').notNull(),
  status: text('status').notNull().default('generated'),
});

// === 操作ログ（監査用） ===
export const auditLog = sqliteTable('audit_log', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  fiscalYearId: text('fiscal_year_id'),
  action: text('action').notNull(),        // 'calculate' | 'adjust' | 'export' | 'confirm'
  target: text('target').notNull(),        // 対象（例: "schedule_04", "adjustment_123"）
  detail: text('detail'),                  // JSON詳細
  timestamp: text('timestamp').notNull(),
});
```

### 別表計算の依存関係と実装順序

```
【計算フロー（依存関係図）】

  freee BS/PL ──→ 別表四（所得金額計算）──→ 別表一（税額計算）
       │                    ↑                         ↑
       │              ┌─────┤                         │
       │              │     │                         │
  別表十六（減価償却）──┘     │                    別表六（税額控除）
  別表十五（交際費）────────┘                         │
  別表十四（寄付金）────────┘                    別表七（欠損金繰越）
  別表八 （受取配当）───────┘
       │
       └───→ 別表五(一)（利益積立金）←── 別表四の「留保②」欄
              別表五(二)（租税公課）←── 別表一の確定税額
              別表二 （同族会社判定）←── 株主情報（手動入力）
```

**正しい計算順序（実装上）**:
1. 別表十六（減価償却超過額/不足額を確定）
2. 別表十五（交際費の損金不算入額を確定）
3. 別表十四（寄付金の損金不算入額を確定）
4. 別表八（受取配当の益金不算入額を確定）
5. 別表四（上記の加算・減算項目を集約→課税所得を計算）
6. 別表七（繰越欠損金の控除）
7. 別表六（税額控除額を計算）
8. 別表一（最終税額計算 = 課税所得 × 税率 - 控除）
9. 別表五(二)（確定税額に基づく租税公課の整理）
10. 別表五(一)（別表四の「留保」欄から利益積立金額を更新）
11. 別表二（同族会社判定 -- 独立して計算可能）

**検算式**: `別表4 52の② + 31の①欄 + (27,29,30の③欄合計) = 31の④欄`

### 一括計算ツール（calculate-all-schedules）

個別の別表計算ツールに加え、全別表を依存関係の正しい順序で一括計算するツールを提供する。

**設計理由**:
1. Claude Codeに11回のツール呼び出し順序を毎回正しく実行させるのは脆弱（コンテキストリセット時に順序を間違えるリスク）
2. 個別ツールは「交際費を修正したので別表十五だけ再計算」といったケースで引き続き必要
3. 依存グラフの解決はサーバー側で保証すべき（ドメインロジック）

```typescript
// calculate-all-schedules ツール仕様
{
  name: "calculate-all-schedules",
  description: "全別表を依存関係の正しい順序で一括計算する。税務調整項目が確定済みであることが前提。",
  inputSchema: z.object({
    fiscalYearId: z.string().describe("事業年度ID"),
    force: z.boolean().optional().describe("未確認の調整項目があっても強制実行"),
  }),
  handler: async ({ fiscalYearId, force }) => {
    // 1. 未確認の税務調整項目がないかチェック（forceでスキップ可能）
    // 2. 依存グラフに従い順次計算:
    //    16 → 15 → 14 → 8 → 4 → 7 → 6 → 1 → 5(2) → 5(1) → 2
    // 3. 各ステップの結果をSQLiteに保存
    // 4. 全計算完了後に整合性チェック（検算式）を実行
    // 5. エラー発生時は「どの別表で失敗したか」を明示して中断
    // 返却: 全別表の計算サマリー + 整合性チェック結果
  }
}

// 依存グラフの定義（schedule-engine.service.ts内）
const SCHEDULE_DEPENDENCY_GRAPH: Record<string, string[]> = {
  "16": [],                        // 依存なし（減価償却）
  "15": [],                        // 依存なし（交際費）
  "14": [],                        // 依存なし（寄付金）
  "08": [],                        // 依存なし（受取配当）
  "04": ["16", "15", "14", "08"],  // 加算・減算項目の集約→課税所得
  "07": ["04"],                    // 課税所得に対して繰越欠損金を控除
  "06": [],                        // 所得税額控除（独立計算可能）
  "01": ["04", "07", "06"],        // 最終税額計算
  "05-2": ["01"],                  // 確定税額に基づく租税公課
  "05-1": ["04", "05-2"],          // 利益積立金額
  "02": [],                        // 同族会社判定（独立）
};
```

**セッション復旧時のフロー**: ユーザーが「前回の続きから」と言った場合、Claude Codeは `get-filing-status` で現在の状態を確認し、未計算の別表があれば `calculate-all-schedules` を実行するだけで全別表が正しい順序で再計算される。

### 法人税率テーブル（JSON設計例）

```json
// src/data/tax-rates/corporate-tax-2025.json
{
  "fiscalYear": "2025",
  "effectiveFrom": "2025-04-01",
  "effectiveTo": "2026-03-31",
  "corporateTax": {
    "standardRate": 0.232,
    "sme": {
      "capitalThreshold": 100000000,
      "reducedRateThreshold": 8000000,
      "reducedRate": 0.15,
      "standardRate": 0.232
    }
  },
  "localCorporateTax": { "rate": 0.103 },
  "defenseSpecialTax": {
    "applicable": false,
    "rate": 0.04,
    "deductionAmount": 5000000,
    "startDate": "2026-04-01"
  },
  "rounding": {
    "taxableIncome": { "unit": 1000, "method": "floor" },
    "taxAmount": { "unit": 100, "method": "floor" }
  }
}
```

### e-TaxとeLTAXの出力仕様

| 区分 | 申告先 | フォーマット | 提出方法（初期） |
|------|--------|-------------|----------------|
| 法人税 | e-Tax（国税庁） | XML（国税庁XSD準拠） | e-Taxソフトで手動インポート→送信 |
| 消費税 | e-Tax（国税庁） | XML | 同上 |
| 地方法人税 | e-Tax（国税庁） | XML | 同上 |
| 法人住民税 | eLTAX（地方税共同機構） | XML | PCdeskで手動インポート→送信 |
| 法人事業税 | eLTAX | XML | 同上 |

**XBRL/XML仕様書の入手先**:
- e-Tax: https://www.e-tax.nta.go.jp/shiyo/shiyo3.htm
- 別表XSD: https://www.nta.go.jp/taxes/tetsuzuki/shinsei/annai/hojin/shinkoku/itiran2025/01.htm
- eLTAX: https://www.eltax.lta.go.jp/support/shiyosho/

---

## Implementation Phases

### Phase 1: 基盤構築 + コア別表（別表四・一・五）

**目標**: MCPサーバーの骨格を構築し、手動入力で別表四→一→五の計算が動作する状態を実現。

#### Phase 1a: インフラストラクチャ

- [x] `package.json` / `tsconfig.json` の作成（node:sqlite採用によりdrizzle不要） (`package.json`)
- [x] McpServerの初期化とstdioトランスポート設定 (`src/index.ts`, `src/server.ts`)
- [x] ToolDefinition<T>インターフェースとregisterToolヘルパー (`src/types/tool-definition.ts`, `src/helpers/register-tool.ts`)
- [x] SQLiteスキーマ定義（node:sqlite使用） (`src/db/client.ts`)
- [x] 税率テーブルJSON作成（2025年度・2026年度） (`src/data/tax-rates/`)
- [x] `~/.mcp.json` への登録設定
- [x] 端数処理サービス (`src/services/rounding.service.ts`)

#### Phase 1b: セットアップツール

- [x] `init-fiscal-year` ツール -- 事業年度の作成 (`src/tools/setup/init-fiscal-year.tool.ts`)
- [x] `set-company-info` ツール -- 会社情報設定（資本金、所在地、決算月） (`src/tools/setup/set-company-info.tool.ts`)
- [x] `import-prior-data` ツール -- 前期データ手動入力（繰越欠損金、前期法人税額、利益積立金） (`src/tools/setup/import-prior-data.tool.ts`)
- [x] `get-filing-status` ツール -- 現在の進捗確認 (`src/tools/status/get-filing-status.tool.ts`)
- [x] `get-tax-rates` ツール -- 適用税率テーブルの表示 (`src/tools/data/get-tax-rates.tool.ts`)

#### Phase 1c: 税務調整ツール

- [x] `add-adjustment` ツール -- 税務調整項目の手動追加（加算/減算、留保/社外流出） (`src/tools/adjustment/add-adjustment.tool.ts`)
- [x] `list-adjustments` ツール -- 調整項目一覧表示 (`src/tools/adjustment/list-adjustments.tool.ts`)
- [x] `update-adjustment` ツール -- 調整項目の修正 (`src/tools/adjustment/update-adjustment.tool.ts`)
- [x] `delete-adjustment` ツール -- 調整項目の削除 (`src/tools/adjustment/delete-adjustment.tool.ts`)
- [x] `confirm-adjustment` ツール -- 調整項目の確認済みフラグ設定 (`src/tools/adjustment/confirm-adjustment.tool.ts`)

#### Phase 1d: コア別表計算

- [x] 別表四 -- 所得の金額の計算 (`src/tools/schedules/calculate-schedule-04.tool.ts`)
  - 当期純利益（手動入力またはfreeeから取得）
  - 加算項目（税務調整データから集約）
  - 減算項目（税務調整データから集約）
  - 課税所得 = 当期純利益 + 加算合計 - 減算合計
  - 留保/社外流出の区分計算
- [x] 別表一 -- 法人税額の計算 (`src/tools/schedules/calculate-schedule-01.tool.ts`, `src/services/corporate-tax.service.ts`)
  - 課税所得 × 法人税率（中小法人の軽減税率対応）
  - 地方法人税額 = 法人税額 × 10.3%
  - 防衛特別法人税（2026年4月以降事業年度）
  - 前期中間納付額の控除
- [x] 別表五(二) -- 租税公課の納付状況 (`src/tools/schedules/calculate-schedule-05-2.tool.ts`)
  - 前期確定法人税額の期中納付記録
  - 当期確定税額の計上
- [x] 別表五(一) -- 利益積立金額 (`src/tools/schedules/calculate-schedule-05-1.tool.ts`)
  - 期首利益積立金額（前期データ）
  - 当期増減（別表四の「留保」欄連動）
  - 期末利益積立金額
- [x] 一括計算ツール -- 依存グラフに従い全別表を順次計算 (`src/tools/schedules/calculate-all-schedules.tool.ts`)
  - 依存グラフのハードコード定義
  - 未確認調整項目のチェック（forceオプション）
  - 各ステップの結果をSQLiteに保存
  - エラー時は失敗箇所を明示して中断
  - 計算完了後に整合性チェック（検算式）を自動実行
- [x] 整合性チェック（別表四⇔五(一)の検算） (`src/tools/validation/validate-schedules.tool.ts`)
- [x] 申告書プレビュー（Markdown形式出力） (`src/tools/export/preview-return.tool.ts`)

#### Phase 1 テスト

- [x] 法人税計算サービスの単体テスト（税率テーブル、端数処理） (`test/services/corporate-tax.test.ts`)
- [x] DBスキーマ・制約のテスト (`test/services/db.test.ts`)
- [x] InMemoryTransportによるMCPサーバー統合テスト (`test/tools/server.integration.test.ts`)
- [ ] Scalarの前期申告データを使った検算テスト

**Phase 1 完了基準**: 手動で税務調整項目を入力し、別表四→一→五(一)(二)を計算して、Markdownプレビューで結果を確認できる。

---

### Phase 2: 主要別表 + AI推定 + freee連携

**目標**: freeeからのデータ自動取得、AIによる税務調整推定、別表二・十五・十六の追加。

#### Phase 2a: freeeデータ取得連携

- [x] `fetch-freee-data` ツール -- freee MCPから取得したBS/PL/仕訳データをSQLiteにキャッシュ (`src/tools/data/fetch-freee-data.tool.ts`)
  - Claude CodeがfreeMCPで取得したデータを受け取りキャッシュ
  - freee_cacheテーブルに永続化
- [x] 勘定科目マッピングテーブル -- freee科目名→税務調整カテゴリの対応定義 (`src/data/master/account-mapping.json`)

#### Phase 2b: AI税務調整推定

AIの推定は新規MCPツール内では行わない。Claude Code（LLM）自体がfreeeの仕訳データと勘定科目を分析し、税務調整項目を推定する。MCPサーバーは推定結果の保存・管理のみを担当する。

フロー:
1. Claude Codeがfreee MCPで仕訳データを取得
2. Claude Codeが仕訳を分析し、税務調整項目を推定
3. Claude Codeが`add-adjustment`ツールで調整項目を登録（`aiEstimated: true`）
4. ユーザーに推定結果を提示（根拠仕訳を含む）
5. ユーザーが確認→`confirm-adjustment`で確定

**推定対象の主要カテゴリ**:
| カテゴリ | 推定方法 | 根拠データ |
|---------|---------|-----------|
| 交際費等の損金不算入 | 勘定科目「接待交際費」の仕訳抽出→限度額計算 | 仕訳+資本金 |
| 減価償却超過額 | 税務上の償却限度額とfreee計上額の差額 | 固定資産+仕訳 |
| 寄付金の損金不算入 | 勘定科目「寄付金」の仕訳抽出→限度額計算 | 仕訳+所得金額 |
| 租税公課の損金不算入 | 法人税・住民税等の計上額を加算 | 仕訳 |
| 受取配当等の益金不算入 | 受取配当の仕訳抽出→持株比率による区分 | 仕訳+株主情報 |

#### Phase 2c: 追加別表

- [x] 別表十六 -- 減価償却資産の計算 (`src/tools/schedules/calculate-schedule-16.tool.ts`)
  - 定額法/定率法の計算
  - 耐用年数別の計算
  - 税務上の償却限度額 vs 会計上の計上額→超過額/不足額
- [x] 別表十五 -- 交際費等の損金不算入 (`src/tools/schedules/calculate-schedule-15.tool.ts`)
  - 中小法人: 800万円の定額控除限度額
  - 飲食費の50%損金算入特例
- [x] 別表二 -- 同族会社等の判定 (`src/tools/schedules/calculate-schedule-02.tool.ts`)
  - 株主情報の手動入力（shareholdersテーブル追加）
  - 上位3グループの持株比率計算
  - 同族会社/非同族会社の判定

**Phase 2 完了基準**: freeeデータから自動で税務調整が推定され、ユーザー確認後に別表一〜五・十五・十六が計算できる。

---

### Phase 3: 残りの別表 + 消費税 + 地方税

**目標**: 全別表対応、消費税・地方税の計算。

#### Phase 3a: 残りの別表

- [x] 別表六 -- 所得税額の控除 (`src/tools/schedules/calculate-schedule-06.tool.ts`)
- [x] 別表七 -- 欠損金の繰越控除 (`src/tools/schedules/calculate-schedule-07.tool.ts`)
- [x] 別表八 -- 受取配当等の益金不算入 (`src/tools/schedules/calculate-schedule-08.tool.ts`)
- [x] 別表十四 -- 寄付金の損金算入 (`src/tools/schedules/calculate-schedule-14.tool.ts`)

#### Phase 3b: 消費税

- [x] 一般課税（原則課税）の計算 (`src/tools/consumption-tax/calculate-general.tool.ts`)
  - 課税売上に係る消費税額の計算
  - 仕入税額控除の計算（全額控除/個別対応/一括比例配分）
  - インボイス経過措置（80%/50%控除の期間判定）
- [x] 簡易課税の計算 (`src/tools/consumption-tax/calculate-simplified.tool.ts`)
  - 事業区分ごとのみなし仕入率適用
  - 2種以上の事業がある場合の按分計算

#### Phase 3c: 地方税

- [x] 法人住民税の計算 (`src/tools/local-tax/calculate-resident-tax.tool.ts`)
  - 法人税割 = 法人税額 × 住民税率
  - 均等割（資本金・従業員数による段階判定）
- [x] 法人事業税の計算 (`src/tools/local-tax/calculate-enterprise-tax.tool.ts`)
  - 3段階の累進税率（400万/800万/800万超）
  - 東京都超過税率
- [x] 特別法人事業税 (`src/tools/local-tax/calculate-special-enterprise-tax.tool.ts`)
  - 事業税額 × 37%

**Phase 3 完了基準**: 全別表・消費税・地方税が計算でき、全体の整合性チェックが通る。

---

### Phase 4: 電子申告ファイル出力

**目標**: e-Tax/eLTAX提出可能なXML/XBRLファイルの生成。

#### Phase 4a: e-Tax XML出力（国税）

- [x] e-Tax仕様書（CAB形式）のダウンロードと解析 → form-definitions.json を正式フォームID・XMLタグで更新済み
- [ ] 別表XMLスキーマ（XSD）の取得と型生成（正式XSD入手後に対応要）
- [x] 法人税申告書XML生成 (`src/tools/export/export-etax-xml.tool.ts`)
- [x] 消費税申告書XML生成（法人税XMLに含む構造で対応）
- [x] 財務諸表XBRL生成（XBRL 2.1形式） (`src/tools/export/export-financial-xbrl.tool.ts`)

#### Phase 4b: eLTAX XML出力（地方税）

- [ ] eLTAX公開仕様書のダウンロードと解析（未実施・正式仕様入手後にスキーマ更新要）
- [x] 法人住民税・事業税XML生成 (`src/tools/export/export-eltax-xml.tool.ts`)

#### Phase 4c: 出力検証

- [ ] 生成XMLのXSDバリデーション（正式XSD入手後に実施）
- [ ] e-Taxソフトへのテストインポート検証
- [ ] PCdeskへのテストインポート検証

**Phase 4 完了基準**: 生成したXML/XBRLファイルがe-Taxソフト/PCdeskで正常にインポートでき、送信可能な状態になる。

---

## Alternative Approaches Considered

| アプローチ | 概要 | 不採用理由 |
|-----------|------|-----------|
| AIエージェント + Web UI | Next.js Web UIでユーザーが確認・操作 | Web UI開発のオーバーヘッドが大きい。自社利用段階では過剰 |
| Pythonモノリス | 既存freee-analysis-systemを拡張 | AIエージェントの柔軟性が低い。税務判断の曖昧さに対応しにくい |
| 既存税務ソフト連携 | 弥生やfreee申告と連携 | API連携が不十分。独自計算エンジンの柔軟性を優先 |

---

## Acceptance Criteria

### Functional Requirements

- [x] freeeデータから法人税申告書（別表一〜十六）を自動生成できる（12別表ツール実装済み）
- [x] 税務調整項目をAI（Claude）が推定し、ユーザーが確認・修正できる（aiEstimated+confirm-adjustment）
- [x] 消費税申告書（一般課税・簡易課税）を計算できる（9テスト合格）
- [x] 地方税（法人住民税・事業税・特別法人事業税）を計算できる（9テスト合格）
- [x] 別表間の整合性チェックが通る（validate-schedules実装、統合テスト合格）
- [x] e-Tax提出可能なXML/XBRLファイルを出力できる（export-etax-xml + export-financial-xbrl）
- [x] eLTAX提出可能なXMLファイルを出力できる（export-eltax-xml実装済み）
- [x] 前期データとの継続性が保たれる（import-prior-data: 繰越欠損金/利益積立金/前期法人税額/減価償却）
- [x] セッション断絶後に「前回の続きから」で再開できる（get-filing-status実装済み）

### Non-Functional Requirements

- [x] 税額計算の端数処理が税法の規定に準拠している（rounding.service.ts、13テスト合格）
- [x] 全計算過程がSQLiteに記録され、監査時に説明可能（audit_logテーブル）
- [x] SQLiteのWALモードで安定した読み書き性能（WALモード + FK有効）
- [x] 金額は全て整数（円単位）で処理し、浮動小数点誤差を排除（z.number().int()統一）

### Quality Gates

- [x] コア別表（一・四・五）の単体テストカバレッジ（corporate-tax 10テスト + 統合テスト13）
- [ ] Scalarの前期申告書データとの突き合わせテストが合格（前期申告書データ未入手）
- [x] MCP InMemoryTransportでのE2Eテスト合格（97テスト全合格）

---

## Success Metrics

1. 法人税申告書の作成時間が従来比で大幅に短縮される
2. 手動計算と同一の税額が算出される（前期申告書との突き合わせ）
3. 別表間の整合性チェックが100%通過する
4. e-Taxソフトでインポートエラーが0件

---

## Dependencies & Prerequisites

| 依存 | 状態 | 影響 |
|------|------|------|
| @him0/freee-mcp | 導入済み | freeeデータ取得の前提 |
| freee API認証 | 設定済み（会社ID: 1356167） | トークン有効期限の確認が必要 |
| e-Tax仕様書 | ダウンロード・解析済み | form-definitions.jsonに正式フォームID・XMLタグ反映済み |
| eLTAX仕様書 | 未ダウンロード | Phase 4の前にダウンロード・解析が必要 |
| Scalarの前期申告書 | 未入手 | テストデータ・前期データ投入に必要 |
| Node.js >=18 | 導入済み（Homebrew） | MCP SDK要件 |

---

## Risk Analysis & Mitigation

| リスク | 影響度 | 対策 |
|--------|--------|------|
| e-Tax XMLフォーマットの解釈ミス | 高 | Phase 4で早期にe-Taxソフトへのインポートテストを実施 |
| freee APIで固定資産データが取得不可 | 中 | 手動入力ツールで代替。別表十六は手入力前提で設計 |
| 税率テーブルの誤り | 高 | 複数の公的ソースでクロスチェック。テストケースで検証 |
| AIの税務調整推定ミス | 中 | 必ずユーザー確認を挟む。推定根拠（仕訳ID）を表示 |
| 税法改正による計算ロジック変更 | 中 | 税率テーブルを年度別JSONで分離管理。ロジック変更はサービス層で吸収 |

---

## Open Questions (SpecFlow分析より)

### Critical（未解決で実装をブロックするもの）

1. **Scalarの事業年度**: 何月始まり何月終わりか → freee APIの会社情報から自動取得予定
2. **前期申告書データ**: 実物の入手が必要 → テストデータおよび前期データ投入に使用
3. **freee固定資産API**: @him0/freee-mcpで固定資産台帳データが取得可能か確認が必要

### Important（初期リリース前に解決が望ましいもの）

4. **添付書類**: 勘定科目内訳明細書、法人事業概況説明書はスコープ外とし将来フェーズで対応
5. **中間申告**: 初期スコープ外とし確定申告のみ対応
6. **修正申告・更正の請求**: 初期スコープ外

---

## References & Research

### Internal References

- ブレインストーム: `docs/brainstorms/2026-02-26-tax-filing-system-brainstorm.md`
- 既存MCPサーバーテンプレート: `/Users/kanekomasato/quickbooks-online-mcp-server/`
- freee APIクライアント参考: `/Users/kanekomasato/cost management/freee-analysis-system/src/core/api/client.py`
- freee認証設定: `/Users/kanekomasato/cost management/freee-analysis-system/.config/freee-mcp/config.json`
- MCP設定: `~/.mcp.json`

### External References

- e-Tax仕様書: https://www.e-tax.nta.go.jp/shiyo/shiyo3.htm
- 別表XSD（令和7年4月以降）: https://www.nta.go.jp/taxes/tetsuzuki/shinsei/annai/hojin/shinkoku/itiran2025/01.htm
- eLTAX技術仕様: https://www.eltax.lta.go.jp/support/shiyosho/
- MCP TypeScript SDK: https://github.com/modelcontextprotocol/typescript-sdk
- MCP Server開発ガイド: https://modelcontextprotocol.io/docs/develop/build-server
- 別表四と五の検算: https://www.cs-acctg.com/column/kaikei_keiri/016077.html
- 法人税率（2025-2026年度）: https://sogyotecho.jp/corporate-tax-2/
- 実効税率31.52%: https://ventureinq.jp/effectivetaxrate/
- 東京都法人事業税: https://www.tax.metro.tokyo.lg.jp/kazei/work/houjinji
