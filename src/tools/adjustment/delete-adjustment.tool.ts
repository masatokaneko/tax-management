import { z } from "zod";
import type { ToolDefinition } from "../../types/tool-definition.js";
import { getDb } from "../../db/client.js";
import { errorResult, successResult, formatError } from "../../helpers/format-error.js";

const schema = z.object({
  id: z.number().int().describe("削除する調整項目ID"),
});

const handler = async (args: any) => {
  try {
    const { id } = args.params;
    const db = getDb();

    const existing = db.prepare("SELECT * FROM tax_adjustments WHERE id = ?").get(id) as any;
    if (!existing) return errorResult(`調整項目ID ${id} が見つかりません。`);

    db.prepare("DELETE FROM tax_adjustments WHERE id = ?").run(id);

    const now = new Date().toISOString();
    db.prepare(`
      INSERT INTO audit_log (fiscal_year_id, action, target, detail, timestamp)
      VALUES (?, 'delete', ?, ?, ?)
    `).run(existing.fiscal_year_id, `adjustment_${id}`, JSON.stringify({ itemName: existing.item_name, amount: existing.amount }), now);

    return successResult(`調整項目「${existing.item_name}」(ID: ${id}) を削除しました。`);
  } catch (error) {
    return errorResult(formatError(error));
  }
};

export const DeleteAdjustmentTool: ToolDefinition<typeof schema> = {
  name: "delete-adjustment",
  description: "税務調整項目を削除します。",
  schema,
  handler,
};
