import { describe, it, expect } from "vitest";

// Test the dividend received deduction logic
describe("schedule 08 - dividend received deduction", () => {
  const EXCLUSION_RATES: Record<string, number> = {
    complete_subsidiary: 1.0,
    related_company: 1.0,
    other_over5: 0.5,
    non_controlling: 0.2,
  };

  function calcDividendExclusion(
    dividends: Array<{
      ownershipCategory: string;
      dividendAmount: number;
      relatedDebtInterest: number;
    }>,
  ) {
    let totalDividend = 0;
    let totalExclusion = 0;

    for (const div of dividends) {
      const rate = EXCLUSION_RATES[div.ownershipCategory];
      const grossExclusion = Math.floor(div.dividendAmount * rate);
      const debtInterest = (div.ownershipCategory === "related_company" || div.ownershipCategory === "other_over5")
        ? div.relatedDebtInterest : 0;
      const netExclusion = Math.max(0, grossExclusion - debtInterest);
      totalDividend += div.dividendAmount;
      totalExclusion += netExclusion;
    }

    return { totalDividend, totalExclusion, taxableAmount: totalDividend - totalExclusion };
  }

  it("complete subsidiary - 100% excluded", () => {
    const result = calcDividendExclusion([
      { ownershipCategory: "complete_subsidiary", dividendAmount: 1000000, relatedDebtInterest: 0 },
    ]);
    expect(result.totalExclusion).toBe(1000000);
    expect(result.taxableAmount).toBe(0);
  });

  it("related company - 100% minus debt interest", () => {
    const result = calcDividendExclusion([
      { ownershipCategory: "related_company", dividendAmount: 1000000, relatedDebtInterest: 200000 },
    ]);
    expect(result.totalExclusion).toBe(800000);
    expect(result.taxableAmount).toBe(200000);
  });

  it("other_over5 - 50% minus debt interest", () => {
    const result = calcDividendExclusion([
      { ownershipCategory: "other_over5", dividendAmount: 1000000, relatedDebtInterest: 100000 },
    ]);
    // 50% of 1M = 500K, minus 100K debt interest = 400K
    expect(result.totalExclusion).toBe(400000);
    expect(result.taxableAmount).toBe(600000);
  });

  it("non_controlling - 20% excluded, no debt interest deduction", () => {
    const result = calcDividendExclusion([
      { ownershipCategory: "non_controlling", dividendAmount: 1000000, relatedDebtInterest: 50000 },
    ]);
    // 20% of 1M = 200K (debt interest ignored for non_controlling)
    expect(result.totalExclusion).toBe(200000);
    expect(result.taxableAmount).toBe(800000);
  });

  it("mixed categories", () => {
    const result = calcDividendExclusion([
      { ownershipCategory: "complete_subsidiary", dividendAmount: 500000, relatedDebtInterest: 0 },
      { ownershipCategory: "non_controlling", dividendAmount: 300000, relatedDebtInterest: 0 },
    ]);
    // 500K fully excluded + 300K × 20% = 60K excluded = total 560K excluded
    expect(result.totalDividend).toBe(800000);
    expect(result.totalExclusion).toBe(560000);
    expect(result.taxableAmount).toBe(240000);
  });

  it("debt interest cannot make exclusion negative", () => {
    const result = calcDividendExclusion([
      { ownershipCategory: "related_company", dividendAmount: 100000, relatedDebtInterest: 200000 },
    ]);
    // 100% of 100K = 100K, minus 200K debt interest → clamped to 0
    expect(result.totalExclusion).toBe(0);
    expect(result.taxableAmount).toBe(100000);
  });
});
