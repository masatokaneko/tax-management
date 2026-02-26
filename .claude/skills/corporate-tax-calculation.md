# 法人税計算ワークフロー

freee会計データから法人税申告書（全別表）を作成するためのエンドツーエンド手順。

## 前提条件

- tax-filing MCPサーバーが接続済み
- freee会計MCPサーバー（freee MCP）が接続済み
- freee会社ID: 1356167（デフォルト）

## 全体フロー概要

```
freee MCP でデータ取得
  ↓
tax-filing MCP で会社設定・事業年度作成
  ↓
freee データをキャッシュ（fetch-freee-data）
  ↓
税務調整項目の登録・確認（add-adjustment → confirm-adjustment）
  ↓
全別表の一括計算（calculate-all-schedules）
  ↓
地方税の計算（住民税 → 事業税 → 特別法人事業税）
  ↓
整合性チェック（validate-schedules）
  ↓
プレビュー・出力（preview-return → export-etax-xml / export-eltax-xml）
```

## Step 1: freee会計からデータを取得

### 1-1. 会社情報を取得

```
freee MCPの freee_api_get で会社情報を取得:
  path: "/api/1/companies/1356167"

取得すべき情報:
  - display_name: 会社名
  - corporate_number: 法人番号（13桁）
  - head_office_address: 所在地
  - fiscal_year_start_month: 決算開始月（freee側の設定値は-1月ずれることがあるので注意）
```

### 1-2. 試算表（PL）を取得して当期純利益を確認

```
freee MCPの freee_api_get で損益計算書を取得:
  path: "/api/1/reports/profit_and_loss"
  params: company_id=1356167&fiscal_year=2025&start_month=4&end_month=3

→ PLの「当期純利益」を読み取る（section: "net_income" の closing_balance）
```

### 1-3. 勘定科目マスタを取得

```
freee MCPの freee_api_get:
  path: "/api/1/account_items"
  params: company_id=1356167

→ 交際費・寄附金・減価償却費などの勘定科目IDを特定する
```

### 1-4. 取引データ・振替伝票を取得（消費税計算にも使用）

```
freee MCPの freee_api_get:
  path: "/api/1/deals"
  params: company_id=1356167&limit=100&offset=0&start_issue_date=2025-04-01&end_issue_date=2026-03-31

※ 100件ずつページング。total_count に達するまで offset を増やして繰り返し取得。

freee MCPの freee_api_get:
  path: "/api/1/manual_journals"
  params: company_id=1356167&limit=100&offset=0&start_issue_date=2025-04-01&end_issue_date=2026-03-31
```

## Step 2: tax-filing MCP に会社情報と事業年度を設定

### 2-1. 会社情報の登録

```
tax-filing MCPの set-company-info:
  - companyId: "1356167"          ← freee会社ID
  - name: "株式会社○○"            ← freeeから取得した会社名
  - fiscalYearStartMonth: 4       ← 決算開始月
  - capitalAmount: 10000000       ← 資本金（円・整数）
  - address: "東京都千代田区..."    ← 所在地（任意）
```

**重要**: capitalAmount（資本金）は法人税の税率区分（中小法人判定: 1億円以下かどうか）に影響するため、正確な値を設定すること。

### 2-2. 事業年度の作成

```
tax-filing MCPの init-fiscal-year:
  - fiscalYearId: "2025"          ← 任意のID（開始年をおすすめ）
  - companyId: "1356167"
  - startDate: "2025-04-01"       ← 事業年度開始日
  - endDate: "2026-03-31"         ← 事業年度終了日
```

## Step 3: freee データをキャッシュ

取得したfreeeデータをtax-filing MCPのSQLiteにキャッシュする。

```
tax-filing MCPの fetch-freee-data:
  - fiscalYearId: "2025"
  - dataType: "trial_balance"
  - data: {freeeから取得したPLデータ}
  - netIncome: 8000000             ← PLから読み取った当期純利益（円）

tax-filing MCPの fetch-freee-data:
  - fiscalYearId: "2025"
  - dataType: "deals"
  - data: {freeeから取得した取引データ}

tax-filing MCPの fetch-freee-data:
  - fiscalYearId: "2025"
  - dataType: "manual_journals"
  - data: {freeeから取得した振替伝票データ}

tax-filing MCPの fetch-freee-data:
  - fiscalYearId: "2025"
  - dataType: "accounts"
  - data: {freeeから取得した勘定科目マスタ}
```

## Step 4: 税務調整項目の分析と登録

freeeの会計データ（当期純利益）と税務上の所得金額の差異を調整する。freeeのPL・仕訳データを分析し、税務調整が必要な項目を特定する。

### 4-1. 加算項目（会計上は費用だが税務上は損金不算入）

freeeの仕訳データから以下を抽出し、add-adjustment で登録する:

| 項目 | freeeでの確認方法 | adjustmentType | category |
|------|------------------|----------------|----------|
| 交際費等の損金不算入額 | 交際費勘定の合計額を確認 → 別表十五で自動計算 | addition | retained |
| 寄附金の損金不算入額 | 寄附金勘定の合計額を確認 → 別表十四で自動計算 | addition | outflow |
| 減価償却の償却超過額 | 減価償却費 vs 税法上の限度額 → 別表十六で自動計算 | addition | retained |
| 法人税・住民税 | PLの「法人税、住民税及び事業税」の額 | addition | outflow |
| 役員報酬の損金不算入額 | 役員報酬のうち損金不算入部分（定期同額を超える部分等） | addition | outflow |
| 貸倒引当金の繰入超過額 | 会計上の引当金繰入 - 税法上の限度額 | addition | retained |

### 4-2. 減算項目（会計上は収益だが税務上は益金不算入、等）

| 項目 | freeeでの確認方法 | adjustmentType | category |
|------|------------------|----------------|----------|
| 受取配当等の益金不算入額 | 受取配当金勘定 → 別表八で自動計算 | deduction | outflow |
| 所得税額控除 | 源泉徴収された所得税（預金利息等） → 別表六で自動計算 | deduction | outflow |

### 4-3. 別表十五・十四・十六・八・六で自動計算される項目

以下の項目は calculate-all-schedules に直接パラメータを渡すことで、対応する別表が自動計算される。自動計算の結果は別表四の調整項目として自動反映 **されない** ため、計算結果を確認してから add-adjustment で手動登録する必要がある。

**運用方法**:
1. まず交際費・寄附金等のパラメータ付きで calculate-all-schedules を実行
2. 別表十五・十四等の計算結果（損金不算入額）を確認
3. その金額を add-adjustment で登録・confirm
4. 別表四を再計算（calculate-all-schedules を再度実行、または calculate-schedule-04 を個別実行）

### 4-4. 調整項目の登録

```
tax-filing MCPの add-adjustment:
  - fiscalYearId: "2025"
  - adjustmentType: "addition"        ← 加算 or "deduction"（減算）
  - category: "retained"              ← 留保 or "outflow"（社外流出）
  - itemName: "法人税、住民税及び事業税" ← 項目名
  - amount: 1500000                   ← 金額（円）
  - description: "PLの法人税等"        ← 備考（任意）
```

### 4-5. 調整項目の確認（必須）

```
tax-filing MCPの confirm-adjustment:
  - ids: [1, 2, 3]                    ← 確認する調整項目IDの配列
```

**重要**: 別表四は `user_confirmed = 1` の調整項目のみを集計する。未確認の項目は計算に含まれない。list-adjustments で一覧を確認し、全項目を confirm すること。

## Step 5: 全別表の一括計算

```
tax-filing MCPの calculate-all-schedules:
  - fiscalYearId: "2025"
  - netIncome: 8000000                ← 当期純利益（円・整数）

  # 別表十六用（減価償却）
  - assets: [
      {
        name: "建物",
        acquisitionDate: "2020-04-01",
        acquisitionCost: 50000000,
        usefulLife: 22,
        method: "straight_line",
        priorAccumulatedDepreciation: 11363636,
        currentBookDepreciation: 2272727
      }
    ]

  # 別表十五用（交際費）
  - totalEntertainment: 10000000      ← 交際費等の支出額合計（円）
  - diningExpenseAmount: 6000000      ← うち飲食費の額（円）

  # 別表十四用（寄附金）
  - generalDonations: 500000          ← 一般寄付金の額（円）
  - designatedDonations: 200000       ← 特定公益増進法人等への寄付金（円）
  - nationalLocalGovDonations: 0      ← 国・地方公共団体への寄付金（円）

  # 別表八用（受取配当）
  - dividends: [
      {
        payerName: "○○株式会社",
        ownershipCategory: "non_controlling",
        dividendAmount: 100000,
        relatedDebtInterest: 0
      }
    ]

  # 別表七用（繰越欠損金）
  - carriedLosses: [
      {
        fiscalYear: "2023",
        originalAmount: 5000000,
        usedPriorYears: 0
      }
    ]

  # 別表六用（源泉所得税控除）
  - withheldTaxes: [
      {
        source: "預金利息",
        payerName: "○○銀行",
        grossAmount: 10000,
        withheldTax: 1531
      }
    ]

  # 別表一用
  - priorInterimTax: 0               ← 前期中間納付法人税額（円）

  # 別表五(二)用
  - priorCorporateTax: 500000        ← 前期確定法人税額
  - priorLocalCorporateTax: 51500    ← 前期確定地方法人税額
  - priorResidentTax: 120000         ← 前期確定住民税額
  - priorEnterpriseTax: 200000       ← 前期確定事業税額

  # 別表五(一)用
  - priorRetainedEarnings: 3000000   ← 期首利益積立金額

  # 別表二用（同族会社判定）
  - totalShares: 100                 ← 発行済株式総数
  - shareholders: [
      { name: "山田太郎", shares: 60, isRelatedPerson: false, groupName: "山田グループ" },
      { name: "山田花子", shares: 30, isRelatedPerson: true, groupName: "山田グループ" },
      { name: "田中一郎", shares: 10, isRelatedPerson: false }
    ]

  - fiscalYearMonths: 12             ← 事業年度の月数（デフォルト12）
  - force: false                     ← 未確認調整項目があればエラーにする
```

### 計算される別表と順序

```
Phase 1: 独立別表
  別表16（減価償却） → 別表15（交際費） → 別表08（受取配当）

Phase 2: 所得計算
  別表04（課税所得 = 当期純利益 + 加算 - 減算）

Phase 3: 所得依存
  別表14（寄附金の損金算入限度額。別表04の所得を使用）
  別表07（繰越欠損金控除。別表04の所得を使用）

Phase 4: 税額控除
  別表06（所得税額控除）

Phase 5: 法人税額
  別表01（法人税 + 地方法人税 + 防衛特別法人税）

Phase 6: 租税公課の整理
  別表05(二)（前期確定額・中間納付額・当期確定額）
  別表05(一)（利益積立金の期末残高）

Phase 7: 独立
  別表02（同族会社判定）
```

## Step 6: 地方税の計算

一括計算には含まれないため、別途順番に実行する。

### 6-1. 法人住民税

```
tax-filing MCPの calculate-resident-tax:
  - fiscalYearId: "2025"
  - employeeCount: 5                 ← 従業員数（均等割の判定に使用）
  - fiscalYearMonths: 12             ← 事業年度の月数
```

### 6-2. 法人事業税

```
tax-filing MCPの calculate-enterprise-tax:
  - fiscalYearId: "2025"
  - fiscalYearMonths: 12
```

### 6-3. 特別法人事業税

```
tax-filing MCPの calculate-special-enterprise-tax:
  - fiscalYearId: "2025"
```

**重要**: 必ずこの順序（住民税 → 事業税 → 特別法人事業税）で実行する。特別法人事業税は事業税の計算結果に依存する。

## Step 7: 整合性チェック

```
tax-filing MCPの validate-schedules:
  - fiscalYearId: "2025"
```

チェック内容:
- 必須別表（04, 01, 05-1, 05-2）が全て計算済みか
- 別表四→別表一の課税所得が整合しているか
- 別表五(一)の期末残高 = 期首残高 + 当期増減 か
- 法人税額が非負か
- 課税所得 > 0 なら法人税額 > 0 か

## Step 8: 結果確認と出力

### 8-1. プレビュー

```
tax-filing MCPの preview-return:
  - fiscalYearId: "2025"
```

Markdown形式で全別表の概要が表示される。

### 8-2. e-Tax用XML出力（国税）

```
tax-filing MCPの export-etax-xml:
  - fiscalYearId: "2025"
  - taxOfficeCode: "01101"           ← 提出先税務署コード
  - taxOfficeName: "麹町税務署"       ← 提出先税務署名
  - corporateNumber: "1234567890123"  ← 法人番号（13桁）
  - representativeName: "山田太郎"    ← 代表者氏名
```

### 8-3. eLTAX用XML出力（地方税）

```
tax-filing MCPの export-eltax-xml:
  - fiscalYearId: "2025"
  - prefectureCode: "13"             ← 都道府県コード
  - municipalityCode: "13101"        ← 市区町村コード
  - corporateNumber: "1234567890123"
  - representativeName: "山田太郎"
```

## 法人税額の計算ロジック

### 別表一の計算フロー

```
① 課税所得（別表四） - 繰越欠損金（別表七） = 欠損金控除後所得
② ①を1,000円未満切捨て = 課税標準額
③ 中小法人（資本金1億円以下）:
   - 800万円以下: 15%（年800万円は月数按分しない）
   - 800万円超: 23.2%
   大法人: 23.2%
④ 法人税額 = ③の結果（100円未満切捨て）
⑤ 税額控除（別表六の所得税額控除等）を差し引き
⑥ 地方法人税 = ⑤ × 10.3%（100円未満切捨て）
⑦ 防衛特別法人税 = (⑤ - 500万円) × 4%（100円未満切捨て）
   ※ 2026年4月1日以後開始事業年度から適用（事業年度開始日で判定）
⑧ 合計国税 = ⑤ + ⑥ + ⑦
⑨ 差引納付税額 = ⑧ - 中間納付額
```

### 端数処理ルール

| 項目 | ルール |
|------|--------|
| 課税標準額（課税所得） | 1,000円未満切捨て |
| 法人税額 | 100円未満切捨て |
| 地方法人税額 | 100円未満切捨て |
| 防衛特別法人税額 | 100円未満切捨て |
| 法人事業税 | 100円未満切捨て |

## 地方税の計算ロジック

### 法人住民税（東京都）

```
法人税割:
  道府県民税分 = 法人税額（税額控除前） × 1.77%（東京都超過税率）
  市町村民税分 = 法人税額（税額控除前） × 5.95%（東京都超過税率）

均等割:
  道府県民税分 = 20,000円 × 月数/12
  市町村民税分 = 資本金・従業員数による区分（50,000円〜3,000,000円）× 月数/12
```

### 法人事業税（東京都超過税率・3段階累進）

```
400万円以下: 3.48%
400万円超800万円以下: 5.21%
800万円超: 6.95%
※ 課税標準 = 別表四の所得 - 繰越欠損金控除後
※ 短期事業年度は各段階の境界額を月数按分
```

### 特別法人事業税

```
特別法人事業税 = 法人事業税（標準税率ベース） × 37%
```

## 別表間の主要な連携

| 参照元 | 参照先 | 参照データ |
|--------|--------|-----------:|
| 別表04 | tax_adjustments | 確認済み調整項目（加算・減算） |
| 別表14 | 別表04 | 課税所得（限度額計算用） |
| 別表07 | 別表04 | 課税所得（控除対象額） |
| 別表01 | 別表04 | 課税所得 |
| 別表01 | 別表07 | 繰越欠損金控除額 |
| 別表01 | 別表06 | 税額控除額 |
| 別表05(二) | 別表01 | 当期確定法人税額・地方法人税額 |
| 別表05(一) | 別表04 | 留保加算・減算 |
| 別表05(一) | 別表05(二) | 納税充当金 |
| 住民税 | 別表01 | 法人税額 |
| 事業税 | 別表04+07 | 課税所得（欠損金控除後） |
| 特別法人事業税 | 事業税 | 法人事業税（標準税率ベース） |

## 消費税の計算

消費税の計算は別スキル「consumption-tax-calculation」を参照。法人税申告と同時に消費税申告を行う場合は、Step 1で取得した取引データ（deals, manual_journals）を消費税計算にも使用する。

## freee APIのページング

freee APIは1回のコールで最大100件。全件取得するにはoffsetパラメータで繰り返し取得が必要:

```
/api/1/deals?company_id=1356167&limit=100&offset=0
/api/1/deals?company_id=1356167&limit=100&offset=100
...（total_countに達するまで）
```

## トラブルシューティング

### 「未確認の税務調整項目があります」エラー

→ `confirm-adjustment` で ids を指定して確認済みにするか、`force: true` で強制実行。

### 別表四の課税所得が想定と異なる

→ `list-adjustments` で調整項目一覧を確認。`user_confirmed = 1` の項目のみが集計される。未確認項目がないか確認すること。

### 防衛特別法人税が計算されない/される

→ 事業年度の開始日が2026-04-01以降かどうかで適用判定。`init-fiscal-year` の startDate を確認。

### 法人事業税が過大

→ 繰越欠損金がある場合、事業税は欠損金控除後の所得で計算される。別表07の計算が事前に必要。

### 交際費の損金不算入額が想定と異なる

→ 800万円の定額控除限度額は `fiscalYearMonths` で月数按分される（例: 6ヶ月の場合400万円）。`calculate-all-schedules` に正しい `fiscalYearMonths` を渡しているか確認。

### freeeのデータが取得できない

→ freee MCP（https://github.com/freee/freee-mcp）が起動していることを確認。`freee_auth_status` でfreeeの認証状態を確認し、未認証なら `freee_authenticate` で認証する。

### 前期データの入力

前期の法人税額や繰越欠損金などは `import-prior-data` でも登録できる:

```
tax-filing MCPの import-prior-data:
  - fiscalYearId: "2025"
  - dataType: "prior_tax"
  - data: { corporateTax: 500000, localCorporateTax: 51500 }
```
