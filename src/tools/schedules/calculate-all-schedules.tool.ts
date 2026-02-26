import { z } from "zod";
import type { ToolDefinition } from "../../types/tool-definition.js";
import { getDb } from "../../db/client.js";
import { SCHEDULE_DEPENDENCY_GRAPH } from "../../constants.js";
import { errorResult, jsonResult, formatError } from "../../helpers/format-error.js";

const schema = z.object({
  fiscalYearId: z.string().describe("事業年度ID"),
  netIncome: z.number().int().describe("当期純利益（円・整数）"),
  priorInterimTax: z.number().int().default(0).describe("前期中間納付法人税額"),
  taxCredits: z.number().int().default(0).describe("税額控除額"),
  carriedLossDeduction: z.number().int().default(0).describe("繰越欠損金控除額"),
  priorRetainedEarnings: z.number().int().default(0).describe("期首利益積立金額"),
  priorCorporateTax: z.number().int().default(0).describe("前期確定法人税額"),
  priorLocalCorporateTax: z.number().int().default(0).describe("前期確定地方法人税額"),
  priorResidentTax: z.number().int().default(0).describe("前期確定住民税額"),
  priorEnterpriseTax: z.number().int().default(0).describe("前期確定事業税額"),
  force: z.boolean().optional().describe("未確認の調整項目があっても強制実行"),
});

const handler = async (args: any) => {
  try {
    const p = args.params;
    const db = getDb();

    // Check fiscal year
    const fy = db.prepare("SELECT * FROM fiscal_years WHERE id = ?").get(p.fiscalYearId) as any;
    if (!fy) return errorResult(`事業年度 ${p.fiscalYearId} が見つかりません。`);

    // Check unconfirmed adjustments
    if (!p.force) {
      const unconfirmed = db.prepare(
        "SELECT COUNT(*) as count FROM tax_adjustments WHERE fiscal_year_id = ? AND user_confirmed = 0"
      ).get(p.fiscalYearId) as any;
      if (unconfirmed.count > 0) {
        return errorResult(
          `未確認の税務調整項目が ${unconfirmed.count} 件あります。confirm-adjustment で確認するか、force: true で強制実行してください。`
        );
      }
    }

    // Topological order for Phase 1 schedules: 04 → 01 → 05-2 → 05-1
    const calculationOrder = ["04", "01", "05-2", "05-1"];
    const results: Record<string, any> = {};
    const errors: string[] = [];

    for (const scheduleNum of calculationOrder) {
      try {
        switch (scheduleNum) {
          case "04": {
            // Import and call the schedule 04 handler logic directly
            const { CalculateSchedule04Tool } = await import("./calculate-schedule-04.tool.js");
            const result = await CalculateSchedule04Tool.handler(
              { params: { fiscalYearId: p.fiscalYearId, netIncome: p.netIncome } },
              {} as any,
            );
            results["04"] = result;
            break;
          }
          case "01": {
            const { CalculateSchedule01Tool } = await import("./calculate-schedule-01.tool.js");
            const result = await CalculateSchedule01Tool.handler(
              { params: {
                fiscalYearId: p.fiscalYearId,
                priorInterimTax: p.priorInterimTax,
                taxCredits: p.taxCredits,
                carriedLossDeduction: p.carriedLossDeduction,
              } },
              {} as any,
            );
            results["01"] = result;
            break;
          }
          case "05-2": {
            const { CalculateSchedule05_2Tool } = await import("./calculate-schedule-05-2.tool.js");
            const result = await CalculateSchedule05_2Tool.handler(
              { params: {
                fiscalYearId: p.fiscalYearId,
                priorCorporateTax: p.priorCorporateTax,
                priorLocalCorporateTax: p.priorLocalCorporateTax,
                priorResidentTax: p.priorResidentTax,
                priorEnterpriseTax: p.priorEnterpriseTax,
                interimCorporateTax: 0,
                interimLocalCorporateTax: 0,
                interimResidentTax: 0,
                interimEnterpriseTax: 0,
              } },
              {} as any,
            );
            results["05-2"] = result;
            break;
          }
          case "05-1": {
            const { CalculateSchedule05_1Tool } = await import("./calculate-schedule-05-1.tool.js");
            const result = await CalculateSchedule05_1Tool.handler(
              { params: {
                fiscalYearId: p.fiscalYearId,
                priorRetainedEarnings: p.priorRetainedEarnings,
              } },
              {} as any,
            );
            results["05-1"] = result;
            break;
          }
        }
      } catch (err) {
        errors.push(`別表${scheduleNum}: ${formatError(err)}`);
        break; // Stop on error
      }
    }

    // Update fiscal year status
    const now = new Date().toISOString();
    if (errors.length === 0) {
      db.prepare("UPDATE fiscal_years SET status = 'calculated', updated_at = ? WHERE id = ?")
        .run(now, p.fiscalYearId);
    }

    db.prepare(`
      INSERT INTO audit_log (fiscal_year_id, action, target, detail, timestamp)
      VALUES (?, 'calculate', 'all_schedules', ?, ?)
    `).run(p.fiscalYearId, JSON.stringify({
      calculated: calculationOrder.filter(s => results[s]),
      errors,
    }), now);

    if (errors.length > 0) {
      return jsonResult("一括計算（一部エラー）", { calculated: Object.keys(results), errors });
    }

    return jsonResult("全別表の一括計算が完了しました", {
      calculationOrder,
      status: "calculated",
      message: "全別表の計算が正常に完了しました。validate-schedules で整合性チェックを実行してください。",
    });
  } catch (error) {
    return errorResult(formatError(error));
  }
};

export const CalculateAllSchedulesTool: ToolDefinition<typeof schema> = {
  name: "calculate-all-schedules",
  description: "全別表を依存関係の正しい順序で一括計算します。税務調整項目が確定済みであることが前提。",
  schema,
  handler,
};
