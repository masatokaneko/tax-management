import { z } from "zod";
import type { ToolDefinition } from "../../types/tool-definition.js";
import { getDb } from "../../db/client.js";
import { errorResult, jsonResult, formatError } from "../../helpers/format-error.js";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

const salesByTypeSchema = z.object({
  type: z.enum(["1", "2", "3", "4", "5", "6"]).describe(
    "事業区分: 1=卸売業, 2=小売業, 3=製造業等, 4=その他, 5=サービス業等, 6=不動産業"
  ),
  standardRateSales: z.number().int().default(0).describe("標準税率（10%）対象の課税売上高（税抜・円）"),
  reducedRateSales: z.number().int().default(0).describe("軽減税率（8%）対象の課税売上高（税抜・円）"),
});

const schema = z.object({
  fiscalYearId: z.string().describe("事業年度ID"),
  salesByType: z.array(salesByTypeSchema).describe("事業区分ごとの課税売上高"),
});

// みなし仕入率
const DEEMED_PURCHASE_RATES: Record<string, number> = {
  "1": 0.90, // 卸売業
  "2": 0.80, // 小売業
  "3": 0.70, // 製造業等
  "4": 0.60, // その他
  "5": 0.50, // サービス業等
  "6": 0.40, // 不動産業
};

const TYPE_LABELS: Record<string, string> = {
  "1": "第一種（卸売業）",
  "2": "第二種（小売業）",
  "3": "第三種（製造業等）",
  "4": "第四種（その他）",
  "5": "第五種（サービス業等）",
  "6": "第六種（不動産業）",
};

const handler = async (args: any) => {
  try {
    const { fiscalYearId, salesByType } = args.params;
    const db = getDb();

    const fy = db.prepare("SELECT * FROM fiscal_years WHERE id = ?").get(fiscalYearId) as any;
    if (!fy) return errorResult(`事業年度 ${fiscalYearId} が見つかりません。`);

    // Load consumption tax rates
    const ratesPath = resolve(__dirname, "../../data/tax-rates/consumption-tax.json");
    const rates = JSON.parse(readFileSync(ratesPath, "utf-8"));

    const details = salesByType.map((s: any) => {
      const deemedRate = DEEMED_PURCHASE_RATES[s.type];
      const outputTaxStandard = Math.floor(s.standardRateSales * rates.standardTaxPortion);
      const outputTaxReduced = Math.floor(s.reducedRateSales * rates.reducedTaxPortion);
      const outputTax = outputTaxStandard + outputTaxReduced;
      const deemedInputTax = Math.floor(outputTax * deemedRate);

      return {
        type: s.type,
        typeLabel: TYPE_LABELS[s.type],
        standardRateSales: s.standardRateSales,
        reducedRateSales: s.reducedRateSales,
        totalSales: s.standardRateSales + s.reducedRateSales,
        deemedPurchaseRate: deemedRate,
        outputTax,
        deemedInputTax,
        taxPayable: outputTax - deemedInputTax,
      };
    });

    const totalOutputTax = details.reduce((sum: number, d: any) => sum + d.outputTax, 0);
    const totalDeemedInputTax = details.reduce((sum: number, d: any) => sum + d.deemedInputTax, 0);

    // Check if 2+ business types exist: special calculation rules may apply
    const businessTypes = new Set(salesByType.map((s: any) => s.type));
    let effectiveDeemedInputTax: number;

    if (businessTypes.size === 1) {
      // Single business type: simple calculation
      effectiveDeemedInputTax = totalDeemedInputTax;
    } else {
      // Multiple business types: use proportional calculation (simplified here)
      // In reality, if one type is ≥75% of sales, its rate can apply to all
      const totalSales = details.reduce((sum: number, d: any) => sum + d.totalSales, 0);
      let dominantType: any = null;
      for (const d of details) {
        if (totalSales > 0 && d.totalSales / totalSales >= 0.75) {
          dominantType = d;
          break;
        }
      }

      if (dominantType) {
        // 75% rule: apply dominant type's rate to all
        effectiveDeemedInputTax = Math.floor(totalOutputTax * DEEMED_PURCHASE_RATES[dominantType.type]);
      } else {
        // Standard proportional: sum of each type's deemed input
        effectiveDeemedInputTax = totalDeemedInputTax;
      }
    }

    const nationalTaxPayable = Math.max(0, Math.floor((totalOutputTax - effectiveDeemedInputTax) / 100) * 100);
    const localTaxPayable = Math.floor(nationalTaxPayable * 22 / 78);

    const result = {
      details,
      summary: {
        businessTypeCount: businessTypes.size,
        totalSales: details.reduce((sum: number, d: any) => sum + d.totalSales, 0),
        totalOutputTax,
        totalDeemedInputTax: effectiveDeemedInputTax,
        nationalTaxPayable,
        localTaxPayable,
        totalTaxPayable: nationalTaxPayable + localTaxPayable,
      },
    };

    // Save
    const now = new Date().toISOString();
    const existing = db.prepare(
      "SELECT version FROM schedule_results WHERE fiscal_year_id = ? AND schedule_number = 'consumption-simplified' ORDER BY version DESC LIMIT 1"
    ).get(fiscalYearId) as any;
    const version = existing ? existing.version + 1 : 1;

    db.prepare(`
      INSERT INTO schedule_results (fiscal_year_id, schedule_number, version, input_data, result_data, is_valid, calculated_at)
      VALUES (?, 'consumption-simplified', ?, ?, ?, 1, ?)
    `).run(fiscalYearId, version, JSON.stringify({ businessTypes: [...businessTypes] }), JSON.stringify(result), now);

    return jsonResult("消費税申告書（簡易課税）", result);
  } catch (error) {
    return errorResult(formatError(error));
  }
};

export const CalculateSimplifiedConsumptionTaxTool: ToolDefinition<typeof schema> = {
  name: "calculate-consumption-tax-simplified",
  description: "消費税（簡易課税）を計算します。事業区分ごとのみなし仕入率を適用して納付税額を算出。",
  schema,
  handler,
};
