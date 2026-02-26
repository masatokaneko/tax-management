import { z } from "zod";
import type { ToolDefinition } from "../../types/tool-definition.js";
import { getDb } from "../../db/client.js";
import { errorResult, jsonResult, formatError } from "../../helpers/format-error.js";

const schema = z.object({
  id: z.number().int().describe("調整項目ID"),
  amount: z.number().int().optional().describe("金額（円・整数）"),
  itemName: z.string().optional().describe("項目名"),
  adjustmentType: z.enum(["addition", "deduction"]).optional().describe("加算/減算"),
  category: z.enum(["retained", "outflow"]).optional().describe("留保/社外流出"),
  description: z.string().optional().describe("説明・備考"),
});

const handler = async (args: any) => {
  try {
    const { id, ...updates } = args.params;
    const db = getDb();

    const existing = db.prepare("SELECT * FROM tax_adjustments WHERE id = ?").get(id) as any;
    if (!existing) return errorResult(`調整項目ID ${id} が見つかりません。`);

    const now = new Date().toISOString();
    const sets: string[] = ["updated_at = ?"];
    const values: any[] = [now];

    if (updates.amount !== undefined) { sets.push("amount = ?"); values.push(updates.amount); }
    if (updates.itemName !== undefined) { sets.push("item_name = ?"); values.push(updates.itemName); }
    if (updates.adjustmentType !== undefined) { sets.push("adjustment_type = ?"); values.push(updates.adjustmentType); }
    if (updates.category !== undefined) { sets.push("category = ?"); values.push(updates.category); }
    if (updates.description !== undefined) { sets.push("description = ?"); values.push(updates.description); }

    // Reset confirmation when updating
    sets.push("user_confirmed = 0");

    values.push(id);
    db.prepare(`UPDATE tax_adjustments SET ${sets.join(", ")} WHERE id = ?`).run(...values);

    const updated = db.prepare("SELECT * FROM tax_adjustments WHERE id = ?").get(id);
    return jsonResult("税務調整項目を更新しました（確認フラグはリセットされました）", updated);
  } catch (error) {
    return errorResult(formatError(error));
  }
};

export const UpdateAdjustmentTool: ToolDefinition<typeof schema> = {
  name: "update-adjustment",
  description: "税務調整項目を更新します。更新時に確認フラグは自動的にリセットされます。",
  schema,
  handler,
};
