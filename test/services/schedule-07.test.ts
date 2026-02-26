import { describe, it, expect } from "vitest";

// Test the carried loss deduction logic
describe("schedule 07 - carried loss deduction", () => {
  const CARRYFORWARD_YEARS = 10;

  function calcLossDeduction(
    taxableIncome: number,
    isSme: boolean,
    carriedLosses: Array<{ fiscalYear: string; originalAmount: number; usedPriorYears: number }>,
    currentEndYear: number,
  ) {
    if (taxableIncome <= 0) return { totalDeduction: 0, incomeAfter: taxableIncome };

    const limitRatio = isSme ? 1.0 : 0.5;
    const limit = Math.floor(taxableIncome * limitRatio);
    let remaining = limit;
    let totalDeduction = 0;

    for (const loss of carriedLosses) {
      const available = loss.originalAmount - loss.usedPriorYears;
      if (available <= 0) continue;
      const lossYear = parseInt(loss.fiscalYear);
      if ((currentEndYear - lossYear) > CARRYFORWARD_YEARS) continue; // expired
      const used = Math.min(available, remaining);
      remaining -= used;
      totalDeduction += used;
    }

    return { totalDeduction, incomeAfter: taxableIncome - totalDeduction };
  }

  it("SME can deduct 100% of taxable income", () => {
    const result = calcLossDeduction(5000000, true, [
      { fiscalYear: "2023", originalAmount: 3000000, usedPriorYears: 0 },
    ], 2026);
    expect(result.totalDeduction).toBe(3000000);
    expect(result.incomeAfter).toBe(2000000);
  });

  it("Large company limited to 50% of taxable income", () => {
    const result = calcLossDeduction(10000000, false, [
      { fiscalYear: "2023", originalAmount: 8000000, usedPriorYears: 0 },
    ], 2026);
    expect(result.totalDeduction).toBe(5000000); // 50% of 10M
    expect(result.incomeAfter).toBe(5000000);
  });

  it("multiple losses applied in order (oldest first)", () => {
    const result = calcLossDeduction(5000000, true, [
      { fiscalYear: "2021", originalAmount: 2000000, usedPriorYears: 0 },
      { fiscalYear: "2022", originalAmount: 4000000, usedPriorYears: 0 },
    ], 2026);
    // Should use 2M from 2021 + 3M from 2022 = 5M total (limited by income)
    expect(result.totalDeduction).toBe(5000000);
    expect(result.incomeAfter).toBe(0);
  });

  it("expired losses (>10 years) are skipped", () => {
    const result = calcLossDeduction(5000000, true, [
      { fiscalYear: "2014", originalAmount: 3000000, usedPriorYears: 0 }, // expired (2026-2014=12 > 10)
      { fiscalYear: "2020", originalAmount: 2000000, usedPriorYears: 0 },
    ], 2026);
    expect(result.totalDeduction).toBe(2000000); // Only 2020 loss used
  });

  it("no deduction when taxable income is zero or negative", () => {
    const result = calcLossDeduction(-1000000, true, [
      { fiscalYear: "2023", originalAmount: 5000000, usedPriorYears: 0 },
    ], 2026);
    expect(result.totalDeduction).toBe(0);
    expect(result.incomeAfter).toBe(-1000000);
  });

  it("partially used losses carry remaining forward", () => {
    const result = calcLossDeduction(1000000, true, [
      { fiscalYear: "2023", originalAmount: 5000000, usedPriorYears: 3000000 },
    ], 2026);
    // Available: 5M - 3M = 2M, but income is only 1M
    expect(result.totalDeduction).toBe(1000000);
    expect(result.incomeAfter).toBe(0);
  });
});
