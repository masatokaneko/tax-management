import { describe, it, expect } from "vitest";

describe("enterprise tax - progressive brackets", () => {
  const BRACKETS = [
    { threshold: 4000000, rate: 0.0348 },
    { threshold: 8000000, rate: 0.0521 },
    { threshold: null as number | null, rate: 0.0695 },
  ];

  function calcEnterpriseTax(taxableIncome: number) {
    let remaining = taxableIncome;
    let total = 0;
    let prevThreshold = 0;

    for (const bracket of BRACKETS) {
      const limit = bracket.threshold !== null ? bracket.threshold - prevThreshold : Infinity;
      const taxable = Math.min(remaining, limit);
      if (taxable <= 0) break;
      total += Math.floor(taxable * bracket.rate);
      remaining -= taxable;
      prevThreshold = bracket.threshold ?? prevThreshold;
    }

    return Math.floor(total / 100) * 100;
  }

  it("income under 4M - first bracket only", () => {
    // 3M × 3.48% = 104,400 → 104400
    const tax = calcEnterpriseTax(3000000);
    expect(tax).toBe(104400);
  });

  it("income at 8M - two brackets", () => {
    // First 4M × 3.48% = 139,200
    // Next 4M × 5.21% = 208,400
    // Total = 347,600 → 347600
    const tax = calcEnterpriseTax(8000000);
    expect(tax).toBe(347600);
  });

  it("income at 20M - all three brackets", () => {
    // First 4M × 3.48% = 139,200
    // Next 4M × 5.21% = 208,400
    // Remaining 12M × 6.95% = 834,000
    // Total = 1,181,600 → 1181600
    const tax = calcEnterpriseTax(20000000);
    expect(tax).toBe(1181600);
  });

  it("zero income -> zero tax", () => {
    expect(calcEnterpriseTax(0)).toBe(0);
  });
});

describe("special enterprise tax", () => {
  it("37% of standard enterprise tax", () => {
    const standardEnterpriseTax = 300000;
    const specialTax = Math.floor(standardEnterpriseTax * 0.37 / 100) * 100;
    expect(specialTax).toBe(111000);
  });
});

describe("resident tax - per capita (均等割)", () => {
  const CAPITAL_BRACKETS = [
    { capital: 10000000, employees50orLess: 50000, employeesOver50: 120000 },
    { capital: 100000000, employees50orLess: 130000, employeesOver50: 150000 },
    { capital: 1000000000, employees50orLess: 160000, employeesOver50: 400000 },
    { capital: 5000000000, employees50orLess: 410000, employeesOver50: 1750000 },
    { capital: null as number | null, employees50orLess: 410000, employeesOver50: 3000000 },
  ];

  function getPerCapita(capitalAmount: number, employeeCount: number) {
    for (const bracket of CAPITAL_BRACKETS) {
      if (bracket.capital === null || capitalAmount <= bracket.capital) {
        return employeeCount > 50 ? bracket.employeesOver50 : bracket.employees50orLess;
      }
    }
    return 0;
  }

  it("small company (capital ≤ 10M, ≤ 50 employees) → 50,000", () => {
    expect(getPerCapita(10000000, 10)).toBe(50000);
  });

  it("medium company (capital ≤ 100M, > 50 employees) → 150,000", () => {
    expect(getPerCapita(50000000, 100)).toBe(150000);
  });

  it("large company (capital > 5B, > 50 employees) → 3,000,000", () => {
    expect(getPerCapita(10000000000, 1000)).toBe(3000000);
  });
});

describe("resident tax - tax on income (法人税割)", () => {
  it("Tokyo combined rate (1.77% + 5.95%) on corporate tax", () => {
    const corporateTax = 1000000;
    const prefectural = Math.floor(corporateTax * 0.0177 / 100) * 100;
    const municipal = Math.floor(corporateTax * 0.0595 / 100) * 100;
    expect(prefectural).toBe(17700);
    expect(municipal).toBe(59500);
    expect(prefectural + municipal).toBe(77200);
  });
});
