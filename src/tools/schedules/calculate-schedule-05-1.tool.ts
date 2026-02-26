import { z } from "zod";
import type { ToolDefinition } from "../../types/tool-definition.js";
import { getDb } from "../../db/client.js";
import { errorResult, jsonResult, formatError } from "../../helpers/format-error.js";

const schema = z.object({
  fiscalYearId: z.string().describe("事業年度ID"),
  priorRetainedEarnings: z.number().int().default(0).describe("期首利益積立金額（前期末の利益積立金額合計）"),
});

const handler = async (args: any) => {
  try {
    const { fiscalYearId, priorRetainedEarnings } = args.params;
    const db = getDb();

    const fy = db.prepare("SELECT id FROM fiscal_years WHERE id = ?").get(fiscalYearId) as any;
    if (!fy) return errorResult(`事業年度 ${fiscalYearId} が見つかりません。`);

    // Get schedule 04 for retained amounts
    const schedule04 = db.prepare(
      "SELECT result_data FROM schedule_results WHERE fiscal_year_id = ? AND schedule_number = '04' ORDER BY version DESC LIMIT 1"
    ).get(fiscalYearId) as any;
    if (!schedule04) return errorResult(`別表四が計算されていません。先に calculate-schedule-04 を実行してください。`);

    // Get schedule 05-2 for tax payments
    const schedule052 = db.prepare(
      "SELECT result_data FROM schedule_results WHERE fiscal_year_id = ? AND schedule_number = '05-2' ORDER BY version DESC LIMIT 1"
    ).get(fiscalYearId) as any;
    if (!schedule052) return errorResult(`別表五(二)が計算されていません。先に calculate-schedule-05-2 を実行してください。`);

    const s04 = JSON.parse(schedule04.result_data);
    const s052 = JSON.parse(schedule052.result_data);

    // 利益積立金の増減 = 別表四の「留保」欄の差引合計
    // 増: 当期利益の留保分 + 加算留保項目
    // 減: 減算留保項目
    const retainedIncrease = s04.netIncome + s04.retainedAdditionTotal - s04.retainedDeductionTotal;

    // 納税充当金（未払法人税等の増減）
    const taxProvision = s052.summary.totalCurrentConfirmed;
    const taxPayments = s052.summary.totalPriorConfirmed + s052.summary.totalInterim;

    const result = {
      beginningBalance: priorRetainedEarnings,
      changes: {
        retainedIncrease,
        taxProvisionIncrease: taxProvision,
        taxPaymentsDecrease: taxPayments,
        netChange: retainedIncrease + taxProvision - taxPayments,
      },
      endingBalance: priorRetainedEarnings + retainedIncrease + taxProvision - taxPayments,
      breakdown: {
        netIncome: s04.netIncome,
        retainedAdditions: s04.retainedAdditionTotal,
        retainedDeductions: s04.retainedDeductionTotal,
        currentTaxLiability: taxProvision,
        priorTaxPayments: s052.summary.totalPriorConfirmed,
        interimTaxPayments: s052.summary.totalInterim,
      },
    };

    // Save
    const now = new Date().toISOString();
    const existing = db.prepare(
      "SELECT id, version FROM schedule_results WHERE fiscal_year_id = ? AND schedule_number = '05-1' ORDER BY version DESC LIMIT 1"
    ).get(fiscalYearId) as any;
    const version = existing ? existing.version + 1 : 1;

    db.prepare(`
      INSERT INTO schedule_results (fiscal_year_id, schedule_number, version, input_data, result_data, is_valid, calculated_at)
      VALUES (?, '05-1', ?, ?, ?, 1, ?)
    `).run(fiscalYearId, version, JSON.stringify({ priorRetainedEarnings }), JSON.stringify(result), now);

    return jsonResult("別表五(一)（利益積立金額及び資本金等の額の計算に関する明細書）", result);
  } catch (error) {
    return errorResult(formatError(error));
  }
};

export const CalculateSchedule05_1Tool: ToolDefinition<typeof schema> = {
  name: "calculate-schedule-05-1",
  description: "別表五(一)（利益積立金額の計算）を計算します。期首利益積立金額に当期の増減を反映して期末残高を算出。",
  schema,
  handler,
};
