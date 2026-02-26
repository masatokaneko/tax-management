import { z } from "zod";
import type { ToolDefinition } from "../../types/tool-definition.js";
import { getDb } from "../../db/client.js";
import { errorResult, jsonResult, formatError } from "../../helpers/format-error.js";

const schema = z.object({
  fiscalYearId: z.string().describe("事業年度ID"),
  netIncome: z.number().int().describe("当期純利益（円・整数）。freee PL末尾の当期純損益を入力。"),
});

export interface Schedule04Result {
  netIncome: number;
  additions: Array<{ id: number; itemName: string; amount: number; category: string }>;
  deductions: Array<{ id: number; itemName: string; amount: number; category: string }>;
  additionTotal: number;
  deductionTotal: number;
  taxableIncome: number;
  retainedAdditionTotal: number;
  outflowAdditionTotal: number;
  retainedDeductionTotal: number;
  outflowDeductionTotal: number;
}

const handler = async (args: any) => {
  try {
    const { fiscalYearId, netIncome } = args.params;
    const db = getDb();

    // Check fiscal year
    const fy = db.prepare("SELECT id FROM fiscal_years WHERE id = ?").get(fiscalYearId) as any;
    if (!fy) return errorResult(`事業年度 ${fiscalYearId} が見つかりません。`);

    // Get confirmed tax adjustments only
    const adjustments = db.prepare(
      "SELECT * FROM tax_adjustments WHERE fiscal_year_id = ? AND user_confirmed = 1 ORDER BY adjustment_type, item_name"
    ).all(fiscalYearId) as any[];

    const additions = adjustments
      .filter(a => a.adjustment_type === "addition")
      .map(a => ({ id: a.id, itemName: a.item_name, amount: a.amount, category: a.category }));

    const deductions = adjustments
      .filter(a => a.adjustment_type === "deduction")
      .map(a => ({ id: a.id, itemName: a.item_name, amount: a.amount, category: a.category }));

    const additionTotal = additions.reduce((sum, a) => sum + a.amount, 0);
    const deductionTotal = deductions.reduce((sum, a) => sum + a.amount, 0);
    const taxableIncome = netIncome + additionTotal - deductionTotal;

    // Breakdown by category
    const retainedAdditionTotal = additions.filter(a => a.category === "retained").reduce((s, a) => s + a.amount, 0);
    const outflowAdditionTotal = additions.filter(a => a.category === "outflow").reduce((s, a) => s + a.amount, 0);
    const retainedDeductionTotal = deductions.filter(a => a.category === "retained").reduce((s, a) => s + a.amount, 0);
    const outflowDeductionTotal = deductions.filter(a => a.category === "outflow").reduce((s, a) => s + a.amount, 0);

    const result: Schedule04Result = {
      netIncome,
      additions,
      deductions,
      additionTotal,
      deductionTotal,
      taxableIncome,
      retainedAdditionTotal,
      outflowAdditionTotal,
      retainedDeductionTotal,
      outflowDeductionTotal,
    };

    // Save result
    const now = new Date().toISOString();
    const existingResult = db.prepare(
      "SELECT id, version FROM schedule_results WHERE fiscal_year_id = ? AND schedule_number = ? ORDER BY version DESC LIMIT 1"
    ).get(fiscalYearId, "04") as any;

    const version = existingResult ? existingResult.version + 1 : 1;

    db.prepare(`
      INSERT INTO schedule_results (fiscal_year_id, schedule_number, version, input_data, result_data, is_valid, calculated_at)
      VALUES (?, '04', ?, ?, ?, 1, ?)
    `).run(fiscalYearId, version, JSON.stringify({ netIncome }), JSON.stringify(result), now);

    db.prepare(`
      INSERT INTO audit_log (fiscal_year_id, action, target, detail, timestamp)
      VALUES (?, 'calculate', 'schedule_04', ?, ?)
    `).run(fiscalYearId, JSON.stringify({ version, taxableIncome }), now);

    return jsonResult("別表四（所得の金額の計算）", result);
  } catch (error) {
    return errorResult(formatError(error));
  }
};

export const CalculateSchedule04Tool: ToolDefinition<typeof schema> = {
  name: "calculate-schedule-04",
  description: "別表四（所得の金額の計算に関する明細書）を計算します。当期純利益と税務調整項目から課税所得を算出。",
  schema,
  handler,
};
