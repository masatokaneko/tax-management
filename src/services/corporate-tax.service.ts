import { getCorporateTaxRates } from "./tax-rates.service.js";
import { roundTaxableIncome, roundTaxAmount, computeTax } from "./rounding.service.js";
import type { CorporateTaxRates } from "../types/index.js";

export interface CorporateTaxInput {
  fiscalYear: string;
  fiscalYearStartDate?: string; // For defense special tax applicability check (YYYY-MM-DD)
  taxableIncome: number;       // From schedule 04 (before rounding)
  capitalAmount: number;       // Capital (yen)
  priorInterimTax: number;     // Prior interim tax paid
  taxCredits: number;          // From schedule 06
  carriedLossDeduction: number; // From schedule 07
}

export interface CorporateTaxResult {
  // Schedule 01 outputs
  taxableIncomeRounded: number;     // Rounded to 1000 yen
  corporateTaxAmount: number;       // Corporate tax before credits
  taxCreditsApplied: number;
  corporateTaxAfterCredits: number;
  localCorporateTax: number;        // 10.3% of corporate tax
  defenseSpecialTax: number;        // 4% of (corporate tax - 500万), if applicable
  totalNationalTax: number;
  interimTaxPaid: number;
  nationalTaxPayable: number;       // Amount to pay (or refund if negative)

  // Breakdown for SME reduced rate
  smeReducedPortion: number;
  smeStandardPortion: number;
  rates: CorporateTaxRates;
}

export function calculateCorporateTax(input: CorporateTaxInput): CorporateTaxResult {
  const rates = getCorporateTaxRates(input.fiscalYear);
  const isSme = input.capitalAmount <= rates.corporateTax.sme.capitalThreshold;

  // Round taxable income to 1000 yen (floor)
  const incomeAfterLoss = Math.max(0, input.taxableIncome - input.carriedLossDeduction);
  const taxableIncomeRounded = roundTaxableIncome(incomeAfterLoss);

  // Calculate corporate tax
  let corporateTaxAmount: number;
  let smeReducedPortion = 0;
  let smeStandardPortion = 0;

  if (isSme && taxableIncomeRounded > 0) {
    const threshold = rates.corporateTax.sme.reducedRateThreshold;
    if (taxableIncomeRounded <= threshold) {
      // All at reduced rate
      smeReducedPortion = computeTax(taxableIncomeRounded, rates.corporateTax.sme.reducedRate);
      corporateTaxAmount = smeReducedPortion;
    } else {
      // Split: reduced rate up to threshold, standard rate for the rest
      smeReducedPortion = computeTax(threshold, rates.corporateTax.sme.reducedRate);
      smeStandardPortion = computeTax(taxableIncomeRounded - threshold, rates.corporateTax.sme.standardRate);
      corporateTaxAmount = roundTaxAmount(smeReducedPortion + smeStandardPortion);
    }
  } else {
    corporateTaxAmount = computeTax(taxableIncomeRounded, rates.corporateTax.standardRate);
  }

  // Tax credits (schedule 06)
  const taxCreditsApplied = Math.min(input.taxCredits, corporateTaxAmount);
  const corporateTaxAfterCredits = corporateTaxAmount - taxCreditsApplied;

  // Local corporate tax (地方法人税) = corporate tax * 10.3%
  const localCorporateTax = roundTaxAmount(Math.floor(corporateTaxAfterCredits * rates.localCorporateTax.rate));

  // Defense special tax (防衛特別法人税)
  // Only applies if fiscal year starts on or after the defense tax start date
  let defenseSpecialTax = 0;
  const defenseApplicable = rates.defenseSpecialTax.applicable
    && rates.defenseSpecialTax.startDate
    && (!input.fiscalYearStartDate || input.fiscalYearStartDate >= rates.defenseSpecialTax.startDate);
  if (defenseApplicable) {
    const base = corporateTaxAfterCredits - rates.defenseSpecialTax.deductionAmount;
    if (base > 0) {
      defenseSpecialTax = roundTaxAmount(Math.floor(base * rates.defenseSpecialTax.rate));
    }
  }

  const totalNationalTax = corporateTaxAfterCredits + localCorporateTax + defenseSpecialTax;
  const nationalTaxPayable = totalNationalTax - input.priorInterimTax;

  return {
    taxableIncomeRounded,
    corporateTaxAmount,
    taxCreditsApplied,
    corporateTaxAfterCredits,
    localCorporateTax,
    defenseSpecialTax,
    totalNationalTax,
    interimTaxPaid: input.priorInterimTax,
    nationalTaxPayable,
    smeReducedPortion,
    smeStandardPortion,
    rates,
  };
}
