import { describe, it, expect } from "vitest";
import {
  floorToUnit,
  roundTaxableIncome,
  roundTaxAmount,
  computeTax,
} from "../../src/services/rounding.service.js";

describe("rounding.service", () => {
  describe("floorToUnit", () => {
    it("floors to 1000", () => {
      expect(floorToUnit(1234567, 1000)).toBe(1234000);
    });

    it("floors to 100", () => {
      expect(floorToUnit(1234567, 100)).toBe(1234500);
    });

    it("exact multiple stays the same", () => {
      expect(floorToUnit(5000000, 1000)).toBe(5000000);
    });

    it("handles zero", () => {
      expect(floorToUnit(0, 1000)).toBe(0);
    });

    it("handles negative amounts", () => {
      expect(floorToUnit(-1234567, 1000)).toBe(-1235000);
    });
  });

  describe("roundTaxableIncome", () => {
    it("rounds taxable income to 1000 yen floor", () => {
      expect(roundTaxableIncome(12345678)).toBe(12345000);
    });

    it("exact thousand stays", () => {
      expect(roundTaxableIncome(8000000)).toBe(8000000);
    });

    it("rounds 999 to 0", () => {
      expect(roundTaxableIncome(999)).toBe(0);
    });
  });

  describe("roundTaxAmount", () => {
    it("rounds tax amount to 100 yen floor", () => {
      expect(roundTaxAmount(1234567)).toBe(1234500);
    });

    it("exact hundred stays", () => {
      expect(roundTaxAmount(500000)).toBe(500000);
    });
  });

  describe("computeTax", () => {
    it("computes tax with rounding", () => {
      // 8,000,000 * 0.15 = 1,200,000 (exact)
      expect(computeTax(8000000, 0.15)).toBe(1200000);
    });

    it("floors intermediate result", () => {
      // 10,000,000 * 0.232 = 2,320,000 (exact)
      expect(computeTax(10000000, 0.232)).toBe(2320000);
    });

    it("handles small amounts", () => {
      // 1,000 * 0.15 = 150 -> floor to 100 = 100
      expect(computeTax(1000, 0.15)).toBe(100);
    });
  });
});
