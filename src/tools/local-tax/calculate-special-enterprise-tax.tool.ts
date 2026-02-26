import { z } from "zod";
import type { ToolDefinition } from "../../types/tool-definition.js";
import { getDb } from "../../db/client.js";
import { errorResult, jsonResult, formatError } from "../../helpers/format-error.js";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

const schema = z.object({
  fiscalYearId: z.string().describe("事業年度ID"),
});

const handler = async (args: any) => {
  try {
    const { fiscalYearId } = args.params;
    const db = getDb();

    const fy = db.prepare("SELECT * FROM fiscal_years WHERE id = ?").get(fiscalYearId) as any;
    if (!fy) return errorResult(`事業年度 ${fiscalYearId} が見つかりません。`);

    // Get enterprise tax result (need the standard rate amount as base)
    const enterpriseTaxResult = db.prepare(
      "SELECT result_data FROM schedule_results WHERE fiscal_year_id = ? AND schedule_number = 'enterprise-tax' ORDER BY version DESC LIMIT 1"
    ).get(fiscalYearId) as any;
    if (!enterpriseTaxResult) {
      return errorResult(`法人事業税が計算されていません。先に calculate-enterprise-tax を実行してください。`);
    }

    const etData = JSON.parse(enterpriseTaxResult.result_data);

    // Load Tokyo tax rates
    const tokyoRatesPath = resolve(__dirname, "../../data/master/tokyo-tax-rates.json");
    const tokyoRates = JSON.parse(readFileSync(tokyoRatesPath, "utf-8"));

    const specialRate = tokyoRates.enterpriseTax.specialCorporate.rate;

    // Special corporate enterprise tax is calculated on the STANDARD rate base
    const baseAmount = etData.summary.enterpriseTaxStandard;
    const specialTax = Math.floor(baseAmount * specialRate / 100) * 100;

    const result = {
      enterpriseTaxStandard: baseAmount,
      specialRate,
      specialEnterpriseTax: specialTax,
      note: "特別法人事業税 = 法人事業税（標準税率ベース） × 37%",
    };

    // Save
    const now = new Date().toISOString();
    const existing = db.prepare(
      "SELECT version FROM schedule_results WHERE fiscal_year_id = ? AND schedule_number = 'special-enterprise-tax' ORDER BY version DESC LIMIT 1"
    ).get(fiscalYearId) as any;
    const version = existing ? existing.version + 1 : 1;

    db.prepare(`
      INSERT INTO schedule_results (fiscal_year_id, schedule_number, version, input_data, result_data, is_valid, calculated_at)
      VALUES (?, 'special-enterprise-tax', ?, ?, ?, 1, ?)
    `).run(fiscalYearId, version, JSON.stringify({ baseAmount }), JSON.stringify(result), now);

    return jsonResult("特別法人事業税の計算", result);
  } catch (error) {
    return errorResult(formatError(error));
  }
};

export const CalculateSpecialEnterpriseTaxTool: ToolDefinition<typeof schema> = {
  name: "calculate-special-enterprise-tax",
  description: "特別法人事業税を計算します。法人事業税（標準税率ベース）× 37%。",
  schema,
  handler,
};
