import { describe, it, expect } from "vitest";

// Test the income tax credit logic
describe("schedule 06 - income tax credit", () => {
  function calcTaxCredit(
    withheldTaxes: Array<{ withheldTax: number }>,
    corporateTaxAmount: number,
  ) {
    const totalWithheld = withheldTaxes.reduce((sum, t) => sum + t.withheldTax, 0);
    const creditable = Math.min(totalWithheld, corporateTaxAmount);
    const excess = totalWithheld - creditable;
    return { totalWithheld, creditable, excess };
  }

  it("all withheld tax credited when less than corporate tax", () => {
    const result = calcTaxCredit(
      [{ withheldTax: 100000 }, { withheldTax: 50000 }],
      500000,
    );
    expect(result.totalWithheld).toBe(150000);
    expect(result.creditable).toBe(150000);
    expect(result.excess).toBe(0);
  });

  it("credit limited to corporate tax amount", () => {
    const result = calcTaxCredit(
      [{ withheldTax: 300000 }, { withheldTax: 400000 }],
      500000,
    );
    expect(result.totalWithheld).toBe(700000);
    expect(result.creditable).toBe(500000);
    expect(result.excess).toBe(200000);
  });

  it("zero withheld taxes", () => {
    const result = calcTaxCredit([], 500000);
    expect(result.totalWithheld).toBe(0);
    expect(result.creditable).toBe(0);
    expect(result.excess).toBe(0);
  });

  it("single withheld tax item", () => {
    const result = calcTaxCredit([{ withheldTax: 15315 }], 1000000);
    expect(result.creditable).toBe(15315);
  });
});
