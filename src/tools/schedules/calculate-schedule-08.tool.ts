import { z } from "zod";
import type { ToolDefinition } from "../../types/tool-definition.js";
import { getDb } from "../../db/client.js";
import { errorResult, jsonResult, formatError } from "../../helpers/format-error.js";

const dividendSchema = z.object({
  payerName: z.string().describe("配当等の支払法人名"),
  ownershipCategory: z.enum([
    "complete_subsidiary",    // 完全子法人株式等（持株100%）
    "related_company",        // 関連法人株式等（持株1/3超）
    "other_over5",           // その他株式等（持株5%超1/3以下）
    "non_controlling",       // 非支配目的株式等（持株5%以下）
  ]).describe("株式等の区分"),
  dividendAmount: z.number().int().describe("受取配当等の額（円）"),
  relatedDebtInterest: z.number().int().default(0).describe("関連する負債利子控除額（円）。関連法人・その他株式の場合に入力。"),
});

const schema = z.object({
  fiscalYearId: z.string().describe("事業年度ID"),
  dividends: z.array(dividendSchema).describe("受取配当等の一覧"),
});

// 益金不算入割合
const EXCLUSION_RATES: Record<string, number> = {
  complete_subsidiary: 1.0,   // 100%
  related_company: 1.0,       // 100% (要負債利子控除)
  other_over5: 0.5,           // 50%  (要負債利子控除)
  non_controlling: 0.2,       // 20%
};

const CATEGORY_LABELS: Record<string, string> = {
  complete_subsidiary: "完全子法人株式等（100%）",
  related_company: "関連法人株式等（1/3超）",
  other_over5: "その他株式等（5%超1/3以下）",
  non_controlling: "非支配目的株式等（5%以下）",
};

const handler = async (args: any) => {
  try {
    const { fiscalYearId, dividends } = args.params;
    const db = getDb();

    const fy = db.prepare("SELECT id FROM fiscal_years WHERE id = ?").get(fiscalYearId) as any;
    if (!fy) return errorResult(`事業年度 ${fiscalYearId} が見つかりません。`);

    const details = dividends.map((div: any) => {
      const rate = EXCLUSION_RATES[div.ownershipCategory];
      const grossExclusion = Math.floor(div.dividendAmount * rate);

      // Debt interest deduction applies to related_company and other_over5
      const debtInterestDeduction = (div.ownershipCategory === "related_company" || div.ownershipCategory === "other_over5")
        ? div.relatedDebtInterest
        : 0;

      const netExclusion = Math.max(0, grossExclusion - debtInterestDeduction);

      return {
        payerName: div.payerName,
        ownershipCategory: div.ownershipCategory,
        categoryLabel: CATEGORY_LABELS[div.ownershipCategory],
        dividendAmount: div.dividendAmount,
        exclusionRate: rate,
        grossExclusion,
        debtInterestDeduction,
        netExclusion,
      };
    });

    const totalDividend = details.reduce((sum: number, d: any) => sum + d.dividendAmount, 0);
    const totalExclusion = details.reduce((sum: number, d: any) => sum + d.netExclusion, 0);
    const totalDebtInterest = details.reduce((sum: number, d: any) => sum + d.debtInterestDeduction, 0);

    // Breakdown by category
    const byCategory: Record<string, { count: number; totalDividend: number; totalExclusion: number }> = {};
    for (const d of details) {
      const cat = d.ownershipCategory;
      if (!byCategory[cat]) {
        byCategory[cat] = { count: 0, totalDividend: 0, totalExclusion: 0 };
      }
      byCategory[cat].count++;
      byCategory[cat].totalDividend += d.dividendAmount;
      byCategory[cat].totalExclusion += d.netExclusion;
    }

    const result = {
      details,
      summary: {
        totalDividend,
        totalDebtInterest,
        totalExclusion,
        taxableAmount: totalDividend - totalExclusion,
      },
      byCategory,
    };

    // Save
    const now = new Date().toISOString();
    const existing = db.prepare(
      "SELECT version FROM schedule_results WHERE fiscal_year_id = ? AND schedule_number = '08' ORDER BY version DESC LIMIT 1"
    ).get(fiscalYearId) as any;
    const version = existing ? existing.version + 1 : 1;

    db.prepare(`
      INSERT INTO schedule_results (fiscal_year_id, schedule_number, version, input_data, result_data, is_valid, calculated_at)
      VALUES (?, '08', ?, ?, ?, 1, ?)
    `).run(fiscalYearId, version, JSON.stringify({ dividendCount: dividends.length }), JSON.stringify(result), now);

    return jsonResult("別表八（受取配当等の益金不算入額の計算に関する明細書）", result);
  } catch (error) {
    return errorResult(formatError(error));
  }
};

export const CalculateSchedule08Tool: ToolDefinition<typeof schema> = {
  name: "calculate-schedule-08",
  description: "別表八（受取配当等の益金不算入額の計算に関する明細書）を計算します。持株比率による区分に応じた益金不算入額を算出。",
  schema,
  handler,
};
