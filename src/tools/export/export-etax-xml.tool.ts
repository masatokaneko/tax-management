import { z } from "zod";
import type { ToolDefinition } from "../../types/tool-definition.js";
import { getDb } from "../../db/client.js";
import { errorResult, successResult, formatError } from "../../helpers/format-error.js";
import { generateEtaxXml, extractFormData } from "../../services/xml-generator.service.js";
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(__dirname, "..", "..", "..");

const schema = z.object({
  fiscalYearId: z.string().describe("事業年度ID"),
  taxOfficeCode: z.string().describe("提出先税務署コード（例: 01101）"),
  taxOfficeName: z.string().describe("提出先税務署名（例: 麹町税務署）"),
  corporateNumber: z.string().describe("法人番号（13桁）"),
  representativeName: z.string().describe("代表者氏名"),
  outputDir: z.string().optional().describe("出力先ディレクトリ（省略時: data/export/）"),
});

const handler = async (args: any) => {
  try {
    const { fiscalYearId, taxOfficeCode, taxOfficeName, corporateNumber, representativeName, outputDir } = args.params;
    const db = getDb();

    // Validate inputs
    if (corporateNumber.length !== 13) {
      return errorResult("法人番号は13桁で入力してください。");
    }

    const fy = db.prepare("SELECT * FROM fiscal_years WHERE id = ?").get(fiscalYearId) as any;
    if (!fy) return errorResult(`事業年度 ${fiscalYearId} が見つかりません。`);

    const company = db.prepare("SELECT * FROM companies WHERE id = ?").get(fy.company_id) as any;
    if (!company) return errorResult("会社情報が見つかりません。");

    // Load form definitions
    const formDefsPath = resolve(__dirname, "../../data/etax/form-definitions.json");
    const formDefs = JSON.parse(readFileSync(formDefsPath, "utf-8"));

    // Load all schedule results
    const scheduleRows = db.prepare(
      "SELECT schedule_number, result_data FROM schedule_results WHERE fiscal_year_id = ? ORDER BY schedule_number, version DESC"
    ).all(fiscalYearId) as any[];

    const schedules: Record<string, any> = {};
    for (const row of scheduleRows) {
      if (!schedules[row.schedule_number]) {
        schedules[row.schedule_number] = JSON.parse(row.result_data);
      }
    }

    // Check minimum required schedules
    if (!schedules["04"] || !schedules["01"]) {
      return errorResult("別表四と別表一が計算されていません。先に calculate-all-schedules を実行してください。");
    }

    // Build form data from schedule results
    const forms = [];
    const scheduleMap: Record<string, string> = {
      "01": "schedule-01",
      "02": "schedule-02",
      "04": "schedule-04",
      "05-1": "schedule-05-1",
      "05-2": "schedule-05-2",
      "06": "schedule-06",
      "07": "schedule-07",
      "08": "schedule-08",
      "14": "schedule-14",
      "15": "schedule-15",
      "16": "schedule-16",
    };

    for (const [schedNum, defKey] of Object.entries(scheduleMap)) {
      if (schedules[schedNum] && formDefs.forms[defKey]) {
        const formData = extractFormData(schedNum, schedules[schedNum], formDefs.forms[defKey]);
        if (formData.fields.length > 0) {
          forms.push(formData);
        }
      }
    }

    // Generate XML
    const filingDate = new Date().toISOString().split("T")[0];
    const xml = generateEtaxXml({
      taxOfficeCode,
      taxOfficeName,
      corporateNumber,
      companyName: company.name,
      representativeName,
      fiscalYearStart: fy.start_date,
      fiscalYearEnd: fy.end_date,
      filingDate,
      forms,
    });

    // Write to file
    const exportDir = outputDir ?? resolve(PROJECT_ROOT, "data", "export");
    if (!existsSync(exportDir)) {
      mkdirSync(exportDir, { recursive: true });
    }

    const fileName = `法人税申告書_${fy.start_date}_${fy.end_date}.xtx`;
    const filePath = resolve(exportDir, fileName);
    writeFileSync(filePath, xml, "utf-8");

    // Save to filing history
    const now = new Date().toISOString();
    db.prepare(`
      INSERT INTO filing_history (fiscal_year_id, filing_type, format, file_path, generated_at, status)
      VALUES (?, 'corporate_tax', 'xml', ?, ?, 'generated')
    `).run(fiscalYearId, filePath, now);

    db.prepare(`
      INSERT INTO audit_log (fiscal_year_id, action, target, detail, timestamp)
      VALUES (?, 'export', 'etax_xml', ?, ?)
    `).run(fiscalYearId, JSON.stringify({ filePath, formCount: forms.length }), now);

    // Update status
    db.prepare("UPDATE fiscal_years SET status = 'exported', updated_at = ? WHERE id = ?")
      .run(now, fiscalYearId);

    return successResult(
      `e-Tax XMLファイルを生成しました。\n\n` +
      `ファイル: ${filePath}\n` +
      `含まれる帳票数: ${forms.length}\n` +
      `帳票一覧:\n${forms.map(f => `  - ${f.formId}: ${f.formName}`).join("\n")}\n\n` +
      `次のステップ:\n` +
      `1. e-Taxソフトを起動\n` +
      `2. 「申告・申請等」→「組み込み」で .xtx ファイルを読み込み\n` +
      `3. 内容を確認・修正\n` +
      `4. 電子署名を付与して送信\n\n` +
      `注意: 帳票フィールドコードは暫定値です。正式なe-Tax XML構造設計書を入手後に更新が必要です。`
    );
  } catch (error) {
    return errorResult(formatError(error));
  }
};

export const ExportEtaxXmlTool: ToolDefinition<typeof schema> = {
  name: "export-etax-xml",
  description: "e-Tax用XMLファイル（.xtx）を生成します。法人税申告書の全別表をXML形式で出力。",
  schema,
  handler,
};
