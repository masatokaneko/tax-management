import { z } from "zod";
import type { ToolDefinition } from "../../types/tool-definition.js";
import { getDb } from "../../db/client.js";
import { errorResult, jsonResult, formatError } from "../../helpers/format-error.js";

const assetSchema = z.object({
  name: z.string().describe("資産名"),
  acquisitionDate: z.string().describe("取得日（YYYY-MM-DD）"),
  acquisitionCost: z.number().int().describe("取得価額（円）"),
  usefulLife: z.number().int().describe("耐用年数"),
  method: z.enum(["straight_line", "declining_balance"]).describe("償却方法: straight_line=定額法, declining_balance=定率法"),
  priorAccumulatedDepreciation: z.number().int().default(0).describe("前期末までの償却累計額"),
  currentBookDepreciation: z.number().int().describe("当期会計上の減価償却費"),
  residualRate: z.number().default(0).optional().describe("残存割合（旧定額法の場合。通常0）"),
});

const schema = z.object({
  fiscalYearId: z.string().describe("事業年度ID"),
  assets: z.array(assetSchema).describe("減価償却資産の配列"),
});

function calculateStraightLine(cost: number, usefulLife: number): number {
  // Tax depreciation limit for straight-line: cost / usefulLife (floor to 1 yen)
  return Math.floor(cost / usefulLife);
}

function calculateDecliningBalance(cost: number, usefulLife: number, priorAccumulated: number): number {
  // Declining balance rate = 2 / usefulLife (200% declining balance for assets acquired after 2012)
  const rate = 2 / usefulLife;
  const bookValue = cost - priorAccumulated;
  if (bookValue <= 0) return 0;

  // Guarantee amount check
  const guaranteeRate = getGuaranteeRate(usefulLife);
  const guaranteeAmount = Math.floor(cost * guaranteeRate);

  const normalDepreciation = Math.floor(bookValue * rate);

  if (normalDepreciation >= guaranteeAmount) {
    return normalDepreciation;
  } else {
    // Switch to straight-line for remaining useful life
    const revisedRate = getRevisedRate(usefulLife);
    return Math.floor(bookValue * revisedRate);
  }
}

// Simplified guarantee rates (actual rates are from tax tables)
function getGuaranteeRate(usefulLife: number): number {
  const rates: Record<number, number> = {
    2: 0.500, 3: 0.11089, 4: 0.05274, 5: 0.02789,
    6: 0.01585, 7: 0.00917, 8: 0.00552, 9: 0.00340,
    10: 0.00216, 15: 0.00052, 20: 0.00013, 30: 0.00001,
  };
  return rates[usefulLife] ?? 0.00100;
}

function getRevisedRate(usefulLife: number): number {
  const rates: Record<number, number> = {
    2: 1.000, 3: 0.500, 4: 0.334, 5: 0.250,
    6: 0.200, 7: 0.167, 8: 0.125, 9: 0.112,
    10: 0.100, 15: 0.067, 20: 0.050, 30: 0.034,
  };
  return rates[usefulLife] ?? (1 / usefulLife);
}

const handler = async (args: any) => {
  try {
    const { fiscalYearId, assets } = args.params;
    const db = getDb();

    const fy = db.prepare("SELECT id FROM fiscal_years WHERE id = ?").get(fiscalYearId) as any;
    if (!fy) return errorResult(`事業年度 ${fiscalYearId} が見つかりません。`);

    let totalTaxLimit = 0;
    let totalBookDepreciation = 0;
    let totalExcess = 0;
    let totalShortfall = 0;

    const details = assets.map((asset: any) => {
      let taxLimit: number;
      if (asset.method === "straight_line") {
        taxLimit = calculateStraightLine(asset.acquisitionCost, asset.usefulLife);
      } else {
        taxLimit = calculateDecliningBalance(asset.acquisitionCost, asset.usefulLife, asset.priorAccumulatedDepreciation);
      }

      const diff = asset.currentBookDepreciation - taxLimit;
      const excess = diff > 0 ? diff : 0;     // Depreciation excess (add-back)
      const shortfall = diff < 0 ? -diff : 0;  // Depreciation shortfall

      totalTaxLimit += taxLimit;
      totalBookDepreciation += asset.currentBookDepreciation;
      totalExcess += excess;
      totalShortfall += shortfall;

      return {
        name: asset.name,
        acquisitionCost: asset.acquisitionCost,
        method: asset.method,
        usefulLife: asset.usefulLife,
        taxDepreciationLimit: taxLimit,
        bookDepreciation: asset.currentBookDepreciation,
        excess,
        shortfall,
      };
    });

    const result = {
      assets: details,
      summary: {
        totalTaxLimit,
        totalBookDepreciation,
        totalExcess,
        totalShortfall,
        netAdjustment: totalExcess - totalShortfall,
      },
    };

    // Save result
    const now = new Date().toISOString();
    const existing = db.prepare(
      "SELECT version FROM schedule_results WHERE fiscal_year_id = ? AND schedule_number = '16' ORDER BY version DESC LIMIT 1"
    ).get(fiscalYearId) as any;
    const version = existing ? existing.version + 1 : 1;

    db.prepare(`
      INSERT INTO schedule_results (fiscal_year_id, schedule_number, version, input_data, result_data, is_valid, calculated_at)
      VALUES (?, '16', ?, ?, ?, 1, ?)
    `).run(fiscalYearId, version, JSON.stringify({ assetCount: assets.length }), JSON.stringify(result), now);

    return jsonResult("別表十六（減価償却資産の償却額の計算）", result);
  } catch (error) {
    return errorResult(formatError(error));
  }
};

export const CalculateSchedule16Tool: ToolDefinition<typeof schema> = {
  name: "calculate-schedule-16",
  description: "別表十六（減価償却資産の償却額の計算に関する明細書）を計算します。定額法/定率法で税務上の償却限度額を算出し、会計上の計上額との差額を計算。",
  schema,
  handler,
};
