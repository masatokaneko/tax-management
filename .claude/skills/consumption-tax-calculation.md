# 消費税計算ワークフロー

freee会計データから消費税申告書を計算するための手順。

## 前提条件

- tax-filing MCPサーバーが接続済み
- freee会計MCPサーバー（accounting-mcp）が接続済み
- 事業年度がinit-fiscal-yearで作成済み

## 一般課税の計算手順

### Step 1: freeeから仕訳データを取得してキャッシュ

freee MCPで取引データと振替伝票を取得し、tax-filing MCPにキャッシュする。

```
1. freee MCPの freee_api_get で /api/1/deals を取得（全ページ）
2. freee MCPの freee_api_get で /api/1/manual_journals を取得（全ページ）
3. tax-filing MCPの fetch-freee-data で deals をキャッシュ
   - fiscalYearId: "対象事業年度ID"
   - dataType: "deals"
   - data: {取得したdealsデータ}
4. tax-filing MCPの fetch-freee-data で manual_journals をキャッシュ
   - fiscalYearId: "対象事業年度ID"
   - dataType: "manual_journals"
   - data: {取得したmanual_journalsデータ}
```

**重要**: freee APIの取引データには `details[].tax_code` フィールドがある。これが消費税区分コードで、aggregatorが自動分類に使用する。

### Step 2: 一般課税を計算

```
tax-filing MCPの calculate-consumption-tax-general を実行:
  - fiscalYearId: "対象事業年度ID"
  - useFreeeData: true（freee自動集計モード）
  - deductionMethod: "individual"（個別対応方式。一括比例配分なら"proportional"）
  - interimNationalTax: 中間納付額があれば指定（円）
  - interimLocalTax: 中間納付地方消費税額があれば指定（円）
```

### Step 3: 結果を確認

結果には以下が含まれる:

- **schedule2_3**: 付表2-3（課税売上割合・控除対象仕入税額）
  - 課税売上割合、95%ルール判定、控除方式
  - 未分類tax_codeがある場合は警告表示
- **schedule1_3**: 付表1-3（税率別集計）
- **form1**: 第一表（①～㉖の全項目）
- **summary**: 納付/還付の判定と合計額
- **meta**: 集計件数、未分類コード情報

### 手動補正が必要な場合

freeeデータの自動集計結果を部分的に上書きできる:

```
calculate-consumption-tax-general:
  - useFreeeData: true
  - standardRateSales: 50000000  ← この値で上書き（0以外を指定した項目のみ）
```

### 完全手動入力モード

freeeデータを使わず全て手動入力する場合:

```
calculate-consumption-tax-general:
  - useFreeeData: false
  - standardRateSales: 50000000
  - reducedRateSales: 10000000
  - exemptSales: 0
  - nonTaxableSales: 5000000
  - taxablePurchases: 30000000
  - nonTaxablePurchases: 2000000
  - commonPurchases: 5000000
  - deductionMethod: "individual"
```

## 簡易課税の計算手順

### Step 1: freeeデータのキャッシュ（一般課税と同じ）

### Step 2: 簡易課税を計算

```
tax-filing MCPの calculate-consumption-tax-simplified を実行:
  - fiscalYearId: "対象事業年度ID"
  - useFreeeData: true
  - interimNationalTax: 中間納付額
  - interimLocalTax: 中間納付地方消費税額
```

freeeで簡易課税用のtax_code（課売上一～課売上六、コード130-135/157-162）を使っている場合、事業区分ごとの売上が自動集計される。

### 手動入力モード

```
calculate-consumption-tax-simplified:
  - useFreeeData: false
  - salesByType: [
      { type: "1", standardRateSales: 20000000, reducedRateSales: 0 },
      { type: "5", standardRateSales: 30000000, reducedRateSales: 5000000 }
    ]
```

## 結果の読み方

### 合計納付還付税額がプラス → 納付

```
summary.判定: "納付"
summary.合計納付還付税額: 1234500  ← この金額を納付
```

### 合計納付還付税額がマイナス → 還付

```
summary.判定: "還付"
summary.合計納付還付税額: -567800  ← この金額が還付される
```

### 未分類tax_codeの警告が出た場合

meta.警告に表示される。対象のtax_codeをfreeeの税区分設定で確認し、必要に応じてtax-code-mapping.tsにマッピングを追加する。

## トラブルシューティング

### freee_cacheにデータがないエラー

→ Step 1でfreeeデータのキャッシュを実行してから再試行。

### 課税売上割合が想定と異なる

→ 有価証券譲渡（5%算入ルール）や売上返還の影響を確認。schedule2_3の詳細を確認。

### 仕入税額が過大/過少

→ 仕入返還が正しく反映されているか確認。schedule2_3.仕入返還税額を確認。
→ インボイス経過措置の80%/50%控除が適用されているか確認。

### freee APIのページング

deals/manual_journalsは1回のAPIコールで最大100件。全件取得するにはoffsetパラメータで繰り返し取得が必要:

```
/api/1/deals?company_id=1356167&limit=100&offset=0
/api/1/deals?company_id=1356167&limit=100&offset=100
...（total_countに達するまで）
```
