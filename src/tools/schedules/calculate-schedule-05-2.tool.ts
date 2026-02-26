import { z } from "zod";
import type { ToolDefinition } from "../../types/tool-definition.js";
import { getDb } from "../../db/client.js";
import { errorResult, jsonResult, formatError } from "../../helpers/format-error.js";

const schema = z.object({
  fiscalYearId: z.string().describe("事業年度ID"),
  priorCorporateTax: z.number().int().default(0).describe("前期確定法人税額（期中に納付した金額）"),
  priorLocalCorporateTax: z.number().int().default(0).describe("前期確定地方法人税額"),
  priorResidentTax: z.number().int().default(0).describe("前期確定住民税額"),
  priorEnterpriseTax: z.number().int().default(0).describe("前期確定事業税額"),
  interimCorporateTax: z.number().int().default(0).describe("中間納付法人税額"),
  interimLocalCorporateTax: z.number().int().default(0).describe("中間納付地方法人税額"),
  interimResidentTax: z.number().int().default(0).describe("中間納付住民税額"),
  interimEnterpriseTax: z.number().int().default(0).describe("中間納付事業税額"),
});

const handler = async (args: any) => {
  try {
    const p = args.params;
    const db = getDb();

    const fy = db.prepare("SELECT id FROM fiscal_years WHERE id = ?").get(p.fiscalYearId) as any;
    if (!fy) return errorResult(`事業年度 ${p.fiscalYearId} が見つかりません。`);

    // Get schedule 01 result for current period amounts
    const schedule01 = db.prepare(
      "SELECT result_data FROM schedule_results WHERE fiscal_year_id = ? AND schedule_number = '01' ORDER BY version DESC LIMIT 1"
    ).get(p.fiscalYearId) as any;
    if (!schedule01) return errorResult(`別表一が計算されていません。先に calculate-schedule-01 を実行してください。`);

    const s01 = JSON.parse(schedule01.result_data);

    const result = {
      corporateTax: {
        priorConfirmed: p.priorCorporateTax,
        interim: p.interimCorporateTax,
        currentConfirmed: s01.corporateTaxAfterCredits,
        periodPaid: p.priorCorporateTax + p.interimCorporateTax,
      },
      localCorporateTax: {
        priorConfirmed: p.priorLocalCorporateTax,
        interim: p.interimLocalCorporateTax,
        currentConfirmed: s01.localCorporateTax,
        periodPaid: p.priorLocalCorporateTax + p.interimLocalCorporateTax,
      },
      residentTax: {
        priorConfirmed: p.priorResidentTax,
        interim: p.interimResidentTax,
        currentConfirmed: 0, // Will be filled from local tax calculation
        periodPaid: p.priorResidentTax + p.interimResidentTax,
      },
      enterpriseTax: {
        priorConfirmed: p.priorEnterpriseTax,
        interim: p.interimEnterpriseTax,
        currentConfirmed: 0, // Will be filled from local tax calculation
        periodPaid: p.priorEnterpriseTax + p.interimEnterpriseTax,
      },
      summary: {
        totalPriorConfirmed: p.priorCorporateTax + p.priorLocalCorporateTax + p.priorResidentTax + p.priorEnterpriseTax,
        totalInterim: p.interimCorporateTax + p.interimLocalCorporateTax + p.interimResidentTax + p.interimEnterpriseTax,
        totalCurrentConfirmed: s01.corporateTaxAfterCredits + s01.localCorporateTax,
      },
    };

    // Save
    const now = new Date().toISOString();
    const existing = db.prepare(
      "SELECT id, version FROM schedule_results WHERE fiscal_year_id = ? AND schedule_number = '05-2' ORDER BY version DESC LIMIT 1"
    ).get(p.fiscalYearId) as any;
    const version = existing ? existing.version + 1 : 1;

    db.prepare(`
      INSERT INTO schedule_results (fiscal_year_id, schedule_number, version, input_data, result_data, is_valid, calculated_at)
      VALUES (?, '05-2', ?, ?, ?, 1, ?)
    `).run(p.fiscalYearId, version, JSON.stringify(p), JSON.stringify(result), now);

    return jsonResult("別表五(二)（租税公課の納付状況等の明細書）", result);
  } catch (error) {
    return errorResult(formatError(error));
  }
};

export const CalculateSchedule05_2Tool: ToolDefinition<typeof schema> = {
  name: "calculate-schedule-05-2",
  description: "別表五(二)（租税公課の納付状況等の明細書）を計算します。前期確定税額・中間納付額・当期確定税額の整理。",
  schema,
  handler,
};
