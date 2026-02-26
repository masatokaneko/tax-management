import { z } from "zod";
import type { ToolDefinition } from "../../types/tool-definition.js";
import { getDb } from "../../db/client.js";
import { errorResult, jsonResult, formatError } from "../../helpers/format-error.js";

const schema = z.object({
  companyId: z.string().describe("freee会社ID"),
  name: z.string().describe("会社名"),
  fiscalYearStartMonth: z.number().int().min(1).max(12).describe("決算開始月（1-12）"),
  capitalAmount: z.number().int().optional().describe("資本金（円）"),
  address: z.string().optional().describe("所在地"),
  municipalityCode: z.string().optional().describe("自治体コード"),
});

const handler = async (args: any) => {
  try {
    const { companyId, name, fiscalYearStartMonth, capitalAmount, address, municipalityCode } = args.params;
    const db = getDb();
    const now = new Date().toISOString();

    // Upsert company
    const existing = db.prepare("SELECT id FROM companies WHERE id = ?").get(companyId) as any;
    if (existing) {
      db.prepare(`
        UPDATE companies SET name = ?, fiscal_year_start_month = ?, capital_amount = ?,
        address = ?, municipality_code = ?, updated_at = ? WHERE id = ?
      `).run(name, fiscalYearStartMonth, capitalAmount ?? null, address ?? null, municipalityCode ?? null, now, companyId);
    } else {
      db.prepare(`
        INSERT INTO companies (id, name, fiscal_year_start_month, capital_amount, address, municipality_code, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(companyId, name, fiscalYearStartMonth, capitalAmount ?? null, address ?? null, municipalityCode ?? null, now, now);
    }

    const company = db.prepare("SELECT * FROM companies WHERE id = ?").get(companyId);
    return jsonResult("会社情報を設定しました", company);
  } catch (error) {
    return errorResult(formatError(error));
  }
};

export const SetCompanyInfoTool: ToolDefinition<typeof schema> = {
  name: "set-company-info",
  description: "会社情報を設定します（資本金、所在地、決算月など）。初回セットアップまたは情報更新時に使用。",
  schema,
  handler,
};
