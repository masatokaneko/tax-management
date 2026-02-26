import { describe, it, expect } from "vitest";

// Test the donation deduction limit logic
describe("schedule 14 - donation deduction limit", () => {
  function calcDonationLimit(
    capitalAmount: number,
    taxableIncome: number,
    generalDonations: number,
    designatedDonations: number,
    nationalGovDonations: number,
    fiscalYearMonths: number = 12,
  ) {
    const income = Math.max(0, taxableIncome);

    // National/local gov donations: fully deductible
    const govDeductible = nationalGovDonations;

    // Designated donation special limit: (capital × 0.375% × months/12 + income × 6.25%) ÷ 2
    const designatedLimit = Math.floor(
      (Math.floor(capitalAmount * 0.00375 * fiscalYearMonths / 12) +
       Math.floor(income * 0.0625)) / 2
    );
    const designatedDeductible = Math.min(designatedDonations, designatedLimit);
    const designatedExcess = designatedDonations - designatedDeductible;

    // General donation limit: (capital × 0.25% × months/12 + income × 2.5%) ÷ 4
    const generalLimit = Math.floor(
      (Math.floor(capitalAmount * 0.0025 * fiscalYearMonths / 12) +
       Math.floor(income * 0.025)) / 4
    );
    const generalTotal = generalDonations + designatedExcess;
    const generalDeductible = Math.min(generalTotal, generalLimit);
    const generalNonDeductible = generalTotal - generalDeductible;

    const totalDonations = generalDonations + designatedDonations + nationalGovDonations;
    const totalDeductible = govDeductible + designatedDeductible + generalDeductible;
    const totalNonDeductible = totalDonations - totalDeductible;

    return { generalLimit, designatedLimit, totalDeductible, totalNonDeductible };
  }

  it("national/local gov donations are fully deductible", () => {
    const result = calcDonationLimit(10000000, 50000000, 0, 0, 5000000);
    expect(result.totalDeductible).toBe(5000000);
    expect(result.totalNonDeductible).toBe(0);
  });

  it("general donation limit calculation", () => {
    // Capital: 10M, Income: 50M
    // General limit = (10M × 0.25% + 50M × 2.5%) ÷ 4 = (25000 + 1250000) / 4 = 318750
    const result = calcDonationLimit(10000000, 50000000, 500000, 0, 0);
    expect(result.generalLimit).toBe(318750);
    expect(result.totalDeductible).toBe(318750);
    expect(result.totalNonDeductible).toBe(181250); // 500K - 318750
  });

  it("designated donation limit calculation", () => {
    // Capital: 10M, Income: 50M
    // Designated limit = (10M × 0.375% + 50M × 6.25%) ÷ 2 = (37500 + 3125000) / 2 = 1581250
    const result = calcDonationLimit(10000000, 50000000, 0, 1000000, 0);
    expect(result.designatedLimit).toBe(1581250);
    expect(result.totalDeductible).toBe(1000000); // Under limit, fully deductible
    expect(result.totalNonDeductible).toBe(0);
  });

  it("designated excess flows to general", () => {
    // Capital: 10M, Income: 10M
    // Designated limit = (37500 + 625000) / 2 = 331250
    // Designated: 500K → deductible 331250, excess 168750
    // General limit = (25000 + 250000) / 4 = 68750
    // General total = 100K + 168750 excess = 268750
    // General deductible = min(268750, 68750) = 68750
    const result = calcDonationLimit(10000000, 10000000, 100000, 500000, 0);
    expect(result.designatedLimit).toBe(331250);
    expect(result.generalLimit).toBe(68750);
    expect(result.totalDeductible).toBe(331250 + 68750); // 400000
    expect(result.totalNonDeductible).toBe(200000); // 600K - 400K
  });

  it("negative taxable income uses zero for limit calculation", () => {
    // Income = -1M → use 0 for calculation
    // General limit = (10M × 0.25% + 0) / 4 = 25000 / 4 = 6250
    const result = calcDonationLimit(10000000, -1000000, 100000, 0, 0);
    expect(result.generalLimit).toBe(6250);
    expect(result.totalDeductible).toBe(6250);
  });

  it("short fiscal year (6 months) adjusts capital portion", () => {
    // Capital: 10M, Income: 50M, 6 months
    // General limit = (10M × 0.25% × 6/12 + 50M × 2.5%) / 4 = (12500 + 1250000) / 4 = 315625
    const result = calcDonationLimit(10000000, 50000000, 400000, 0, 0, 6);
    expect(result.generalLimit).toBe(315625);
  });
});
