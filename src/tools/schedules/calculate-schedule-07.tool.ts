import { z } from "zod";
import type { ToolDefinition } from "../../types/tool-definition.js";
import { getDb } from "../../db/client.js";
import { errorResult, jsonResult, formatError } from "../../helpers/format-error.js";

const carriedLossSchema = z.object({
  fiscalYear: z.string().describe("発生事業年度（例: 2020）"),
  originalAmount: z.number().int().describe("発生時の欠損金額（円）"),
  usedPriorYears: z.number().int().default(0).describe("前期までに使用済みの額（円）"),
});

const schema = z.object({
  fiscalYearId: z.string().describe("事業年度ID"),
  carriedLosses: z.array(carriedLossSchema).describe("繰越欠損金の一覧（古い順に入力）"),
});

// 欠損金の繰越期間: 10年（2018年4月以降開始事業年度で発生した欠損金）
const CARRYFORWARD_YEARS = 10;

const handler = async (args: any) => {
  try {
    const { fiscalYearId, carriedLosses } = args.params;
    const db = getDb();

    const fy = db.prepare("SELECT * FROM fiscal_years WHERE id = ?").get(fiscalYearId) as any;
    if (!fy) return errorResult(`事業年度 ${fiscalYearId} が見つかりません。`);

    const company = db.prepare("SELECT * FROM companies WHERE id = ?").get(fy.company_id) as any;
    if (!company) return errorResult(`会社情報が見つかりません。`);

    // Get taxable income from schedule 04
    const schedule04 = db.prepare(
      "SELECT result_data FROM schedule_results WHERE fiscal_year_id = ? AND schedule_number = '04' ORDER BY version DESC LIMIT 1"
    ).get(fiscalYearId) as any;
    if (!schedule04) return errorResult(`別表四が計算されていません。先に calculate-schedule-04 を実行してください。`);

    const schedule04Data = JSON.parse(schedule04.result_data);
    const taxableIncome = schedule04Data.taxableIncome;

    // If taxable income is negative or zero, no loss deduction needed
    if (taxableIncome <= 0) {
      const result = {
        taxableIncomeBefore: taxableIncome,
        isSme: true,
        deductionLimit: 0,
        totalDeduction: 0,
        taxableIncomeAfter: taxableIncome,
        details: [],
        message: "課税所得がゼロ以下のため、繰越欠損金の控除はありません。",
      };

      saveResult(db, fiscalYearId, result);
      return jsonResult("別表七（欠損金又は災害損失金の損金算入に関する明細書）", result);
    }

    const isSme = (company.capital_amount ?? 0) <= 100000000;

    // SME: 100% deductible, Large: 50% of taxable income
    const deductionLimitRatio = isSme ? 1.0 : 0.5;
    const deductionLimit = Math.floor(taxableIncome * deductionLimitRatio);

    // Current fiscal year end for checking expiration
    const currentEndYear = parseInt(fy.end_date.substring(0, 4));

    let remainingLimit = deductionLimit;
    const details = carriedLosses.map((loss: any) => {
      const remaining = loss.originalAmount - loss.usedPriorYears;
      if (remaining <= 0) {
        return {
          fiscalYear: loss.fiscalYear,
          originalAmount: loss.originalAmount,
          usedPriorYears: loss.usedPriorYears,
          remainingBefore: 0,
          usedThisYear: 0,
          remainingAfter: 0,
          expired: false,
        };
      }

      // Check if expired (older than 10 years)
      const lossYear = parseInt(loss.fiscalYear);
      const expired = (currentEndYear - lossYear) > CARRYFORWARD_YEARS;
      if (expired) {
        return {
          fiscalYear: loss.fiscalYear,
          originalAmount: loss.originalAmount,
          usedPriorYears: loss.usedPriorYears,
          remainingBefore: remaining,
          usedThisYear: 0,
          remainingAfter: 0,
          expired: true,
          message: "繰越期間（10年）を超過しているため使用不可",
        };
      }

      // Apply loss (oldest first)
      const usedThisYear = Math.min(remaining, remainingLimit);
      remainingLimit -= usedThisYear;

      return {
        fiscalYear: loss.fiscalYear,
        originalAmount: loss.originalAmount,
        usedPriorYears: loss.usedPriorYears,
        remainingBefore: remaining,
        usedThisYear,
        remainingAfter: remaining - usedThisYear,
        expired: false,
      };
    });

    const totalDeduction = details.reduce((sum: number, d: any) => sum + d.usedThisYear, 0);

    const result = {
      taxableIncomeBefore: taxableIncome,
      isSme,
      deductionLimitRatio,
      deductionLimit,
      totalDeduction,
      taxableIncomeAfter: taxableIncome - totalDeduction,
      details,
    };

    saveResult(db, fiscalYearId, result);
    return jsonResult("別表七（欠損金又は災害損失金の損金算入に関する明細書）", result);
  } catch (error) {
    return errorResult(formatError(error));
  }
};

function saveResult(db: any, fiscalYearId: string, result: any) {
  const now = new Date().toISOString();
  const existing = db.prepare(
    "SELECT version FROM schedule_results WHERE fiscal_year_id = ? AND schedule_number = '07' ORDER BY version DESC LIMIT 1"
  ).get(fiscalYearId) as any;
  const version = existing ? existing.version + 1 : 1;

  db.prepare(`
    INSERT INTO schedule_results (fiscal_year_id, schedule_number, version, input_data, result_data, is_valid, calculated_at)
    VALUES (?, '07', ?, ?, ?, 1, ?)
  `).run(fiscalYearId, version, JSON.stringify({ totalDeduction: result.totalDeduction }), JSON.stringify(result), now);
}

export const CalculateSchedule07Tool: ToolDefinition<typeof schema> = {
  name: "calculate-schedule-07",
  description: "別表七（欠損金又は災害損失金の損金算入に関する明細書）を計算します。繰越欠損金を古い順に控除。中小法人は全額、大法人は所得の50%まで。",
  schema,
  handler,
};
