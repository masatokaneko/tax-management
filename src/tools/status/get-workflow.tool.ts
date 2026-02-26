/**
 * Workflow guide tool — returns step-by-step instructions
 * for Claude Desktop (which cannot read .claude/skills/).
 */

import { z } from "zod";
import type { ToolDefinition } from "../../types/tool-definition.js";

const schema = z.object({
  workflow: z.enum([
    "consumption-tax-general",
    "consumption-tax-simplified",
    "corporate-tax",
    "all-schedules",
    "overview",
  ]).default("overview")
    .describe("取得するワークフロー: overview=全体概要, consumption-tax-general=消費税(一般課税), consumption-tax-simplified=消費税(簡易課税), corporate-tax=法人税, all-schedules=全別表一括計算"),
});

// ---------------------------------------------------------------------------
// Workflow contents
// ---------------------------------------------------------------------------

const WORKFLOWS: Record<string, string> = {
  overview: `# tax-filing MCP ワークフロー概要

このサーバーは freee 会計データを用いた法人税務申告を自動化します。
35のMCPツールを提供し、税務調整→別表計算→整合性チェック→電子申告ファイル出力を実現します。

## 利用可能なワークフロー

1. **消費税（一般課税）** — get-workflow(workflow="consumption-tax-general")
2. **消費税（簡易課税）** — get-workflow(workflow="consumption-tax-simplified")
3. **法人税（全別表一括）** — get-workflow(workflow="all-schedules")
4. **法人税（個別別表）** — get-workflow(workflow="corporate-tax")

## 共通の事前準備

1. set-company-info で会社情報を登録（会社名、資本金等）
2. init-fiscal-year で事業年度を作成（開始日・終了日）
3. freee MCPの freee_api_get で仕訳データを取得
4. fetch-freee-data でデータをキャッシュ

## freee データのキャッシュ方法

### 取引データ（deals）
\`\`\`
freee MCP: freee_api_get("/api/1/deals?company_id=1356167&limit=100&offset=0")
→ 全ページ取得（total_count に達するまで offset を増やす）
→ tax-filing MCP: fetch-freee-data(fiscalYearId, dataType="deals", data=取得結果)
※ ページ分割時は appendMode=true で追記
\`\`\`

### 振替伝票（manual_journals）
\`\`\`
freee MCP: freee_api_get("/api/1/manual_journals?company_id=1356167&limit=100&offset=0")
→ 全ページ取得
→ tax-filing MCP: fetch-freee-data(fiscalYearId, dataType="manual_journals", data=取得結果)
\`\`\`

### 試算表
\`\`\`
freee MCP: freee_api_get("/api/1/reports/trial_bs?company_id=1356167&fiscal_year=2025")
→ tax-filing MCP: fetch-freee-data(fiscalYearId, dataType="trial_balance", data=取得結果, netIncome=当期純利益)
\`\`\``,

  "consumption-tax-general": `# 消費税計算ワークフロー（一般課税・原則課税）

## Step 1: freee データをキャッシュ

1. freee MCP の freee_api_get で /api/1/deals を全ページ取得
2. freee MCP の freee_api_get で /api/1/manual_journals を全ページ取得
3. fetch-freee-data で deals をキャッシュ（dataType="deals"）
4. fetch-freee-data で manual_journals をキャッシュ（dataType="manual_journals"）

**重要**: freee API は1回100件まで。offset で全件取得すること。
大量仕訳の場合は appendMode=true でページを追記。

## Step 2: 一般課税を計算

calculate-consumption-tax-general を実行:
- fiscalYearId: "対象事業年度ID"
- useFreeeData: true
- deductionMethod: "individual"（個別対応方式）または "proportional"（一括比例配分）
- interimNationalTax: 中間納付額（円、あれば）
- interimLocalTax: 中間納付地方消費税額（円、あれば）

## Step 3: 結果を確認

- **schedule2_3**: 付表2-3（課税売上割合・控除対象仕入税額）
  - 課税売上割合、95%ルール判定
  - 未分類 tax_code の警告
- **schedule1_3**: 付表1-3（税率別集計）
- **form1**: 第一表（①〜㉖全項目）
- **summary**: 納付/還付の判定と合計額

## 手動補正

useFreeeData=true のまま、0以外の値を指定した項目だけ上書き:
- standardRateSales: 標準税率10%の課税売上高
- reducedRateSales: 軽減税率8%の課税売上高
- nonQualifiedPurchases80: 適格請求書なし仕入（80%経過措置）

## 完全手動入力

useFreeeData=false で全パラメータを直接指定。

## 対応機能

- 複数税率（10%/8%）同時処理
- 個別対応方式 / 一括比例配分方式 / 全額控除の自動判定
- インボイス経過措置（80%/50%）— 用途別内訳対応
- 輸入取引（本体額・税額コード対応）
- 仕入返還・売上返還・貸倒れ・貸倒回収
- 有価証券譲渡5%ルール
- 地方消費税（22/78方式）
- 還付申告対応`,

  "consumption-tax-simplified": `# 消費税計算ワークフロー（簡易課税）

## Step 1: freee データをキャッシュ（一般課税と同じ手順）

## Step 2: 簡易課税を計算

calculate-consumption-tax-simplified を実行:
- fiscalYearId: "対象事業年度ID"
- useFreeeData: true
- interimNationalTax: 中間納付額
- interimLocalTax: 中間納付地方消費税額

freee で簡易課税用 tax_code（課売上一〜六、コード130-135/157-162）を使っている場合、
事業区分ごとの売上が自動集計される。

## 手動入力モード

useFreeeData=false の場合:
- salesByType: [
    { type: "1", standardRateSales: 20000000, reducedRateSales: 0 },
    { type: "5", standardRateSales: 30000000, reducedRateSales: 5000000 }
  ]

## みなし仕入率

| 事業区分 | 業種 | みなし仕入率 |
|---------|------|------------|
| 第一種 | 卸売業 | 90% |
| 第二種 | 小売業 | 80% |
| 第三種 | 製造業等 | 70% |
| 第四種 | その他 | 60% |
| 第五種 | サービス業 | 50% |
| 第六種 | 不動産業 | 40% |

75%特例の3パターン（1業種/2業種/標準）を自動判定し、最有利方式を選択。`,

  "corporate-tax": `# 法人税計算ワークフロー（個別別表）

## 計算順序（依存関係）

別表16(減価償却) → 別表15(交際費) → 別表8(受取配当) → 別表14(寄附金)
→ 別表4(所得計算) → 別表7(欠損金控除) → 別表6(税額控除)
→ 別表1(法人税額) → 別表5(二)(租税公課) → 別表5(一)(利益積立金)

## 主要ツール

- add-adjustment: 税務調整項目を登録（加算/減算、留保/社外流出）
- confirm-adjustment: 税務調整を確認
- calculate-schedule-04: 別表四（所得計算）
- calculate-schedule-01: 別表一（法人税額）
- calculate-all-schedules: 全別表を依存順序で一括計算
- validate-schedules: 整合性チェック`,

  "all-schedules": `# 全別表一括計算ワークフロー

## Step 1: 事前準備

1. set-company-info: 会社情報登録
2. init-fiscal-year: 事業年度作成
3. fetch-freee-data: freee データキャッシュ（試算表 + 仕訳）
4. import-prior-data: 前期データ取込（繰越欠損金等）

## Step 2: 税務調整

1. add-adjustment で調整項目を登録
   - 減価償却超過額、交際費損金不算入額 等
2. confirm-adjustment で各項目を確認

## Step 3: 一括計算

calculate-all-schedules を実行:
- fiscalYearId: "対象事業年度ID"
- netIncome: 当期純利益（円）
- priorInterimTax: 前期中間納付額
- totalEntertainment: 交際費支出額
- diningExpenseAmount: うち飲食費
- fiscalYearMonths: 事業年度月数（短期年度は12未満）

## Step 4: 検証・出力

1. validate-schedules: 別表間の整合性チェック
2. preview-return: 申告書プレビュー
3. export-etax-xml: e-Tax用XMLファイル出力`,
};

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

const handler = async (args: any) => {
  const { workflow } = args.params;
  const content = WORKFLOWS[workflow];
  if (!content) {
    return { content: [{ type: "text" as const, text: `ワークフロー '${workflow}' は見つかりません。` }] };
  }
  return { content: [{ type: "text" as const, text: content }] };
};

export const GetWorkflowTool: ToolDefinition<typeof schema> = {
  name: "get-workflow",
  description:
    "税務申告の計算手順ガイドを返します。消費税（一般課税/簡易課税）、法人税（全別表一括/個別）のワークフローを確認できます。" +
    "初回利用時や手順が不明な場合に呼び出してください。",
  schema,
  handler,
};
