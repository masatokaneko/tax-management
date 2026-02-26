import { z } from "zod";
import type { ToolDefinition } from "../../types/tool-definition.js";
import { getDb } from "../../db/client.js";
import { errorResult, jsonResult, formatError } from "../../helpers/format-error.js";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

const schema = z.object({
  fiscalYearId: z.string().describe("事業年度ID"),
  fiscalYearMonths: z.number().int().default(12).describe("事業年度の月数"),
});

const handler = async (args: any) => {
  try {
    const { fiscalYearId, fiscalYearMonths } = args.params;
    const db = getDb();

    const fy = db.prepare("SELECT * FROM fiscal_years WHERE id = ?").get(fiscalYearId) as any;
    if (!fy) return errorResult(`事業年度 ${fiscalYearId} が見つかりません。`);

    // Get taxable income from schedule 04
    const schedule04 = db.prepare(
      "SELECT result_data FROM schedule_results WHERE fiscal_year_id = ? AND schedule_number = '04' ORDER BY version DESC LIMIT 1"
    ).get(fiscalYearId) as any;
    if (!schedule04) return errorResult(`別表四が計算されていません。先に calculate-schedule-04 を実行してください。`);

    const schedule04Data = JSON.parse(schedule04.result_data);

    // Use income after carried loss deduction if schedule 07 exists
    let incomeBeforeLoss = schedule04Data.taxableIncome;
    const schedule07 = db.prepare(
      "SELECT result_data FROM schedule_results WHERE fiscal_year_id = ? AND schedule_number = '07' ORDER BY version DESC LIMIT 1"
    ).get(fiscalYearId) as any;
    let lossDeduction = 0;
    if (schedule07) {
      const s07 = JSON.parse(schedule07.result_data);
      lossDeduction = s07.totalDeduction ?? 0;
    }
    const taxableIncome = Math.max(0, incomeBeforeLoss - lossDeduction);

    // Load Tokyo tax rates
    const tokyoRatesPath = resolve(__dirname, "../../data/master/tokyo-tax-rates.json");
    const tokyoRates = JSON.parse(readFileSync(tokyoRatesPath, "utf-8"));

    const brackets = tokyoRates.enterpriseTax.income.brackets;

    // Adjust brackets for fiscal year months
    const monthAdjust = fiscalYearMonths / 12;

    // Calculate enterprise tax with progressive rates
    let remainingIncome = taxableIncome;
    let totalTaxStandard = 0;
    let totalTaxTokyo = 0;
    const bracketDetails: any[] = [];

    for (let i = 0; i < brackets.length; i++) {
      const bracket = brackets[i];
      const threshold = bracket.threshold !== null
        ? Math.floor(bracket.threshold * monthAdjust)
        : Infinity;

      // For the first bracket, the threshold IS the limit
      // For subsequent brackets, it's the difference from the prior
      let bracketLimit: number;
      if (i === 0) {
        bracketLimit = threshold;
      } else {
        const priorThreshold = brackets[i - 1].threshold !== null
          ? Math.floor(brackets[i - 1].threshold * monthAdjust)
          : 0;
        bracketLimit = threshold === Infinity ? Infinity : threshold - priorThreshold;
      }

      const taxableInBracket = Math.min(remainingIncome, bracketLimit);
      if (taxableInBracket <= 0) break;

      const standardTax = Math.floor(taxableInBracket * bracket.standardRate);
      const tokyoTax = Math.floor(taxableInBracket * bracket.tokyoRate);

      totalTaxStandard += standardTax;
      totalTaxTokyo += tokyoTax;
      remainingIncome -= taxableInBracket;

      bracketDetails.push({
        bracketIndex: i + 1,
        threshold: bracket.threshold,
        adjustedThreshold: threshold === Infinity ? null : threshold,
        standardRate: bracket.standardRate,
        tokyoRate: bracket.tokyoRate,
        taxableAmount: taxableInBracket,
        standardTax,
        tokyoTax,
      });
    }

    // Round to 100 yen
    const enterpriseTax = Math.floor(totalTaxTokyo / 100) * 100;

    const result = {
      taxableIncome,
      fiscalYearMonths,
      brackets: bracketDetails,
      summary: {
        enterpriseTaxStandard: Math.floor(totalTaxStandard / 100) * 100,
        enterpriseTaxTokyo: enterpriseTax,
        note: "東京都超過税率を適用",
      },
    };

    // Save
    const now = new Date().toISOString();
    const existing = db.prepare(
      "SELECT version FROM schedule_results WHERE fiscal_year_id = ? AND schedule_number = 'enterprise-tax' ORDER BY version DESC LIMIT 1"
    ).get(fiscalYearId) as any;
    const version = existing ? existing.version + 1 : 1;

    db.prepare(`
      INSERT INTO schedule_results (fiscal_year_id, schedule_number, version, input_data, result_data, is_valid, calculated_at)
      VALUES (?, 'enterprise-tax', ?, ?, ?, 1, ?)
    `).run(fiscalYearId, version, JSON.stringify({ taxableIncome, fiscalYearMonths }), JSON.stringify(result), now);

    return jsonResult("法人事業税の計算", result);
  } catch (error) {
    return errorResult(formatError(error));
  }
};

export const CalculateEnterpriseTaxTool: ToolDefinition<typeof schema> = {
  name: "calculate-enterprise-tax",
  description: "法人事業税を計算します。所得に対して3段階の累進税率（東京都超過税率）を適用。",
  schema,
  handler,
};
