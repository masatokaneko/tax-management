import { describe, it, expect } from "vitest";

// Test the entertainment expense logic directly
describe("schedule 15 - entertainment expense", () => {
  const SME_LIMIT = 8000000;

  function calcNonDeductible(
    totalEntertainment: number,
    diningExpense: number,
    isSme: boolean,
  ) {
    const methodA = isSme ? totalEntertainment - Math.min(totalEntertainment, SME_LIMIT) : Infinity;
    const methodB = totalEntertainment - Math.floor(diningExpense * 0.5);
    return Math.min(methodA, methodB);
  }

  it("SME under 800万 - all deductible via method A", () => {
    expect(calcNonDeductible(5000000, 3000000, true)).toBe(0);
  });

  it("SME over 800万 - method A caps at 800万", () => {
    expect(calcNonDeductible(10000000, 2000000, true)).toBe(2000000);
  });

  it("SME chooses method B when dining expenses are large", () => {
    // Total: 10M, dining: 18M (dining > total is possible with different categorization)
    // Method A: 10M - 8M = 2M non-deductible
    // Method B: 10M - 9M = 1M non-deductible -> choose B
    expect(calcNonDeductible(10000000, 18000000, true)).toBe(1000000);
  });

  it("large company - only method B available", () => {
    // Total: 10M, dining: 6M
    // Method B: 10M - 3M = 7M non-deductible
    expect(calcNonDeductible(10000000, 6000000, false)).toBe(7000000);
  });

  it("zero entertainment expense", () => {
    expect(calcNonDeductible(0, 0, true)).toBe(0);
  });
});
