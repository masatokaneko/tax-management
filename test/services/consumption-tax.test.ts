import { describe, it, expect } from "vitest";

describe("consumption tax - general", () => {
  const STANDARD_TAX = 0.078;
  const REDUCED_TAX = 0.0624;

  function calcOutputTax(standardSales: number, reducedSales: number) {
    return {
      standard: Math.floor(standardSales * STANDARD_TAX),
      reduced: Math.floor(reducedSales * REDUCED_TAX),
    };
  }

  it("standard rate output tax calculation", () => {
    const result = calcOutputTax(10000000, 0);
    expect(result.standard).toBe(780000); // 10M × 7.8%
  });

  it("reduced rate output tax calculation", () => {
    const result = calcOutputTax(0, 5000000);
    expect(result.reduced).toBe(312000); // 5M × 6.24%
  });

  it("mixed rate output tax", () => {
    const result = calcOutputTax(8000000, 2000000);
    expect(result.standard).toBe(624000);
    expect(result.reduced).toBe(124800); // 2M × 6.24%
  });
});

describe("consumption tax - simplified", () => {
  const DEEMED_RATES: Record<string, number> = {
    "1": 0.90, "2": 0.80, "3": 0.70,
    "4": 0.60, "5": 0.50, "6": 0.40,
  };

  function calcSimplified(type: string, outputTax: number) {
    const deemedInput = Math.floor(outputTax * DEEMED_RATES[type]);
    return outputTax - deemedInput;
  }

  it("wholesale (type 1) - 90% deemed purchase rate", () => {
    const tax = calcSimplified("1", 1000000);
    expect(tax).toBe(100000); // 10% of output tax
  });

  it("service (type 5) - 50% deemed purchase rate", () => {
    const tax = calcSimplified("5", 1000000);
    expect(tax).toBe(500000); // 50% of output tax
  });

  it("real estate (type 6) - 40% deemed purchase rate", () => {
    const tax = calcSimplified("6", 1000000);
    expect(tax).toBe(600000); // 60% of output tax
  });
});

describe("invoice transition deduction rate", () => {
  function getDeductionRate(fyEndDate: string) {
    const periods = [
      { periodFrom: "2023-10-01", periodTo: "2026-09-30", deductionRate: 0.80 },
      { periodFrom: "2026-10-01", periodTo: "2029-09-30", deductionRate: 0.50 },
    ];
    for (const period of periods) {
      if (fyEndDate >= period.periodFrom && fyEndDate <= period.periodTo) {
        return period.deductionRate;
      }
    }
    return 0;
  }

  it("FY ending March 2026 -> 80% deduction", () => {
    expect(getDeductionRate("2026-03-31")).toBe(0.80);
  });

  it("FY ending March 2027 -> 50% deduction", () => {
    expect(getDeductionRate("2027-03-31")).toBe(0.50);
  });

  it("FY ending after Sept 2029 -> 0% deduction", () => {
    expect(getDeductionRate("2030-03-31")).toBe(0);
  });
});
