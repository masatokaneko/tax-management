import { z } from "zod";
import type { ToolDefinition } from "../../types/tool-definition.js";
import { getDb } from "../../db/client.js";
import { errorResult, jsonResult, formatError } from "../../helpers/format-error.js";

const schema = z.object({
  fiscalYearId: z.string().describe("事業年度ID"),
  adjustmentType: z.enum(["addition", "deduction"]).describe("加算(addition) / 減算(deduction)"),
  category: z.enum(["retained", "outflow"]).describe("留保(retained) / 社外流出(outflow)"),
  itemName: z.string().describe("調整項目名（例: '交際費等の損金不算入額'）"),
  amount: z.number().int().describe("金額（円・整数）"),
  scheduleRef: z.string().optional().describe("参照別表番号"),
  description: z.string().optional().describe("説明・備考"),
  sourceJournalIds: z.array(z.number()).optional().describe("根拠仕訳IDの配列"),
  aiEstimated: z.boolean().optional().default(false).describe("AI推定フラグ"),
});

const handler = async (args: any) => {
  try {
    const p = args.params;
    const db = getDb();

    // Check fiscal year exists
    const fy = db.prepare("SELECT id FROM fiscal_years WHERE id = ?").get(p.fiscalYearId) as any;
    if (!fy) return errorResult(`事業年度 ${p.fiscalYearId} が見つかりません。`);

    const now = new Date().toISOString();
    const result = db.prepare(`
      INSERT INTO tax_adjustments (fiscal_year_id, adjustment_type, category, item_name, schedule_ref, amount, description, source_journal_ids, ai_estimated, user_confirmed, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)
    `).run(
      p.fiscalYearId, p.adjustmentType, p.category, p.itemName,
      p.scheduleRef ?? null, p.amount, p.description ?? null,
      p.sourceJournalIds ? JSON.stringify(p.sourceJournalIds) : null,
      p.aiEstimated ? 1 : 0, now, now
    );

    // Audit log
    db.prepare(`
      INSERT INTO audit_log (fiscal_year_id, action, target, detail, timestamp)
      VALUES (?, 'adjust', ?, ?, ?)
    `).run(p.fiscalYearId, `adjustment_${result.lastInsertRowid}`, JSON.stringify({ itemName: p.itemName, amount: p.amount }), now);

    const adjustment = db.prepare("SELECT * FROM tax_adjustments WHERE id = ?").get(result.lastInsertRowid);
    return jsonResult("税務調整項目を追加しました", adjustment);
  } catch (error) {
    return errorResult(formatError(error));
  }
};

export const AddAdjustmentTool: ToolDefinition<typeof schema> = {
  name: "add-adjustment",
  description: "税務調整項目を追加します（加算/減算、留保/社外流出）。AI推定結果の登録にも使用。",
  schema,
  handler,
};
