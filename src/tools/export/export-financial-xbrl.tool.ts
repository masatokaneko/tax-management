import { z } from "zod";
import type { ToolDefinition } from "../../types/tool-definition.js";
import { getDb } from "../../db/client.js";
import { errorResult, successResult, formatError } from "../../helpers/format-error.js";
import { generateFinancialXbrl } from "../../services/xml-generator.service.js";
import { writeFileSync, mkdirSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(__dirname, "..", "..", "..");

const bsItemSchema = z.object({
  elementName: z.string().describe("XBRL要素名（例: CashAndDeposits, AccountsReceivableTrade）"),
  amount: z.number().int().describe("金額（円）"),
});

const plItemSchema = z.object({
  elementName: z.string().describe("XBRL要素名（例: NetSales, CostOfSales）"),
  amount: z.number().int().describe("金額（円）"),
});

const schema = z.object({
  fiscalYearId: z.string().describe("事業年度ID"),
  bsItems: z.array(bsItemSchema).describe("貸借対照表の項目一覧"),
  plItems: z.array(plItemSchema).describe("損益計算書の項目一覧"),
  outputDir: z.string().optional().describe("出力先ディレクトリ"),
});

const handler = async (args: any) => {
  try {
    const { fiscalYearId, bsItems, plItems, outputDir } = args.params;
    const db = getDb();

    const fy = db.prepare("SELECT * FROM fiscal_years WHERE id = ?").get(fiscalYearId) as any;
    if (!fy) return errorResult(`事業年度 ${fiscalYearId} が見つかりません。`);

    const company = db.prepare("SELECT * FROM companies WHERE id = ?").get(fy.company_id) as any;
    if (!company) return errorResult("会社情報が見つかりません。");

    // Convert arrays to records
    const bs: Record<string, number> = {};
    for (const item of bsItems) {
      bs[item.elementName] = item.amount;
    }
    const pl: Record<string, number> = {};
    for (const item of plItems) {
      pl[item.elementName] = item.amount;
    }

    const xbrl = generateFinancialXbrl({
      companyName: company.name,
      fiscalYearEnd: fy.end_date,
      bs,
      pl,
    });

    // Write to file
    const exportDir = outputDir ?? resolve(PROJECT_ROOT, "data", "export");
    if (!existsSync(exportDir)) {
      mkdirSync(exportDir, { recursive: true });
    }

    const fileName = `財務諸表_${fy.start_date}_${fy.end_date}.xbrl`;
    const filePath = resolve(exportDir, fileName);
    writeFileSync(filePath, xbrl, "utf-8");

    // Save to filing history
    const now = new Date().toISOString();
    db.prepare(`
      INSERT INTO filing_history (fiscal_year_id, filing_type, format, file_path, generated_at, status)
      VALUES (?, 'financial_statements', 'xbrl', ?, ?, 'generated')
    `).run(fiscalYearId, filePath, now);

    db.prepare(`
      INSERT INTO audit_log (fiscal_year_id, action, target, detail, timestamp)
      VALUES (?, 'export', 'financial_xbrl', ?, ?)
    `).run(fiscalYearId, JSON.stringify({ filePath, bsCount: bsItems.length, plCount: plItems.length }), now);

    return successResult(
      `財務諸表XBRLファイルを生成しました。\n\n` +
      `ファイル: ${filePath}\n` +
      `BS項目数: ${bsItems.length}\n` +
      `PL項目数: ${plItems.length}\n\n` +
      `次のステップ:\n` +
      `1. e-Taxソフトで法人税申告書に組み込み\n` +
      `2. 「帳票追加」→「財務諸表」で .xbrl ファイルを読み込み`
    );
  } catch (error) {
    return errorResult(formatError(error));
  }
};

export const ExportFinancialXbrlTool: ToolDefinition<typeof schema> = {
  name: "export-financial-xbrl",
  description: "財務諸表（BS/PL）をXBRL 2.1形式で出力します。e-Tax法人税申告に添付する財務諸表データ。",
  schema,
  handler,
};
