import { z } from "zod";
import type { ToolDefinition } from "../../types/tool-definition.js";
import { getDb } from "../../db/client.js";
import { errorResult, jsonResult, formatError } from "../../helpers/format-error.js";

const schema = z.object({
  fiscalYearId: z.string().describe("事業年度ID"),
  dataType: z.enum(["carried_loss", "retained_earnings", "prior_tax", "depreciation"])
    .describe("データ種別: carried_loss=繰越欠損金, retained_earnings=利益積立金, prior_tax=前期法人税額, depreciation=減価償却"),
  data: z.record(z.unknown()).describe("前期データ（JSON形式）"),
});

const handler = async (args: any) => {
  try {
    const { fiscalYearId, dataType, data } = args.params;
    const db = getDb();

    // Check fiscal year exists
    const fy = db.prepare("SELECT id FROM fiscal_years WHERE id = ?").get(fiscalYearId) as any;
    if (!fy) {
      return errorResult(`事業年度 ${fiscalYearId} が見つかりません。`);
    }

    // Delete existing data of the same type
    db.prepare("DELETE FROM prior_year_data WHERE fiscal_year_id = ? AND data_type = ?")
      .run(fiscalYearId, dataType);

    const now = new Date().toISOString();
    db.prepare(`
      INSERT INTO prior_year_data (fiscal_year_id, data_type, data_json, imported_at)
      VALUES (?, ?, ?, ?)
    `).run(fiscalYearId, dataType, JSON.stringify(data), now);

    // Audit log
    db.prepare(`
      INSERT INTO audit_log (fiscal_year_id, action, target, detail, timestamp)
      VALUES (?, 'import', ?, ?, ?)
    `).run(fiscalYearId, `prior_data_${dataType}`, JSON.stringify({ dataType }), now);

    return jsonResult(`前期データ（${dataType}）を取り込みました`, { fiscalYearId, dataType, data });
  } catch (error) {
    return errorResult(formatError(error));
  }
};

export const ImportPriorDataTool: ToolDefinition<typeof schema> = {
  name: "import-prior-data",
  description: "前期の申告データを手動入力します（繰越欠損金、利益積立金額、前期法人税額、減価償却データ）。",
  schema,
  handler,
};
