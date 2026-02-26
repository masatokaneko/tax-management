# 法人税計算ワークフロー

法人税申告書の全別表を計算するための手順。

## 前提条件

- tax-filing MCPサーバーが接続済み
- freee会計MCPサーバー（freee MCP）が接続済み（freeeデータ連携時）
- 会社情報が `set-company-info` で登録済み
- 事業年度が `init-fiscal-year` で作成済み

## 一括計算の手順

### Step 1: 会社情報と事業年度の設定

```
1. tax-filing MCPの set-company-info を実行:
   - name: "会社名"
   - freeeCompanyId: "freee会社ID"（任意）
   - fiscalYearStartMonth: 決算開始月
   - capitalAmount: 資本金（円・整数）
   - address: 所在地（任意）

2. tax-filing MCPの init-fiscal-year を実行:
   - companyId: "会社ID"
   - startDate: "2024-04-01"
   - endDate: "2025-03-31"
```

### Step 2: 税務調整項目の登録

当期純利益と税務上の所得の差異（加算・減算項目）を登録する。

```
1. tax-filing MCPの add-adjustment で項目を追加:
   - fiscalYearId: "事業年度ID"
   - adjustmentType: "addition"（加算）or "deduction"（減算）
   - category: "retained"（留保）or "outflow"（社外流出）
   - itemName: "項目名"
   - amount: 金額（円）

2. 登録した項目を confirm-adjustment で確認済みにする:
   - ids: [調整項目IDの配列]
```

**重要**: 別表四は `user_confirmed = 1` の調整項目のみを集計する。未確認の項目は計算に含まれない。

**代表的な加算項目:**
- 交際費等の損金不算入額（別表十五の結果）
- 寄附金の損金不算入額（別表十四の結果）
- 減価償却の償却超過額（別表十六の結果）
- 法人税・住民税（損金不算入）
- 役員報酬の損金不算入額

**代表的な減算項目:**
- 受取配当等の益金不算入額（別表八の結果）
- 所得税額控除（別表六の結果）

### Step 3: 全別表の一括計算

```
tax-filing MCPの calculate-all-schedules を実行:
  - fiscalYearId: "事業年度ID"
  - netIncome: 当期純利益（円・整数）

  # 別表十六用（減価償却）
  - assets: [{name, acquisitionDate, acquisitionCost, usefulLife, method, currentBookDepreciation, ...}]

  # 別表十五用（交際費）
  - totalEntertainment: 交際費等の支出額合計（円）
  - diningExpenseAmount: うち飲食費の額（円）

  # 別表十四用（寄附金）
  - generalDonations: 一般寄付金の額（円）
  - designatedDonations: 特定公益増進法人等への寄付金の額（円）
  - nationalLocalGovDonations: 国・地方公共団体への寄付金の額（円）

  # 別表八用（受取配当）
  - dividends: [{payerName, ownershipCategory, dividendAmount, relatedDebtInterest}]

  # 別表七用（繰越欠損金）
  - carriedLosses: [{fiscalYear, originalAmount, usedPriorYears}]

  # 別表六用（源泉所得税控除）
  - withheldTaxes: [{source, payerName, grossAmount, withheldTax}]

  # 別表一用
  - priorInterimTax: 前期中間納付法人税額（円）

  # 別表五(二)用
  - priorCorporateTax: 前期確定法人税額
  - priorLocalCorporateTax: 前期確定地方法人税額
  - priorResidentTax: 前期確定住民税額
  - priorEnterpriseTax: 前期確定事業税額

  # 別表五(一)用
  - priorRetainedEarnings: 期首利益積立金額

  # 別表二用（同族会社判定）
  - totalShares: 発行済株式総数
  - shareholders: [{name, shares, isRelatedPerson, groupName}]

  - fiscalYearMonths: 事業年度の月数（デフォルト12）
  - force: true（未確認調整項目があっても実行する場合）
```

### Step 4: 地方税の計算

一括計算には含まれないため、別途実行する。

```
1. calculate-resident-tax（法人住民税）:
   - fiscalYearId: "事業年度ID"
   - employeeCount: 従業員数
   - fiscalYearMonths: 事業年度の月数

2. calculate-enterprise-tax（法人事業税）:
   - fiscalYearId: "事業年度ID"
   - fiscalYearMonths: 事業年度の月数

3. calculate-special-enterprise-tax（特別法人事業税）:
   - fiscalYearId: "事業年度ID"
```

**注意**: この順序で実行する。事業税 → 特別法人事業税の依存関係がある。

### Step 5: 整合性チェック

```
tax-filing MCPの validate-schedules を実行:
  - fiscalYearId: "事業年度ID"
```

チェック内容:
- 必須別表（04, 01, 05-1, 05-2）が全て計算済みか
- 別表四→別表一の課税所得が整合しているか
- 別表五(一)の期末残高 = 期首残高 + 当期増減 か
- 法人税額が非負か

### Step 6: 結果確認と出力

```
1. preview-return で申告書プレビュー
2. export-etax-xml でe-Tax用XML出力
3. export-eltax-xml でeLTAX用XML出力
```

## 計算順序（依存関係）

calculate-all-schedules は以下の順で計算する:

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

Phase 8: 独立
  別表02（同族会社判定）
```

## 法人税額の計算ロジック

### 別表一の計算フロー

```
① 課税所得（別表四） - 繰越欠損金（別表七） = 欠損金控除後所得
② ①を1,000円未満切捨て = 課税標準額
③ 中小法人（資本金1億円以下）:
   - 800万円以下: 15% （年800万円は月数按分しない）
   - 800万円超: 23.2%
   大法人: 23.2%
④ 法人税額 = ③の結果（100円未満切捨て）
⑤ 税額控除（別表六の所得税額控除等）を差し引き
⑥ 地方法人税 = ⑤ × 10.3%（100円未満切捨て）
⑦ 防衛特別法人税 = (⑤ - 500万円) × 4%（100円未満切捨て）
   ※ 2026年4月1日以後開始事業年度から適用
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
|--------|--------|-----------|
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

## トラブルシューティング

### 「未確認の税務調整項目があります」エラー

→ `confirm-adjustment` で ids を指定して確認済みにするか、`force: true` で強制実行。

### 別表四の課税所得が想定と異なる

→ `list-adjustments` で調整項目一覧を確認。user_confirmed = 1 の項目のみが集計される。

### 防衛特別法人税が計算されない/される

→ 事業年度の開始日が2026-04-01以降かどうかで適用判定。税率ファイル（corporate-tax-YYYY.json）のstartDateと照合。

### 法人事業税が過大

→ 繰越欠損金がある場合、事業税は欠損金控除後の所得で計算される。別表07を先に計算しているか確認。

### 交際費の損金不算入額が想定と異なる

→ 800万円の定額控除限度額は fiscalYearMonths で月数按分される（例: 6ヶ月の場合400万円）。
