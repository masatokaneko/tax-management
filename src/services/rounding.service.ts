/**
 * Tax rounding utilities.
 * All amounts are integers (yen). No floating point for money.
 */

/** Round down to the nearest unit (floor). */
export function floorToUnit(amount: number, unit: number): number {
  return Math.floor(amount / unit) * unit;
}

/** Taxable income: floor to 1,000 yen */
export function roundTaxableIncome(amount: number): number {
  return floorToUnit(amount, 1000);
}

/** Tax amount: floor to 100 yen */
export function roundTaxAmount(amount: number): number {
  return floorToUnit(amount, 100);
}

/**
 * Compute tax from taxable income and rate.
 * Uses integer math: taxableIncome * rate, then floors to 100 yen.
 */
export function computeTax(taxableIncome: number, rate: number): number {
  return roundTaxAmount(Math.floor(taxableIncome * rate));
}
