# CLAUDE.md - freee法人税申告MCPサーバー

## プロジェクト概要

freee会計データを用いた法人税務申告自動化MCPサーバー。Claude Codeをインターフェースとし、税務調整推定→別表計算→整合性チェック→電子申告ファイル出力を実現。

## 技術スタック

- **言語**: TypeScript (ESM)
- **MCP SDK**: @modelcontextprotocol/sdk ^1.27 (`registerTool()` API)
- **DB**: SQLite (node:sqlite 組み込みモジュール)
- **バリデーション**: Zod ^3.24
- **テスト**: Vitest
- **トランスポート**: stdio

## コマンド

- **ビルド**: `npm run build`
- **テスト**: `npm test`
- **テスト(watch)**: `npm run test:watch`
- **型チェック**: `npm run lint`
- **開発(watch)**: `npm run dev`

## ディレクトリ構造

```
src/
├── index.ts          # エントリポイント（shebang付き）
├── server.ts         # McpServer初期化
├── constants.ts      # 定数
├── types/            # 型定義
├── schemas/          # Zodスキーマ
├── tools/            # MCPツール群
│   ├── setup/        # セットアップ系
│   ├── data/         # データ取得系
│   ├── adjustment/   # 税務調整系
│   ├── schedules/    # 別表計算
│   ├── validation/   # 整合性チェック
│   ├── export/       # 出力
│   └── status/       # ステータス管理
├── services/         # ビジネスロジック
├── helpers/          # ヘルパー
├── db/               # DB接続・スキーマ
└── data/             # 税率テーブルJSON
    ├── tax-rates/    # 年度別税率
    └── master/       # マスタデータ
```

## 規約

- 金額は全て整数（円単位）。浮動小数点は使用禁止
- 端数処理: 課税所得は1000円未満切捨て、税額は100円未満切捨て
- 別表番号は2桁ゼロ埋め文字列: "01", "04", "05-1", "05-2" 等
- SQLiteはWALモード + 外部キー制約有効
- テストファイルは `test/` ディレクトリに配置
- コード内変数名・コメントは英語、ドキュメントは日本語

## freee会社情報

- **初期ターゲット**: 株式会社Scalar（freee会社ID: 1356167）
- **事業年度**: freee APIから取得（想定: 4月〜3月）

## MCP設定

`~/.mcp.json` に以下を追加して利用:
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
