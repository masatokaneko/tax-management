import { z } from "zod";
import type { ToolDefinition } from "../../types/tool-definition.js";
import { getDb } from "../../db/client.js";
import { errorResult, jsonResult, formatError } from "../../helpers/format-error.js";

const schema = z.object({
  fiscalYearId: z.string().describe("事業年度ID"),
  generalDonations: z.number().int().default(0).describe("一般寄付金の額（円）"),
  designatedDonations: z.number().int().default(0).describe("特定公益増進法人等への寄付金の額（円）"),
  nationalLocalGovDonations: z.number().int().default(0).describe("国・地方公共団体への寄付金の額（円）"),
  fiscalYearMonths: z.number().int().default(12).describe("事業年度の月数"),
});

const handler = async (args: any) => {
  try {
    const { fiscalYearId, generalDonations, designatedDonations, nationalLocalGovDonations, fiscalYearMonths } = args.params;
    const db = getDb();

    const fy = db.prepare("SELECT * FROM fiscal_years WHERE id = ?").get(fiscalYearId) as any;
    if (!fy) return errorResult(`事業年度 ${fiscalYearId} が見つかりません。`);

    const company = db.prepare("SELECT * FROM companies WHERE id = ?").get(fy.company_id) as any;
    if (!company) return errorResult(`会社情報が見つかりません。`);
    if (!company.capital_amount) return errorResult(`資本金が設定されていません。`);

    // Get taxable income from schedule 04
    const schedule04 = db.prepare(
      "SELECT result_data FROM schedule_results WHERE fiscal_year_id = ? AND schedule_number = '04' ORDER BY version DESC LIMIT 1"
    ).get(fiscalYearId) as any;
    if (!schedule04) return errorResult(`別表四が計算されていません。先に calculate-schedule-04 を実行してください。`);

    const schedule04Data = JSON.parse(schedule04.result_data);
    const taxableIncome = schedule04Data.taxableIncome;

    // Use positive income for limit calculations (if negative, limits are zero)
    const incomeForCalc = Math.max(0, taxableIncome);

    // === 国・地方公共団体への寄付金: 全額損金算入 ===
    const govDeductible = nationalLocalGovDonations;

    // === 特定公益増進法人等への寄付金の特別損金算入限度額 ===
    // (資本金 × 0.375% × 月数/12 + 所得 × 6.25%) ÷ 2
    const designatedLimit = Math.floor(
      (Math.floor(company.capital_amount * 0.00375 * fiscalYearMonths / 12) +
       Math.floor(incomeForCalc * 0.0625)) / 2
    );
    const designatedDeductible = Math.min(designatedDonations, designatedLimit);
    const designatedExcess = designatedDonations - designatedDeductible;

    // === 一般寄付金の損金算入限度額 ===
    // (資本金 × 0.25% × 月数/12 + 所得 × 2.5%) ÷ 4
    const generalLimit = Math.floor(
      (Math.floor(company.capital_amount * 0.0025 * fiscalYearMonths / 12) +
       Math.floor(incomeForCalc * 0.025)) / 4
    );

    // 一般寄付金 = 一般寄付金 + 特定公益増進法人への寄付金の超過額
    const generalTotal = generalDonations + designatedExcess;
    const generalDeductible = Math.min(generalTotal, generalLimit);
    const generalNonDeductible = generalTotal - generalDeductible;

    const totalDonations = generalDonations + designatedDonations + nationalLocalGovDonations;
    const totalDeductible = govDeductible + designatedDeductible + generalDeductible;
    const totalNonDeductible = totalDonations - totalDeductible;

    const result = {
      capitalAmount: company.capital_amount,
      taxableIncome: incomeForCalc,
      fiscalYearMonths,
      nationalLocalGov: {
        amount: nationalLocalGovDonations,
        deductible: govDeductible,
        nonDeductible: 0,
        note: "全額損金算入",
      },
      designated: {
        amount: designatedDonations,
        limit: designatedLimit,
        deductible: designatedDeductible,
        excess: designatedExcess,
        note: "超過額は一般寄付金に含めて判定",
      },
      general: {
        amount: generalDonations,
        designatedExcessIncluded: designatedExcess,
        totalSubject: generalTotal,
        limit: generalLimit,
        deductible: generalDeductible,
        nonDeductible: generalNonDeductible,
      },
      summary: {
        totalDonations,
        totalDeductible,
        totalNonDeductible,
      },
    };

    // Save
    const now = new Date().toISOString();
    const existing = db.prepare(
      "SELECT version FROM schedule_results WHERE fiscal_year_id = ? AND schedule_number = '14' ORDER BY version DESC LIMIT 1"
    ).get(fiscalYearId) as any;
    const version = existing ? existing.version + 1 : 1;

    db.prepare(`
      INSERT INTO schedule_results (fiscal_year_id, schedule_number, version, input_data, result_data, is_valid, calculated_at)
      VALUES (?, '14', ?, ?, ?, 1, ?)
    `).run(
      fiscalYearId, version,
      JSON.stringify({ generalDonations, designatedDonations, nationalLocalGovDonations }),
      JSON.stringify(result), now,
    );

    return jsonResult("別表十四（寄付金の損金算入に関する明細書）", result);
  } catch (error) {
    return errorResult(formatError(error));
  }
};

export const CalculateSchedule14Tool: ToolDefinition<typeof schema> = {
  name: "calculate-schedule-14",
  description: "別表十四（寄付金の損金算入に関する明細書）を計算します。一般寄付金・特定公益増進法人寄付金・国等への寄付金の損金算入限度額を計算。",
  schema,
  handler,
};
