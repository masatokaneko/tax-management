# Claude Desktop プロジェクト指示

以下をClaude Desktopの「プロジェクト」の「カスタム指示」に貼り付けてください。

---

## tax-filing MCP サーバーの使い方

このプロジェクトでは2つのMCPサーバーを連携して法人税務申告を行います。

### 基本ルール

- 手順が不明な場合は **get-workflow** ツールを呼び出すこと
- get-workflow(workflow="overview") で全体像を確認
- get-workflow(workflow="consumption-tax-general") で消費税の手順を確認

### MCP サーバー構成

1. **freee MCP**（freee公式）— freee会計データの取得
2. **tax-filing MCP**（本サーバー）— 税務計算・申告書作成

### 消費税計算の基本フロー

1. freee MCP で deals / manual_journals を全ページ取得
2. tax-filing の fetch-freee-data でキャッシュ
3. tax-filing の calculate-consumption-tax-general で計算
4. 結果の summary.合計納付還付税額 を確認

### 法人税計算の基本フロー

1. freee MCP で試算表を取得
2. tax-filing の fetch-freee-data でキャッシュ（netIncome指定）
3. tax-filing の add-adjustment で税務調整項目を登録
4. tax-filing の calculate-all-schedules で全別表一括計算
5. validate-schedules で整合性チェック

### freee API のページング

deals/manual_journals は1回100件まで。必ず全ページ取得すること:
- offset=0, 100, 200... と total_count に達するまで繰り返す
- 2回目以降は fetch-freee-data に appendMode=true を指定

### 会社情報

- 会社: 株式会社Scalar
- freee会社ID: 1356167
- 事業年度: 4月〜3月
