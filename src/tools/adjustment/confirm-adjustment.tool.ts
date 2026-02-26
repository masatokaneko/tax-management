import { z } from "zod";
import type { ToolDefinition } from "../../types/tool-definition.js";
import { getDb } from "../../db/client.js";
import { errorResult, jsonResult, formatError } from "../../helpers/format-error.js";

const schema = z.object({
  ids: z.array(z.number().int()).describe("確認する調整項目IDの配列"),
});

const handler = async (args: any) => {
  try {
    const { ids } = args.params;
    const db = getDb();
    const now = new Date().toISOString();

    const confirmed: any[] = [];
    const notFound: number[] = [];

    for (const id of ids) {
      const existing = db.prepare("SELECT * FROM tax_adjustments WHERE id = ?").get(id) as any;
      if (!existing) {
        notFound.push(id);
        continue;
      }

      db.prepare("UPDATE tax_adjustments SET user_confirmed = 1, updated_at = ? WHERE id = ?").run(now, id);
      confirmed.push({ id, itemName: existing.item_name, amount: existing.amount });

      db.prepare(`
        INSERT INTO audit_log (fiscal_year_id, action, target, detail, timestamp)
        VALUES (?, 'confirm', ?, ?, ?)
      `).run(existing.fiscal_year_id, `adjustment_${id}`, JSON.stringify({ itemName: existing.item_name }), now);
    }

    return jsonResult("税務調整項目を確認済みにしました", { confirmed, notFound });
  } catch (error) {
    return errorResult(formatError(error));
  }
};

export const ConfirmAdjustmentTool: ToolDefinition<typeof schema> = {
  name: "confirm-adjustment",
  description: "税務調整項目を確認済みにマークします。複数の項目を一括確認可能。",
  schema,
  handler,
};
