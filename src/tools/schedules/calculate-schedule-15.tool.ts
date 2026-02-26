import { z } from "zod";
import type { ToolDefinition } from "../../types/tool-definition.js";
import { getDb } from "../../db/client.js";
import { errorResult, jsonResult, formatError } from "../../helpers/format-error.js";

const schema = z.object({
  fiscalYearId: z.string().describe("事業年度ID"),
  totalEntertainment: z.number().int().describe("交際費等の支出額合計（円）"),
  diningExpenseAmount: z.number().int().default(0).describe("うち飲食費の額（円）"),
});

const SME_DEDUCTION_LIMIT = 8000000; // 中小法人の定額控除限度額: 800万円

const handler = async (args: any) => {
  try {
    const { fiscalYearId, totalEntertainment, diningExpenseAmount } = args.params;
    const db = getDb();

    const fy = db.prepare("SELECT * FROM fiscal_years WHERE id = ?").get(fiscalYearId) as any;
    if (!fy) return errorResult(`事業年度 ${fiscalYearId} が見つかりません。`);

    const company = db.prepare("SELECT * FROM companies WHERE id = ?").get(fy.company_id) as any;
    if (!company) return errorResult(`会社情報が見つかりません。`);

    const isSme = (company.capital_amount ?? 0) <= 100000000; // 資本金1億円以下

    // Method A: SME fixed deduction (800万円限度)
    const methodA_deductible = isSme ? Math.min(totalEntertainment, SME_DEDUCTION_LIMIT) : 0;
    const methodA_nonDeductible = totalEntertainment - methodA_deductible;

    // Method B: 50% of dining expenses
    const methodB_deductible = Math.floor(diningExpenseAmount * 0.5);
    const methodB_nonDeductible = totalEntertainment - methodB_deductible;

    // Choose the method that minimizes non-deductible amount
    let chosenMethod: string;
    let deductibleAmount: number;
    let nonDeductibleAmount: number;

    if (isSme) {
      // SME can choose either method
      if (methodA_nonDeductible <= methodB_nonDeductible) {
        chosenMethod = "A（定額控除限度額800万円）";
        deductibleAmount = methodA_deductible;
        nonDeductibleAmount = methodA_nonDeductible;
      } else {
        chosenMethod = "B（飲食費の50%損金算入）";
        deductibleAmount = methodB_deductible;
        nonDeductibleAmount = methodB_nonDeductible;
      }
    } else {
      // Large companies can only use method B
      chosenMethod = "B（飲食費の50%損金算入）";
      deductibleAmount = methodB_deductible;
      nonDeductibleAmount = methodB_nonDeductible;
    }

    const result = {
      totalEntertainment,
      diningExpenseAmount,
      isSme,
      methodA: {
        available: isSme,
        deductible: methodA_deductible,
        nonDeductible: methodA_nonDeductible,
      },
      methodB: {
        deductible: methodB_deductible,
        nonDeductible: methodB_nonDeductible,
      },
      chosenMethod,
      deductibleAmount,
      nonDeductibleAmount,
    };

    // Save
    const now = new Date().toISOString();
    const existing = db.prepare(
      "SELECT version FROM schedule_results WHERE fiscal_year_id = ? AND schedule_number = '15' ORDER BY version DESC LIMIT 1"
    ).get(fiscalYearId) as any;
    const version = existing ? existing.version + 1 : 1;

    db.prepare(`
      INSERT INTO schedule_results (fiscal_year_id, schedule_number, version, input_data, result_data, is_valid, calculated_at)
      VALUES (?, '15', ?, ?, ?, 1, ?)
    `).run(fiscalYearId, version, JSON.stringify({ totalEntertainment, diningExpenseAmount }), JSON.stringify(result), now);

    return jsonResult("別表十五（交際費等の損金不算入額の計算）", result);
  } catch (error) {
    return errorResult(formatError(error));
  }
};

export const CalculateSchedule15Tool: ToolDefinition<typeof schema> = {
  name: "calculate-schedule-15",
  description: "別表十五（交際費等の損金不算入額の計算に関する明細書）を計算します。中小法人800万円定額控除と飲食費50%特例の有利選択。",
  schema,
  handler,
};
