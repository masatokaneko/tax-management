import { z } from "zod";
import type { ToolDefinition } from "../../types/tool-definition.js";
import { getDb } from "../../db/client.js";
import { calculateCorporateTax } from "../../services/corporate-tax.service.js";
import { errorResult, jsonResult, formatError } from "../../helpers/format-error.js";

const schema = z.object({
  fiscalYearId: z.string().describe("事業年度ID"),
  priorInterimTax: z.number().int().default(0).describe("前期中間納付額（円）"),
  taxCredits: z.number().int().default(0).describe("税額控除額（別表六の結果。円）"),
  carriedLossDeduction: z.number().int().default(0).describe("繰越欠損金控除額（別表七の結果。円）"),
});

const handler = async (args: any) => {
  try {
    const { fiscalYearId, priorInterimTax, taxCredits, carriedLossDeduction } = args.params;
    const db = getDb();

    // Get fiscal year and company info
    const fy = db.prepare("SELECT * FROM fiscal_years WHERE id = ?").get(fiscalYearId) as any;
    if (!fy) return errorResult(`事業年度 ${fiscalYearId} が見つかりません。`);

    const company = db.prepare("SELECT * FROM companies WHERE id = ?").get(fy.company_id) as any;
    if (!company) return errorResult(`会社情報が見つかりません。先に set-company-info を実行してください。`);
    if (!company.capital_amount) return errorResult(`資本金が設定されていません。set-company-info で資本金を設定してください。`);

    // Get schedule 04 result (taxable income)
    const schedule04 = db.prepare(
      "SELECT result_data FROM schedule_results WHERE fiscal_year_id = ? AND schedule_number = '04' ORDER BY version DESC LIMIT 1"
    ).get(fiscalYearId) as any;
    if (!schedule04) return errorResult(`別表四が計算されていません。先に calculate-schedule-04 を実行してください。`);

    const schedule04Data = JSON.parse(schedule04.result_data);

    // Determine fiscal year for tax rates (from start date year)
    const fiscalYear = fy.start_date.substring(0, 4);

    const result = calculateCorporateTax({
      fiscalYear,
      taxableIncome: schedule04Data.taxableIncome,
      capitalAmount: company.capital_amount,
      priorInterimTax,
      taxCredits,
      carriedLossDeduction,
    });

    // Save result (exclude rates object for storage)
    const { rates, ...resultForStorage } = result;
    const now = new Date().toISOString();
    const existingResult = db.prepare(
      "SELECT id, version FROM schedule_results WHERE fiscal_year_id = ? AND schedule_number = '01' ORDER BY version DESC LIMIT 1"
    ).get(fiscalYearId) as any;
    const version = existingResult ? existingResult.version + 1 : 1;

    db.prepare(`
      INSERT INTO schedule_results (fiscal_year_id, schedule_number, version, input_data, result_data, is_valid, calculated_at)
      VALUES (?, '01', ?, ?, ?, 1, ?)
    `).run(
      fiscalYearId, version,
      JSON.stringify({ priorInterimTax, taxCredits, carriedLossDeduction }),
      JSON.stringify(resultForStorage), now,
    );

    db.prepare(`
      INSERT INTO audit_log (fiscal_year_id, action, target, detail, timestamp)
      VALUES (?, 'calculate', 'schedule_01', ?, ?)
    `).run(fiscalYearId, JSON.stringify({ version, nationalTaxPayable: result.nationalTaxPayable }), now);

    return jsonResult("別表一（法人税額の計算）", {
      ...resultForStorage,
      appliedRates: {
        fiscalYear,
        isSme: company.capital_amount <= rates.corporateTax.sme.capitalThreshold,
        corporateTaxRate: rates.corporateTax.standardRate,
        smeReducedRate: rates.corporateTax.sme.reducedRate,
        localCorporateTaxRate: rates.localCorporateTax.rate,
        defenseSpecialTaxApplicable: rates.defenseSpecialTax.applicable,
      },
    });
  } catch (error) {
    return errorResult(formatError(error));
  }
};

export const CalculateSchedule01Tool: ToolDefinition<typeof schema> = {
  name: "calculate-schedule-01",
  description: "別表一（各事業年度の所得に係る申告書）を計算します。別表四の課税所得から法人税額・地方法人税額を算出。",
  schema,
  handler,
};
