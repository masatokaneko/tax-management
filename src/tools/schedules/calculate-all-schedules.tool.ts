import { z } from "zod";
import type { ToolDefinition } from "../../types/tool-definition.js";
import { getDb } from "../../db/client.js";
import { errorResult, jsonResult, formatError } from "../../helpers/format-error.js";

const assetSchema = z.object({
  name: z.string(),
  acquisitionDate: z.string(),
  acquisitionCost: z.number().int(),
  usefulLife: z.number().int(),
  method: z.enum(["straight_line", "declining_balance"]),
  priorAccumulatedDepreciation: z.number().int().default(0),
  currentBookDepreciation: z.number().int(),
  residualRate: z.number().default(0).optional(),
});

const carriedLossSchema = z.object({
  fiscalYear: z.string(),
  originalAmount: z.number().int(),
  usedPriorYears: z.number().int().default(0),
});

const withheldTaxSchema = z.object({
  source: z.string(),
  payerName: z.string(),
  grossAmount: z.number().int(),
  withheldTax: z.number().int(),
});

const dividendSchema = z.object({
  payerName: z.string(),
  ownershipCategory: z.enum(["complete_subsidiary", "related_company", "other_over5", "non_controlling"]),
  dividendAmount: z.number().int(),
  relatedDebtInterest: z.number().int().default(0),
});

const shareholderSchema = z.object({
  name: z.string(),
  groupName: z.string().optional(),
  shares: z.number().int(),
  isRelatedPerson: z.boolean().default(false),
});

const schema = z.object({
  fiscalYearId: z.string().describe("事業年度ID"),
  netIncome: z.number().int().describe("当期純利益（円・整数）"),

  // Schedule 16 (depreciation) - optional
  assets: z.array(assetSchema).optional().describe("減価償却資産の配列（別表十六用）"),

  // Schedule 15 (entertainment)
  totalEntertainment: z.number().int().default(0).describe("交際費等の支出額合計（円）"),
  diningExpenseAmount: z.number().int().default(0).describe("うち飲食費の額（円）"),

  // Schedule 14 (donations)
  generalDonations: z.number().int().default(0).describe("一般寄付金の額（円）"),
  designatedDonations: z.number().int().default(0).describe("特定公益増進法人等への寄付金の額（円）"),
  nationalLocalGovDonations: z.number().int().default(0).describe("国・地方公共団体への寄付金の額（円）"),
  fiscalYearMonths: z.number().int().default(12).describe("事業年度の月数"),

  // Schedule 08 (dividends) - optional
  dividends: z.array(dividendSchema).optional().describe("受取配当等の一覧（別表八用）"),

  // Schedule 07 (carried losses) - optional
  carriedLosses: z.array(carriedLossSchema).optional().describe("繰越欠損金の一覧（別表七用）"),

  // Schedule 06 (tax credits) - optional
  withheldTaxes: z.array(withheldTaxSchema).optional().describe("源泉徴収税額の一覧（別表六用）"),

  // Schedule 01 params
  priorInterimTax: z.number().int().default(0).describe("前期中間納付法人税額"),

  // Schedule 05-2 params
  priorCorporateTax: z.number().int().default(0).describe("前期確定法人税額"),
  priorLocalCorporateTax: z.number().int().default(0).describe("前期確定地方法人税額"),
  priorResidentTax: z.number().int().default(0).describe("前期確定住民税額"),
  priorEnterpriseTax: z.number().int().default(0).describe("前期確定事業税額"),

  // Schedule 05-1 params
  priorRetainedEarnings: z.number().int().default(0).describe("期首利益積立金額"),

  // Schedule 02 params - optional
  totalShares: z.number().int().optional().describe("発行済株式総数（別表二用）"),
  shareholders: z.array(shareholderSchema).optional().describe("株主一覧（別表二用）"),

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

    // Full topological order: 16 → 15 → 14 → 08 → 04 → 07 → 06 → 01 → 05-2 → 05-1 → 02
    const calculationOrder: string[] = [];
    const results: Record<string, any> = {};
    const skipped: string[] = [];
    const errors: string[] = [];
    const succeeded: string[] = [];

    // Helper to run a schedule and handle errors
    async function runSchedule(num: string, fn: () => Promise<any>) {
      calculationOrder.push(num);
      try {
        const result = await fn();
        results[num] = result;
        // Check if the tool itself returned an error
        if (result && result.isError) {
          const errText = result.content?.map((c: any) => c.text).join("") ?? "unknown error";
          errors.push(`別表${num}: ${errText}`);
        } else {
          succeeded.push(num);
        }
      } catch (err) {
        errors.push(`別表${num}: ${formatError(err)}`);
      }
    }

    // === Phase 1: Independent schedules (16, 15, 14, 08) ===

    // Schedule 16 - Depreciation
    if (p.assets && p.assets.length > 0) {
      await runSchedule("16", async () => {
        const { CalculateSchedule16Tool } = await import("./calculate-schedule-16.tool.js");
        return CalculateSchedule16Tool.handler(
          { params: { fiscalYearId: p.fiscalYearId, assets: p.assets } },
          {} as any,
        );
      });
    } else {
      skipped.push("16");
    }
    if (errors.length > 0) return errorStop(db, p, calculationOrder, results, errors, skipped, succeeded);

    // Schedule 15 - Entertainment expenses
    if (p.totalEntertainment > 0) {
      await runSchedule("15", async () => {
        const { CalculateSchedule15Tool } = await import("./calculate-schedule-15.tool.js");
        return CalculateSchedule15Tool.handler(
          { params: { fiscalYearId: p.fiscalYearId, totalEntertainment: p.totalEntertainment, diningExpenseAmount: p.diningExpenseAmount, fiscalYearMonths: p.fiscalYearMonths } },
          {} as any,
        );
      });
    } else {
      skipped.push("15");
    }
    if (errors.length > 0) return errorStop(db, p, calculationOrder, results, errors, skipped, succeeded);

    // Schedule 08 - Dividend received deduction
    if (p.dividends && p.dividends.length > 0) {
      await runSchedule("08", async () => {
        const { CalculateSchedule08Tool } = await import("./calculate-schedule-08.tool.js");
        return CalculateSchedule08Tool.handler(
          { params: { fiscalYearId: p.fiscalYearId, dividends: p.dividends } },
          {} as any,
        );
      });
    } else {
      skipped.push("08");
    }
    if (errors.length > 0) return errorStop(db, p, calculationOrder, results, errors, skipped, succeeded);

    // === Phase 2: Schedule 04 (depends on 16, 15, 08 adjustments already in DB) ===
    await runSchedule("04", async () => {
      const { CalculateSchedule04Tool } = await import("./calculate-schedule-04.tool.js");
      return CalculateSchedule04Tool.handler(
        { params: { fiscalYearId: p.fiscalYearId, netIncome: p.netIncome } },
        {} as any,
      );
    });
    if (errors.length > 0) return errorStop(db, p, calculationOrder, results, errors, skipped, succeeded);

    // Schedule 14 - Donations (needs schedule 04 taxable income)
    if (p.generalDonations > 0 || p.designatedDonations > 0 || p.nationalLocalGovDonations > 0) {
      await runSchedule("14", async () => {
        const { CalculateSchedule14Tool } = await import("./calculate-schedule-14.tool.js");
        return CalculateSchedule14Tool.handler(
          { params: {
            fiscalYearId: p.fiscalYearId,
            generalDonations: p.generalDonations,
            designatedDonations: p.designatedDonations,
            nationalLocalGovDonations: p.nationalLocalGovDonations,
            fiscalYearMonths: p.fiscalYearMonths,
          } },
          {} as any,
        );
      });
    } else {
      skipped.push("14");
    }
    if (errors.length > 0) return errorStop(db, p, calculationOrder, results, errors, skipped, succeeded);

    // === Phase 3: Schedule 07 (depends on 04) ===
    if (p.carriedLosses && p.carriedLosses.length > 0) {
      await runSchedule("07", async () => {
        const { CalculateSchedule07Tool } = await import("./calculate-schedule-07.tool.js");
        return CalculateSchedule07Tool.handler(
          { params: { fiscalYearId: p.fiscalYearId, carriedLosses: p.carriedLosses } },
          {} as any,
        );
      });
    } else {
      skipped.push("07");
    }
    if (errors.length > 0) return errorStop(db, p, calculationOrder, results, errors, skipped, succeeded);

    // === Phase 4: Schedule 06 (independent but used by 01) ===
    let taxCreditsFromSchedule06 = 0;
    if (p.withheldTaxes && p.withheldTaxes.length > 0) {
      await runSchedule("06", async () => {
        const { CalculateSchedule06Tool } = await import("./calculate-schedule-06.tool.js");
        return CalculateSchedule06Tool.handler(
          { params: { fiscalYearId: p.fiscalYearId, withheldTaxes: p.withheldTaxes } },
          {} as any,
        );
      });
      // Extract credit amount from schedule 06 result
      if (results["06"] && !results["06"].isError) {
        const s06Data = db.prepare(
          "SELECT result_data FROM schedule_results WHERE fiscal_year_id = ? AND schedule_number = '06' ORDER BY version DESC LIMIT 1"
        ).get(p.fiscalYearId) as any;
        if (s06Data) {
          taxCreditsFromSchedule06 = JSON.parse(s06Data.result_data).creditableAmount ?? 0;
        }
      }
    } else {
      skipped.push("06");
    }
    if (errors.length > 0) return errorStop(db, p, calculationOrder, results, errors, skipped, succeeded);

    // Get carried loss deduction from schedule 07 result
    let carriedLossDeduction = 0;
    if (results["07"] && !results["07"].isError) {
      const s07Data = db.prepare(
        "SELECT result_data FROM schedule_results WHERE fiscal_year_id = ? AND schedule_number = '07' ORDER BY version DESC LIMIT 1"
      ).get(p.fiscalYearId) as any;
      if (s07Data) {
        carriedLossDeduction = JSON.parse(s07Data.result_data).totalDeduction ?? 0;
      }
    }

    // === Phase 5: Schedule 01 (depends on 04, 07, 06) ===
    await runSchedule("01", async () => {
      const { CalculateSchedule01Tool } = await import("./calculate-schedule-01.tool.js");
      return CalculateSchedule01Tool.handler(
        { params: {
          fiscalYearId: p.fiscalYearId,
          priorInterimTax: p.priorInterimTax,
          taxCredits: taxCreditsFromSchedule06,
          carriedLossDeduction,
        } },
        {} as any,
      );
    });
    if (errors.length > 0) return errorStop(db, p, calculationOrder, results, errors, skipped, succeeded);

    // === Phase 6: Schedule 05-2 (depends on 01) ===
    await runSchedule("05-2", async () => {
      const { CalculateSchedule05_2Tool } = await import("./calculate-schedule-05-2.tool.js");
      return CalculateSchedule05_2Tool.handler(
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
    });
    if (errors.length > 0) return errorStop(db, p, calculationOrder, results, errors, skipped, succeeded);

    // === Phase 7: Schedule 05-1 (depends on 04, 05-2) ===
    await runSchedule("05-1", async () => {
      const { CalculateSchedule05_1Tool } = await import("./calculate-schedule-05-1.tool.js");
      return CalculateSchedule05_1Tool.handler(
        { params: {
          fiscalYearId: p.fiscalYearId,
          priorRetainedEarnings: p.priorRetainedEarnings,
        } },
        {} as any,
      );
    });
    if (errors.length > 0) return errorStop(db, p, calculationOrder, results, errors, skipped, succeeded);

    // === Phase 8: Schedule 02 (independent) ===
    if (p.totalShares && p.shareholders && p.shareholders.length > 0) {
      await runSchedule("02", async () => {
        const { CalculateSchedule02Tool } = await import("./calculate-schedule-02.tool.js");
        return CalculateSchedule02Tool.handler(
          { params: {
            fiscalYearId: p.fiscalYearId,
            totalShares: p.totalShares,
            shareholders: p.shareholders,
          } },
          {} as any,
        );
      });
    } else {
      skipped.push("02");
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
      succeeded,
      skipped,
      errors,
    }), now);

    if (errors.length > 0) {
      return {
        content: [{
          type: "text" as const,
          text: `一括計算（一部エラー）\n\n成功: ${succeeded.length > 0 ? succeeded.map(s => `別表${s}`).join(", ") : "なし"}\nスキップ: ${skipped.length > 0 ? skipped.map(s => `別表${s}`).join(", ") : "なし"}\nエラー: ${errors.length}件\n\n${errors.join("\n")}\n\n${JSON.stringify({ succeeded, skipped, errors }, null, 2)}`,
        }],
        isError: true,
      };
    }

    return jsonResult("全別表の一括計算が完了しました", {
      succeeded,
      skipped,
      status: "calculated",
      message: "全別表の計算が正常に完了しました。validate-schedules で整合性チェックを実行してください。",
    });
  } catch (error) {
    return errorResult(formatError(error));
  }
};

function errorStop(db: any, p: any, calculationOrder: string[], results: Record<string, any>, errors: string[], skipped: string[], succeeded: string[]) {
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO audit_log (fiscal_year_id, action, target, detail, timestamp)
    VALUES (?, 'calculate', 'all_schedules', ?, ?)
  `).run(p.fiscalYearId, JSON.stringify({
    succeeded,
    skipped,
    errors,
  }), now);

  return {
    content: [{
      type: "text" as const,
      text: `一括計算（エラーで中断）\n\n成功: ${succeeded.length > 0 ? succeeded.map(s => `別表${s}`).join(", ") : "なし"}\nスキップ: ${skipped.length > 0 ? skipped.map(s => `別表${s}`).join(", ") : "なし"}\nエラー: ${errors.length}件\n\n${errors.join("\n")}\n\n${JSON.stringify({ succeeded, skipped, errors }, null, 2)}`,
    }],
    isError: true,
  };
}

export const CalculateAllSchedulesTool: ToolDefinition<typeof schema> = {
  name: "calculate-all-schedules",
  description: "全別表を依存関係の正しい順序で一括計算します（16→15→08→04→14→07→06→01→05-2→05-1→02）。税務調整項目が確定済みであることが前提。",
  schema,
  handler,
};
