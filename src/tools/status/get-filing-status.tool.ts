import { z } from "zod";
import type { ToolDefinition } from "../../types/tool-definition.js";
import { getDb } from "../../db/client.js";
import { errorResult, jsonResult, formatError } from "../../helpers/format-error.js";

const schema = z.object({
  fiscalYearId: z.string().describe("事業年度ID"),
});

const handler = async (args: any) => {
  try {
    const { fiscalYearId } = args.params;
    const db = getDb();

    const fy = db.prepare("SELECT * FROM fiscal_years WHERE id = ?").get(fiscalYearId) as any;
    if (!fy) {
      return errorResult(`事業年度 ${fiscalYearId} が見つかりません。`);
    }

    const company = db.prepare("SELECT * FROM companies WHERE id = ?").get(fy.company_id) as any;

    const adjustmentCount = db.prepare(
      "SELECT COUNT(*) as total, SUM(CASE WHEN user_confirmed = 1 THEN 1 ELSE 0 END) as confirmed FROM tax_adjustments WHERE fiscal_year_id = ?"
    ).get(fiscalYearId) as any;

    const schedules = db.prepare(
      "SELECT schedule_number, version, is_valid, calculated_at FROM schedule_results WHERE fiscal_year_id = ? ORDER BY schedule_number"
    ).all(fiscalYearId);

    const priorData = db.prepare(
      "SELECT data_type, imported_at FROM prior_year_data WHERE fiscal_year_id = ?"
    ).all(fiscalYearId);

    return jsonResult("申告進捗状況", {
      fiscalYear: fy,
      company,
      adjustments: {
        total: adjustmentCount.total,
        confirmed: adjustmentCount.confirmed,
        unconfirmed: adjustmentCount.total - adjustmentCount.confirmed,
      },
      calculatedSchedules: schedules,
      importedPriorData: priorData,
    });
  } catch (error) {
    return errorResult(formatError(error));
  }
};

export const GetFilingStatusTool: ToolDefinition<typeof schema> = {
  name: "get-filing-status",
  description: "現在の申告進捗状況を確認します。事業年度のステータス、税務調整の確認状況、計算済み別表の一覧を表示。",
  schema,
  handler,
};
