import { describe, it, expect } from "vitest";
import { calculateCorporateTax } from "../../src/services/corporate-tax.service.js";

describe("corporate-tax.service", () => {
  describe("calculateCorporateTax", () => {
    it("calculates tax for SME with income below threshold (2025)", () => {
      const result = calculateCorporateTax({
        fiscalYear: "2025",
        taxableIncome: 5000000, // 500万円
        capitalAmount: 10000000, // 資本金1000万円 (SME)
        priorInterimTax: 0,
        taxCredits: 0,
        carriedLossDeduction: 0,
      });

      // 5,000,000 -> rounded to 5,000,000 (already multiple of 1000)
      expect(result.taxableIncomeRounded).toBe(5000000);
      // All at reduced rate: 5,000,000 * 0.15 = 750,000
      expect(result.smeReducedPortion).toBe(750000);
      expect(result.smeStandardPortion).toBe(0);
      expect(result.corporateTaxAmount).toBe(750000);
      // Local corporate tax: 750,000 * 0.103 = 77,250 -> floor to 77,200
      expect(result.localCorporateTax).toBe(77200);
      // No defense tax in 2025
      expect(result.defenseSpecialTax).toBe(0);
    });

    it("calculates tax for SME with income above threshold (2025)", () => {
      const result = calculateCorporateTax({
        fiscalYear: "2025",
        taxableIncome: 15000000, // 1500万円
        capitalAmount: 10000000,
        priorInterimTax: 0,
        taxCredits: 0,
        carriedLossDeduction: 0,
      });

      // Rounded: 15,000,000
      expect(result.taxableIncomeRounded).toBe(15000000);
      // SME: 8,000,000 * 0.15 = 1,200,000
      expect(result.smeReducedPortion).toBe(1200000);
      // Remaining: 7,000,000 * 0.232 = 1,624,000
      expect(result.smeStandardPortion).toBe(1624000);
      // Total: 1,200,000 + 1,624,000 = 2,824,000
      expect(result.corporateTaxAmount).toBe(2824000);
    });

    it("calculates tax for large company (2025)", () => {
      const result = calculateCorporateTax({
        fiscalYear: "2025",
        taxableIncome: 100000000, // 1億円
        capitalAmount: 200000000, // 資本金2億円 (not SME)
        priorInterimTax: 0,
        taxCredits: 0,
        carriedLossDeduction: 0,
      });

      // All at standard rate: 100,000,000 * 0.232 = 23,200,000
      expect(result.corporateTaxAmount).toBe(23200000);
      // Local: 23,200,000 * 0.103 = 2,389,600
      expect(result.localCorporateTax).toBe(2389600);
    });

    it("applies defense special tax for 2026", () => {
      const result = calculateCorporateTax({
        fiscalYear: "2026",
        taxableIncome: 100000000,
        capitalAmount: 200000000,
        priorInterimTax: 0,
        taxCredits: 0,
        carriedLossDeduction: 0,
      });

      // Corporate tax: 23,200,000
      expect(result.corporateTaxAmount).toBe(23200000);
      // Defense tax: (23,200,000 - 5,000,000) * 0.04 = 728,000
      expect(result.defenseSpecialTax).toBe(728000);
    });

    it("defense special tax is zero when corporate tax is small (2026)", () => {
      const result = calculateCorporateTax({
        fiscalYear: "2026",
        taxableIncome: 5000000,
        capitalAmount: 10000000,
        priorInterimTax: 0,
        taxCredits: 0,
        carriedLossDeduction: 0,
      });

      // Corporate tax: 750,000 (below 5,000,000 deduction)
      expect(result.defenseSpecialTax).toBe(0);
    });

    it("handles carried loss deduction", () => {
      const result = calculateCorporateTax({
        fiscalYear: "2025",
        taxableIncome: 10000000,
        capitalAmount: 10000000,
        priorInterimTax: 0,
        taxCredits: 0,
        carriedLossDeduction: 3000000, // 300万円の繰越欠損金
      });

      // 10,000,000 - 3,000,000 = 7,000,000
      expect(result.taxableIncomeRounded).toBe(7000000);
    });

    it("handles tax credits", () => {
      const result = calculateCorporateTax({
        fiscalYear: "2025",
        taxableIncome: 10000000,
        capitalAmount: 10000000,
        priorInterimTax: 0,
        taxCredits: 200000, // 20万円の税額控除
        carriedLossDeduction: 0,
      });

      // Corporate tax: 8,000,000 * 0.15 + 2,000,000 * 0.232 = 1,200,000 + 464,000 = 1,664,000
      expect(result.corporateTaxAmount).toBe(1664000);
      // After credits: 1,664,000 - 200,000 = 1,464,000
      expect(result.corporateTaxAfterCredits).toBe(1464000);
    });

    it("handles prior interim tax payment", () => {
      const result = calculateCorporateTax({
        fiscalYear: "2025",
        taxableIncome: 10000000,
        capitalAmount: 10000000,
        priorInterimTax: 500000, // 50万円の中間納付
        taxCredits: 0,
        carriedLossDeduction: 0,
      });

      expect(result.interimTaxPaid).toBe(500000);
      expect(result.nationalTaxPayable).toBe(result.totalNationalTax - 500000);
    });

    it("handles zero income", () => {
      const result = calculateCorporateTax({
        fiscalYear: "2025",
        taxableIncome: 0,
        capitalAmount: 10000000,
        priorInterimTax: 0,
        taxCredits: 0,
        carriedLossDeduction: 0,
      });

      expect(result.taxableIncomeRounded).toBe(0);
      expect(result.corporateTaxAmount).toBe(0);
      expect(result.totalNationalTax).toBe(0);
    });

    it("handles negative income (loss)", () => {
      const result = calculateCorporateTax({
        fiscalYear: "2025",
        taxableIncome: -5000000, // 500万円の赤字
        capitalAmount: 10000000,
        priorInterimTax: 0,
        taxCredits: 0,
        carriedLossDeduction: 0,
      });

      expect(result.taxableIncomeRounded).toBe(0);
      expect(result.corporateTaxAmount).toBe(0);
    });
  });
});
