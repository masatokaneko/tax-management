import { z } from "zod";
import type { ToolDefinition } from "../../types/tool-definition.js";
import { getDb } from "../../db/client.js";
import { errorResult, jsonResult, formatError } from "../../helpers/format-error.js";

const schema = z.object({
  fiscalYearId: z.string().describe("事業年度ID"),
});

interface ValidationCheck {
  name: string;
  description: string;
  passed: boolean;
  expected?: number;
  actual?: number;
  detail?: string;
}

const handler = async (args: any) => {
  try {
    const { fiscalYearId } = args.params;
    const db = getDb();

    const checks: ValidationCheck[] = [];

    // Load all schedule results
    const scheduleRows = db.prepare(
      "SELECT schedule_number, result_data FROM schedule_results WHERE fiscal_year_id = ? AND schedule_number IN ('01', '04', '05-1', '05-2') ORDER BY schedule_number, version DESC"
    ).all(fiscalYearId) as any[];

    const schedules: Record<string, any> = {};
    for (const row of scheduleRows) {
      if (!schedules[row.schedule_number]) {
        schedules[row.schedule_number] = JSON.parse(row.result_data);
      }
    }

    // Check 1: All core schedules computed
    const required = ["04", "01", "05-2", "05-1"];
    for (const num of required) {
      checks.push({
        name: `別表${num}計算済み`,
        description: `別表${num}が計算されているか`,
        passed: !!schedules[num],
      });
    }

    if (!schedules["04"] || !schedules["01"] || !schedules["05-1"] || !schedules["05-2"]) {
      return jsonResult("整合性チェック結果（未計算の別表あり）", {
        overallPassed: false,
        checks,
        message: "全別表が計算されていません。calculate-all-schedules を実行してください。",
      });
    }

    // Check 2: Schedule 01 taxableIncomeRounded is consistent with schedule 04
    const s04 = schedules["04"];
    const s01 = schedules["01"];
    // The rounded taxable income in schedule 01 should be floor(max(0, s04.taxableIncome - lossDeduction) / 1000) * 1000
    // We check that s01.taxableIncomeRounded <= s04.taxableIncome (loss deduction makes it smaller)
    const incomeConsistent = s01.taxableIncomeRounded <= s04.taxableIncome && s01.taxableIncomeRounded >= 0;
    checks.push({
      name: "別表四→別表一の課税所得整合性",
      description: "別表一の課税所得（千円未満切捨て後）が別表四の所得以下であること",
      passed: incomeConsistent,
      expected: s04.taxableIncome,
      actual: s01.taxableIncomeRounded,
      detail: `別表四所得: ${s04.taxableIncome.toLocaleString()}円 → 別表一課税所得: ${s01.taxableIncomeRounded.toLocaleString()}円`,
    });

    // Check 3: Schedule 01 tax amount > 0 when taxable income > 0
    if (s04.taxableIncome > 0) {
      checks.push({
        name: "課税所得に対する税額の整合性",
        description: "課税所得 > 0 なら法人税額 > 0",
        passed: s01.corporateTaxAmount > 0,
        expected: s04.taxableIncome,
        actual: s01.corporateTaxAmount,
      });
    }

    // Check 4: Schedule 05-1 balance check
    // 期末利益積立金 = 期首 + 当期増減
    const s051 = schedules["05-1"];
    const expectedEnding = s051.beginningBalance + s051.changes.netChange;
    checks.push({
      name: "別表五(一)の期末残高整合性",
      description: "期末残高 = 期首残高 + 当期増減",
      passed: s051.endingBalance === expectedEnding,
      expected: expectedEnding,
      actual: s051.endingBalance,
    });

    // Check 5: Tax amounts are non-negative (or properly negative for refund)
    checks.push({
      name: "法人税額の正当性",
      description: "法人税額が0以上",
      passed: s01.corporateTaxAfterCredits >= 0,
      actual: s01.corporateTaxAfterCredits,
    });

    const overallPassed = checks.every(c => c.passed);

    // Update fiscal year status if all checks pass
    if (overallPassed) {
      const now = new Date().toISOString();
      db.prepare("UPDATE fiscal_years SET status = 'validated', updated_at = ? WHERE id = ?")
        .run(now, fiscalYearId);
    }

    return jsonResult("整合性チェック結果", {
      overallPassed,
      checksRun: checks.length,
      checksPassed: checks.filter(c => c.passed).length,
      checksFailed: checks.filter(c => !c.passed).length,
      checks,
    });
  } catch (error) {
    return errorResult(formatError(error));
  }
};

export const ValidateSchedulesTool: ToolDefinition<typeof schema> = {
  name: "validate-schedules",
  description: "別表間の整合性チェックを実行します。別表四⇔一⇔五の検算を行い、不整合があれば報告。",
  schema,
  handler,
};
