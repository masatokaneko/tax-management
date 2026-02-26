import { z } from "zod";
import type { ToolDefinition } from "../../types/tool-definition.js";
import { getDb } from "../../db/client.js";
import { errorResult, successResult, formatError } from "../../helpers/format-error.js";
import { generateEltaxXml } from "../../services/xml-generator.service.js";
import { writeFileSync, mkdirSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(__dirname, "..", "..", "..");

const schema = z.object({
  fiscalYearId: z.string().describe("事業年度ID"),
  municipalityCode: z.string().default("13100").describe("自治体コード（デフォルト: 13100=東京都特別区）"),
  municipalityName: z.string().default("東京都（特別区）").describe("自治体名"),
  corporateNumber: z.string().describe("法人番号（13桁）"),
  representativeName: z.string().describe("代表者氏名"),
  outputDir: z.string().optional().describe("出力先ディレクトリ"),
});

const handler = async (args: any) => {
  try {
    const { fiscalYearId, municipalityCode, municipalityName, corporateNumber, representativeName, outputDir } = args.params;
    const db = getDb();

    if (corporateNumber.length !== 13) {
      return errorResult("法人番号は13桁で入力してください。");
    }

    const fy = db.prepare("SELECT * FROM fiscal_years WHERE id = ?").get(fiscalYearId) as any;
    if (!fy) return errorResult(`事業年度 ${fiscalYearId} が見つかりません。`);

    const company = db.prepare("SELECT * FROM companies WHERE id = ?").get(fy.company_id) as any;
    if (!company) return errorResult("会社情報が見つかりません。");

    // Load local tax results
    const loadResult = (scheduleNumber: string) => {
      const row = db.prepare(
        "SELECT result_data FROM schedule_results WHERE fiscal_year_id = ? AND schedule_number = ? ORDER BY version DESC LIMIT 1"
      ).get(fiscalYearId, scheduleNumber) as any;
      return row ? JSON.parse(row.result_data) : null;
    };

    const residentTaxData = loadResult("resident-tax");
    const enterpriseTaxData = loadResult("enterprise-tax");
    const specialEnterpriseTaxData = loadResult("special-enterprise-tax");

    if (!residentTaxData && !enterpriseTaxData) {
      return errorResult("地方税（住民税・事業税）が計算されていません。先に calculate-resident-tax / calculate-enterprise-tax を実行してください。");
    }

    // Build eLTAX XML options
    const filingDate = new Date().toISOString().split("T")[0];

    const eltaxOptions: any = {
      municipalityCode,
      municipalityName,
      corporateNumber,
      companyName: company.name,
      representativeName,
      fiscalYearStart: fy.start_date,
      fiscalYearEnd: fy.end_date,
      filingDate,
    };

    const includedTaxes: string[] = [];

    if (residentTaxData) {
      eltaxOptions.residentTax = {
        prefecturalTaxOnIncome: residentTaxData.prefectural.taxOnIncome,
        prefecturalPerCapita: residentTaxData.prefectural.perCapita,
        municipalTaxOnIncome: residentTaxData.municipal.taxOnIncome,
        municipalPerCapita: residentTaxData.municipal.perCapita,
        totalResidentTax: residentTaxData.summary.totalResidentTax,
      };
      includedTaxes.push("法人住民税");
    }

    if (enterpriseTaxData) {
      eltaxOptions.enterpriseTax = {
        taxableIncome: enterpriseTaxData.taxableIncome,
        brackets: enterpriseTaxData.brackets.map((b: any) => ({
          taxableAmount: b.taxableAmount,
          rate: b.tokyoRate,
          tax: b.tokyoTax,
        })),
        totalEnterpriseTax: enterpriseTaxData.summary.enterpriseTaxTokyo,
      };
      includedTaxes.push("法人事業税");
    }

    if (specialEnterpriseTaxData) {
      eltaxOptions.specialEnterpriseTax = {
        baseAmount: specialEnterpriseTaxData.enterpriseTaxStandard,
        rate: specialEnterpriseTaxData.specialRate,
        tax: specialEnterpriseTaxData.specialEnterpriseTax,
      };
      includedTaxes.push("特別法人事業税");
    }

    // Generate XML
    const xml = generateEltaxXml(eltaxOptions);

    // Write to file
    const exportDir = outputDir ?? resolve(PROJECT_ROOT, "data", "export");
    if (!existsSync(exportDir)) {
      mkdirSync(exportDir, { recursive: true });
    }

    const fileName = `地方税申告書_${fy.start_date}_${fy.end_date}.xml`;
    const filePath = resolve(exportDir, fileName);
    writeFileSync(filePath, xml, "utf-8");

    // Save to filing history
    const now = new Date().toISOString();
    db.prepare(`
      INSERT INTO filing_history (fiscal_year_id, filing_type, format, file_path, generated_at, status)
      VALUES (?, 'local_tax', 'xml', ?, ?, 'generated')
    `).run(fiscalYearId, filePath, now);

    db.prepare(`
      INSERT INTO audit_log (fiscal_year_id, action, target, detail, timestamp)
      VALUES (?, 'export', 'eltax_xml', ?, ?)
    `).run(fiscalYearId, JSON.stringify({ filePath, includedTaxes }), now);

    return successResult(
      `eLTAX XMLファイルを生成しました。\n\n` +
      `ファイル: ${filePath}\n` +
      `含まれる税目: ${includedTaxes.join("、")}\n\n` +
      `次のステップ:\n` +
      `1. PCdesk（DL版）を起動\n` +
      `2. 「申告」→「ファイル取り込み」でXMLファイルを読み込み\n` +
      `3. 内容を確認・修正\n` +
      `4. 電子署名を付与して送信\n\n` +
      `注意: XML構造は暫定版です。eLTAX公開仕様書を入手後に更新が必要です。`
    );
  } catch (error) {
    return errorResult(formatError(error));
  }
};

export const ExportEltaxXmlTool: ToolDefinition<typeof schema> = {
  name: "export-eltax-xml",
  description: "eLTAX用XMLファイルを生成します。法人住民税・事業税・特別法人事業税の申告データを出力。",
  schema,
  handler,
};
