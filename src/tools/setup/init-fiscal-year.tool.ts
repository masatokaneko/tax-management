import { z } from "zod";
import type { ToolDefinition } from "../../types/tool-definition.js";
import { getDb } from "../../db/client.js";
import { errorResult, jsonResult, formatError } from "../../helpers/format-error.js";

const schema = z.object({
  fiscalYearId: z.string().describe("事業年度ID（例: '2025'）"),
  companyId: z.string().describe("freee会社ID"),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).describe("事業年度開始日（YYYY-MM-DD）"),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).describe("事業年度終了日（YYYY-MM-DD）"),
});

const handler = async (args: any) => {
  try {
    const { fiscalYearId, companyId, startDate, endDate } = args.params;
    const db = getDb();

    // Check company exists
    const company = db.prepare("SELECT id FROM companies WHERE id = ?").get(companyId) as any;
    if (!company) {
      return errorResult(`会社ID ${companyId} が見つかりません。先に set-company-info を実行してください。`);
    }

    // Check if fiscal year already exists
    const existing = db.prepare("SELECT id FROM fiscal_years WHERE id = ?").get(fiscalYearId) as any;
    if (existing) {
      return errorResult(`事業年度 ${fiscalYearId} は既に存在します。`);
    }

    const now = new Date().toISOString();
    db.prepare(`
      INSERT INTO fiscal_years (id, company_id, start_date, end_date, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, 'draft', ?, ?)
    `).run(fiscalYearId, companyId, startDate, endDate, now, now);

    // Audit log
    db.prepare(`
      INSERT INTO audit_log (fiscal_year_id, action, target, detail, timestamp)
      VALUES (?, 'create', 'fiscal_year', ?, ?)
    `).run(fiscalYearId, JSON.stringify({ startDate, endDate }), now);

    const fiscalYear = db.prepare("SELECT * FROM fiscal_years WHERE id = ?").get(fiscalYearId);
    return jsonResult("事業年度を作成しました", fiscalYear);
  } catch (error) {
    return errorResult(formatError(error));
  }
};

export const InitFiscalYearTool: ToolDefinition<typeof schema> = {
  name: "init-fiscal-year",
  description: "新しい事業年度を作成します。税務申告の最初のステップ。",
  schema,
  handler,
};
