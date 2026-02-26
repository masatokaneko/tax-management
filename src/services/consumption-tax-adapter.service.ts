/**
 * Adapter: converts ConsumptionTaxAggregation (from aggregator) into
 * the flat shape expected by calculate-general.tool.ts.
 *
 * This bridges the structured aggregation (rate-keyed buckets) to
 * the flat interface the general tool's calculation logic uses.
 */

import type {
  ConsumptionTaxAggregation,
  RateBucket,
  PurchaseBuckets,
} from "./consumption-tax-aggregator.service.js";

/** Invoice transition amounts broken down by purchase use and rate */
export interface InvoiceTransitionByUse {
  taxableStd: number;
  taxableRed: number;
  nonTaxableStd: number;
  nonTaxableRed: number;
  commonStd: number;
  commonRed: number;
}

function emptyInvoiceTransitionByUse(): InvoiceTransitionByUse {
  return { taxableStd: 0, taxableRed: 0, nonTaxableStd: 0, nonTaxableRed: 0, commonStd: 0, commonRed: 0 };
}

/**
 * Flat aggregation shape consumed by calculate-general.tool.ts
 */
export interface FlatConsumptionTaxData {
  // Sales
  standardRateSales: number;
  reducedRateSales: number;
  exemptSales: number;
  nonTaxableSales: number;

  // Purchases by use (individual attribution method, all rates combined)
  taxablePurchases: number;
  nonTaxablePurchases: number;
  commonPurchases: number;

  // Purchases by use AND rate (needed for tax calculation)
  taxablePurchasesStandard: number;
  taxablePurchasesReduced: number;
  nonTaxablePurchasesStandard: number;
  nonTaxablePurchasesReduced: number;
  commonPurchasesStandard: number;
  commonPurchasesReduced: number;

  // Invoice transition
  nonQualifiedPurchases80: number;
  nonQualifiedPurchases50: number;
  nonQualifiedPurchases80Standard: number;
  nonQualifiedPurchases80Reduced: number;
  nonQualifiedPurchases50Standard: number;
  nonQualifiedPurchases50Reduced: number;

  // Returns & bad debts
  salesReturnStandard: number;
  salesReturnReduced: number;
  badDebtStandard: number;
  badDebtReduced: number;

  // Purchase returns (by use type and rate)
  purchaseReturnTaxableStandard: number;
  purchaseReturnTaxableReduced: number;
  purchaseReturnNonTaxableStandard: number;
  purchaseReturnNonTaxableReduced: number;
  purchaseReturnCommonStandard: number;
  purchaseReturnCommonReduced: number;

  // Bad debt recovered (控除過大調整税額)
  badDebtRecoveredStandard: number;
  badDebtRecoveredReduced: number;

  // Invoice transition — by use (for individual attribution method)
  nq80ByUse: InvoiceTransitionByUse;
  nq50ByUse: InvoiceTransitionByUse;

  // Invoice transition purchase returns — by use
  nqReturn80ByUse: InvoiceTransitionByUse;
  nqReturn50ByUse: InvoiceTransitionByUse;

  // Import tax payments (amount IS tax, not base — by purchase use)
  importTaxPaymentTaxable: number;
  importTaxPaymentNonTaxable: number;
  importTaxPaymentCommon: number;

  // Securities transfer (有価証券譲渡 — 5% rule)
  securitiesTransfer: number;

  // Audit metadata from aggregator
  unclassifiedTaxCodes: number[];
  totalEntries: number;
  classifiedEntries: number;
  unclassifiedEntries: number;

  // Reconciliation data
  totalVatFromFreee: number;
  dealCount: number;
  manualJournalCount: number;
}

/** Sum taxableAmount across standard_10 and reduced_8 buckets */
function sumBucketPair(
  standard: RateBucket,
  reduced: RateBucket,
): { total: number; standard: number; reduced: number } {
  return {
    total: standard.taxableAmount + reduced.taxableAmount,
    standard: standard.taxableAmount,
    reduced: reduced.taxableAmount,
  };
}

function sumPurchaseUse(
  buckets: PurchaseBuckets,
  key: "taxablePurchase" | "nonTaxablePurchase" | "commonPurchase",
  std10: PurchaseBuckets,
  r8: PurchaseBuckets,
): { total: number; standard: number; reduced: number } {
  return {
    total: std10[key].taxableAmount + r8[key].taxableAmount,
    standard: std10[key].taxableAmount,
    reduced: r8[key].taxableAmount,
  };
}

/**
 * Convert the structured ConsumptionTaxAggregation into a flat shape.
 *
 * Note: only standard_10 and reduced_8 are used for current-period returns.
 * old_8 and old_5 are ignored (they apply only to prior-year adjustments).
 */
export function flattenAggregation(
  agg: ConsumptionTaxAggregation,
): FlatConsumptionTaxData {
  // --- Sales ---
  const sales = sumBucketPair(agg.sales.standard10, agg.sales.reduced8);

  // --- Purchases ---
  const tp = sumPurchaseUse(
    agg.purchases.standard10,
    "taxablePurchase",
    agg.purchases.standard10,
    agg.purchases.reduced8,
  );
  const ntp = sumPurchaseUse(
    agg.purchases.standard10,
    "nonTaxablePurchase",
    agg.purchases.standard10,
    agg.purchases.reduced8,
  );
  const cp = sumPurchaseUse(
    agg.purchases.standard10,
    "commonPurchase",
    agg.purchases.standard10,
    agg.purchases.reduced8,
  );

  // --- Invoice transition ---
  const it80_s = agg.invoiceTransition.standard10.exempt80;
  const it80_r = agg.invoiceTransition.reduced8.exempt80;
  const it50_s = agg.invoiceTransition.standard10.exempt50;
  const it50_r = agg.invoiceTransition.reduced8.exempt50;

  // Totals (all uses combined) — for full/proportional methods
  const nq80Std = it80_s.taxablePurchase.taxableAmount
    + it80_s.nonTaxablePurchase.taxableAmount
    + it80_s.commonPurchase.taxableAmount;
  const nq80Red = it80_r.taxablePurchase.taxableAmount
    + it80_r.nonTaxablePurchase.taxableAmount
    + it80_r.commonPurchase.taxableAmount;
  const nq50Std = it50_s.taxablePurchase.taxableAmount
    + it50_s.nonTaxablePurchase.taxableAmount
    + it50_s.commonPurchase.taxableAmount;
  const nq50Red = it50_r.taxablePurchase.taxableAmount
    + it50_r.nonTaxablePurchase.taxableAmount
    + it50_r.commonPurchase.taxableAmount;

  // By-use breakdown — for individual attribution method
  const nq80ByUse: InvoiceTransitionByUse = {
    taxableStd: it80_s.taxablePurchase.taxableAmount,
    taxableRed: it80_r.taxablePurchase.taxableAmount,
    nonTaxableStd: it80_s.nonTaxablePurchase.taxableAmount,
    nonTaxableRed: it80_r.nonTaxablePurchase.taxableAmount,
    commonStd: it80_s.commonPurchase.taxableAmount,
    commonRed: it80_r.commonPurchase.taxableAmount,
  };
  const nq50ByUse: InvoiceTransitionByUse = {
    taxableStd: it50_s.taxablePurchase.taxableAmount,
    taxableRed: it50_r.taxablePurchase.taxableAmount,
    nonTaxableStd: it50_s.nonTaxablePurchase.taxableAmount,
    nonTaxableRed: it50_r.nonTaxablePurchase.taxableAmount,
    commonStd: it50_s.commonPurchase.taxableAmount,
    commonRed: it50_r.commonPurchase.taxableAmount,
  };

  // --- Invoice transition purchase returns ---
  const itr80_s = agg.invoiceTransitionPurchaseReturn.standard10.exempt80;
  const itr80_r = agg.invoiceTransitionPurchaseReturn.reduced8.exempt80;
  const itr50_s = agg.invoiceTransitionPurchaseReturn.standard10.exempt50;
  const itr50_r = agg.invoiceTransitionPurchaseReturn.reduced8.exempt50;
  const nqReturn80ByUse: InvoiceTransitionByUse = {
    taxableStd: itr80_s.taxablePurchase.taxableAmount,
    taxableRed: itr80_r.taxablePurchase.taxableAmount,
    nonTaxableStd: itr80_s.nonTaxablePurchase.taxableAmount,
    nonTaxableRed: itr80_r.nonTaxablePurchase.taxableAmount,
    commonStd: itr80_s.commonPurchase.taxableAmount,
    commonRed: itr80_r.commonPurchase.taxableAmount,
  };
  const nqReturn50ByUse: InvoiceTransitionByUse = {
    taxableStd: itr50_s.taxablePurchase.taxableAmount,
    taxableRed: itr50_r.taxablePurchase.taxableAmount,
    nonTaxableStd: itr50_s.nonTaxablePurchase.taxableAmount,
    nonTaxableRed: itr50_r.nonTaxablePurchase.taxableAmount,
    commonStd: itr50_s.commonPurchase.taxableAmount,
    commonRed: itr50_r.commonPurchase.taxableAmount,
  };

  // --- Sales return ---
  const sr = sumBucketPair(agg.salesReturn.standard10, agg.salesReturn.reduced8);

  // --- Bad debt ---
  const bd = sumBucketPair(agg.badDebt.standard10, agg.badDebt.reduced8);

  // --- Bad debt recovered ---
  const bdr = sumBucketPair(agg.badDebtRecovered.standard10, agg.badDebtRecovered.reduced8);

  return {
    standardRateSales: sales.standard,
    reducedRateSales: sales.reduced,
    exemptSales: agg.exemptSales,
    nonTaxableSales: agg.nonTaxableSales,

    taxablePurchases: tp.total,
    nonTaxablePurchases: ntp.total,
    commonPurchases: cp.total,

    taxablePurchasesStandard: tp.standard,
    taxablePurchasesReduced: tp.reduced,
    nonTaxablePurchasesStandard: ntp.standard,
    nonTaxablePurchasesReduced: ntp.reduced,
    commonPurchasesStandard: cp.standard,
    commonPurchasesReduced: cp.reduced,

    nonQualifiedPurchases80: nq80Std + nq80Red,
    nonQualifiedPurchases50: nq50Std + nq50Red,
    nonQualifiedPurchases80Standard: nq80Std,
    nonQualifiedPurchases80Reduced: nq80Red,
    nonQualifiedPurchases50Standard: nq50Std,
    nonQualifiedPurchases50Reduced: nq50Red,

    salesReturnStandard: sr.standard,
    salesReturnReduced: sr.reduced,
    badDebtStandard: bd.standard,
    badDebtReduced: bd.reduced,

    purchaseReturnTaxableStandard: agg.purchaseReturn.standard10.taxablePurchase.taxableAmount,
    purchaseReturnTaxableReduced: agg.purchaseReturn.reduced8.taxablePurchase.taxableAmount,
    purchaseReturnNonTaxableStandard: agg.purchaseReturn.standard10.nonTaxablePurchase.taxableAmount,
    purchaseReturnNonTaxableReduced: agg.purchaseReturn.reduced8.nonTaxablePurchase.taxableAmount,
    purchaseReturnCommonStandard: agg.purchaseReturn.standard10.commonPurchase.taxableAmount,
    purchaseReturnCommonReduced: agg.purchaseReturn.reduced8.commonPurchase.taxableAmount,

    badDebtRecoveredStandard: bdr.standard,
    badDebtRecoveredReduced: bdr.reduced,

    nq80ByUse,
    nq50ByUse,
    nqReturn80ByUse,
    nqReturn50ByUse,

    importTaxPaymentTaxable: agg.importTaxPayments.taxable,
    importTaxPaymentNonTaxable: agg.importTaxPayments.nonTaxable,
    importTaxPaymentCommon: agg.importTaxPayments.common,

    securitiesTransfer: agg.securitiesTransfer,

    unclassifiedTaxCodes: agg.meta.unclassifiedTaxCodes,
    totalEntries: agg.meta.totalEntries,
    classifiedEntries: agg.meta.classifiedEntries,
    unclassifiedEntries: agg.meta.unclassifiedEntries,

    totalVatFromFreee: 0, // aggregator doesn't track this yet
    dealCount: 0,
    manualJournalCount: 0,
  };
}
