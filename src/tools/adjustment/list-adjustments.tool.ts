import { z } from "zod";
import type { ToolDefinition } from "../../types/tool-definition.js";
import { getDb } from "../../db/client.js";
import { errorResult, jsonResult, formatError } from "../../helpers/format-error.js";

const schema = z.object({
  fiscalYearId: z.string().describe("事業年度ID"),
  adjustmentType: z.enum(["addition", "deduction"]).optional().describe("フィルタ: 加算/減算"),
  confirmedOnly: z.boolean().optional().describe("確認済みのみ表示"),
});

const handler = async (args: any) => {
  try {
    const { fiscalYearId, adjustmentType, confirmedOnly } = args.params;
    const db = getDb();

    let sql = "SELECT * FROM tax_adjustments WHERE fiscal_year_id = ?";
    const params: any[] = [fiscalYearId];

    if (adjustmentType) {
      sql += " AND adjustment_type = ?";
      params.push(adjustmentType);
    }
    if (confirmedOnly) {
      sql += " AND user_confirmed = 1";
    }

    sql += " ORDER BY adjustment_type, item_name";
    const adjustments = db.prepare(sql).all(...params);

    // Summary
    const additions = (adjustments as any[]).filter(a => a.adjustment_type === "addition");
    const deductions = (adjustments as any[]).filter(a => a.adjustment_type === "deduction");
    const additionTotal = additions.reduce((sum: number, a: any) => sum + a.amount, 0);
    const deductionTotal = deductions.reduce((sum: number, a: any) => sum + a.amount, 0);

    return jsonResult("税務調整項目一覧", {
      summary: {
        total: (adjustments as any[]).length,
        additionCount: additions.length,
        additionTotal,
        deductionCount: deductions.length,
        deductionTotal,
        unconfirmed: (adjustments as any[]).filter(a => !a.user_confirmed).length,
      },
      adjustments,
    });
  } catch (error) {
    return errorResult(formatError(error));
  }
};

export const ListAdjustmentsTool: ToolDefinition<typeof schema> = {
  name: "list-adjustments",
  description: "税務調整項目の一覧を表示します。加算/減算の合計・未確認件数も表示。",
  schema,
  handler,
};
