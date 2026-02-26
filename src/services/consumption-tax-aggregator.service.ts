/**
 * Consumption tax aggregator service.
 *
 * Aggregates freee deals / manual_journals by tax_code into the
 * buckets required for the Japanese consumption tax return.
 *
 * All monetary amounts are integers (yen).  Tax amounts are computed
 * from the tax-exclusive base using the statutory national / local
 * split — the `vat` field from freee is used only for reconciliation,
 * NOT for the return itself.
 */

import {
  classifyTaxCode,
  type ConsumptionTaxCategory,
  type TaxCodeClassification,
  type TaxRateType,
  type InvoiceTransition,
  type PurchaseUse,
} from "./tax-code-mapping.js";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/** Amounts accumulated for a single rate bucket */
export interface RateBucket {
  taxableAmount: number;   // 課税標準額（税抜）
  nationalTax: number;     // 国税部分
  localTax: number;        // 地方部分
}

/** Individual attribution method: three purchase-use buckets */
export interface PurchaseBuckets {
  taxablePurchase: RateBucket;     // 課税売上対応
  nonTaxablePurchase: RateBucket;  // 非課税売上対応
  commonPurchase: RateBucket;      // 共通対応
}

/** Invoice transition measure buckets */
export interface InvoiceTransitionBucket {
  exempt80: PurchaseBuckets;  // 80% deductible
  exempt50: PurchaseBuckets;  // 50% deductible
}

/** Rate-keyed structure (standard_10, reduced_8, old_8, old_5) */
export interface RateKeyedBuckets<T> {
  standard10: T;
  reduced8: T;
  old8: T;
  old5: T;
}

/** Full aggregation result */
export interface ConsumptionTaxAggregation {
  // Sales side
  sales: RateKeyedBuckets<RateBucket>;
  exemptSales: number;
  nonTaxableSales: number;

  // Sales return
  salesReturn: RateKeyedBuckets<RateBucket>;

  // Bad debt
  badDebt: RateKeyedBuckets<RateBucket>;

  // Purchases (qualified invoices — normal)
  purchases: RateKeyedBuckets<PurchaseBuckets>;

  // Invoice transition purchases
  invoiceTransition: RateKeyedBuckets<InvoiceTransitionBucket>;

  // Purchase return
  purchaseReturn: RateKeyedBuckets<PurchaseBuckets>;

  // Bad debt recovered (tracked separately — 付表2-3 ㉘ → 付表1-3 ③ → 第一表 ③)
  badDebtRecovered: RateKeyedBuckets<RateBucket>;

  // Invoice transition purchase returns (separate from normal purchase returns)
  invoiceTransitionPurchaseReturn: RateKeyedBuckets<InvoiceTransitionBucket>;

  // Import tax payments (amount IS tax, not base — tracked by purchase use)
  importTaxPayments: {
    taxable: number;
    nonTaxable: number;
    common: number;
  };

  // Securities transfer (有価証券譲渡 — 5% rule for taxable sales ratio)
  securitiesTransfer: number;

  // Simplified taxation types
  simplifiedSales: {
    type1: RateBucket;
    type2: RateBucket;
    type3: RateBucket;
    type4: RateBucket;
    type5: RateBucket;
    type6: RateBucket;
  };

  // Audit metadata
  meta: {
    totalEntries: number;
    classifiedEntries: number;
    unclassifiedEntries: number;
    unclassifiedTaxCodes: number[];
  };
}

// ---------------------------------------------------------------------------
// Helpers — bucket factories
// ---------------------------------------------------------------------------

function emptyBucket(): RateBucket {
  return { taxableAmount: 0, nationalTax: 0, localTax: 0 };
}

function emptyPurchaseBuckets(): PurchaseBuckets {
  return {
    taxablePurchase: emptyBucket(),
    nonTaxablePurchase: emptyBucket(),
    commonPurchase: emptyBucket(),
  };
}

function emptyInvoiceTransitionBucket(): InvoiceTransitionBucket {
  return {
    exempt80: emptyPurchaseBuckets(),
    exempt50: emptyPurchaseBuckets(),
  };
}

function emptyRateKeyed<T>(factory: () => T): RateKeyedBuckets<T> {
  return {
    standard10: factory(),
    reduced8: factory(),
    old8: factory(),
    old5: factory(),
  };
}

function emptyAggregation(): ConsumptionTaxAggregation {
  return {
    sales: emptyRateKeyed(emptyBucket),
    exemptSales: 0,
    nonTaxableSales: 0,
    salesReturn: emptyRateKeyed(emptyBucket),
    badDebt: emptyRateKeyed(emptyBucket),
    purchases: emptyRateKeyed(emptyPurchaseBuckets),
    invoiceTransition: emptyRateKeyed(emptyInvoiceTransitionBucket),
    purchaseReturn: emptyRateKeyed(emptyPurchaseBuckets),
    invoiceTransitionPurchaseReturn: emptyRateKeyed(emptyInvoiceTransitionBucket),
    importTaxPayments: { taxable: 0, nonTaxable: 0, common: 0 },
    badDebtRecovered: emptyRateKeyed(emptyBucket),
    securitiesTransfer: 0,
    simplifiedSales: {
      type1: emptyBucket(),
      type2: emptyBucket(),
      type3: emptyBucket(),
      type4: emptyBucket(),
      type5: emptyBucket(),
      type6: emptyBucket(),
    },
    meta: {
      totalEntries: 0,
      classifiedEntries: 0,
      unclassifiedEntries: 0,
      unclassifiedTaxCodes: [],
    },
  };
}

// ---------------------------------------------------------------------------
// Rate-type to object key
// ---------------------------------------------------------------------------

function rateKey(rateType: TaxRateType): keyof RateKeyedBuckets<unknown> {
  switch (rateType) {
    case "standard_10": return "standard10";
    case "reduced_8":   return "reduced8";
    case "old_8":       return "old8";
    case "old_5":       return "old5";
  }
}

// ---------------------------------------------------------------------------
// Purchase-use to bucket key
// ---------------------------------------------------------------------------

function purchaseUseKey(use: PurchaseUse): keyof PurchaseBuckets {
  switch (use) {
    case "taxable":     return "taxablePurchase";
    case "non_taxable": return "nonTaxablePurchase";
    case "common":      return "commonPurchase";
  }
}

// ---------------------------------------------------------------------------
// Sign logic
// ---------------------------------------------------------------------------

/**
 * Determine the sign multiplier for a detail entry.
 *
 * Sales-side categories normally appear on the credit side.
 * A debit entry for a sales category means cancellation (negative).
 *
 * Purchase-side categories normally appear on the debit side.
 * A credit entry for a purchase category means cancellation (negative).
 */
function signMultiplier(
  category: ConsumptionTaxCategory,
  entrySide: string,
): number {
  const salesSide: ConsumptionTaxCategory[] = [
    "taxable_sales",
    "exempt_sales",
    "non_taxable_sales",
    "securities_transfer",
    "sales_return",
    "bad_debt",
    "bad_debt_recovered",
    "simplified_type_1",
    "simplified_type_2",
    "simplified_type_3",
    "simplified_type_4",
    "simplified_type_5",
    "simplified_type_6",
  ];

  const isSalesSide = salesSide.includes(category);

  if (isSalesSide) {
    // Sales normally credit; debit = reversal
    return entrySide === "credit" ? 1 : -1;
  } else {
    // Purchase normally debit; credit = reversal
    return entrySide === "debit" ? 1 : -1;
  }
}

// ---------------------------------------------------------------------------
// Add amount to a RateBucket
// ---------------------------------------------------------------------------

function addToBucket(
  bucket: RateBucket,
  amount: number,
  classification: TaxCodeClassification,
  sign: number,
): void {
  const signedAmount = amount * sign;
  bucket.taxableAmount += signedAmount;
  bucket.nationalTax += Math.floor(Math.abs(amount) * classification.nationalTaxRate) * sign;
  bucket.localTax += Math.floor(Math.abs(amount) * classification.localTaxRate) * sign;
}

// ---------------------------------------------------------------------------
// Process a single detail line
// ---------------------------------------------------------------------------

function processDetail(
  agg: ConsumptionTaxAggregation,
  taxCode: number,
  amount: number,
  entrySide: string,
): boolean {
  const classification = classifyTaxCode(taxCode);
  if (!classification) return false;

  const { category, rateType, invoiceTransition, purchaseUse } = classification;
  const sign = signMultiplier(category, entrySide);
  const rk = rateKey(rateType);

  switch (category) {
    // ---- Sales ----
    case "taxable_sales": {
      addToBucket(agg.sales[rk], amount, classification, sign);
      break;
    }

    case "exempt_sales": {
      agg.exemptSales += amount * sign;
      break;
    }

    case "non_taxable_sales": {
      agg.nonTaxableSales += amount * sign;
      break;
    }

    case "out_of_scope": {
      // No accumulation — out of scope amounts are not part of the return
      break;
    }

    // ---- Sales return ----
    case "sales_return": {
      addToBucket(agg.salesReturn[rk], amount, classification, sign);
      break;
    }

    // ---- Bad debt ----
    case "bad_debt": {
      addToBucket(agg.badDebt[rk], amount, classification, sign);
      break;
    }

    // ---- Bad debt recovered ----
    case "bad_debt_recovered": {
      // Recovered bad debt is tracked separately because it goes to
      // 付表2-3 ㉘ → 付表1-3 ③ → 第一表 ③
      addToBucket(agg.badDebtRecovered[rk], amount, classification, sign);
      break;
    }

    // ---- Purchases ----
    case "taxable_purchase":
    case "non_taxable_purchase":
    case "common_purchase": {
      if (!purchaseUse) break;
      const puKey = purchaseUseKey(purchaseUse);

      if (invoiceTransition === "none") {
        addToBucket(agg.purchases[rk][puKey], amount, classification, sign);
      } else if (invoiceTransition === "exempt_80") {
        addToBucket(agg.invoiceTransition[rk].exempt80[puKey], amount, classification, sign);
      } else if (invoiceTransition === "exempt_50") {
        addToBucket(agg.invoiceTransition[rk].exempt50[puKey], amount, classification, sign);
      }
      break;
    }

    // ---- Purchase return ----
    case "purchase_return": {
      if (!purchaseUse) break;
      const prKey = purchaseUseKey(purchaseUse);
      if (invoiceTransition === "none") {
        addToBucket(agg.purchaseReturn[rk][prKey], amount, classification, sign);
      } else if (invoiceTransition === "exempt_80") {
        addToBucket(agg.invoiceTransitionPurchaseReturn[rk].exempt80[prKey], amount, classification, sign);
      } else if (invoiceTransition === "exempt_50") {
        addToBucket(agg.invoiceTransitionPurchaseReturn[rk].exempt50[prKey], amount, classification, sign);
      }
      break;
    }

    // ---- Import ----
    case "import_taxable": {
      // Import purchases are accumulated into the main purchase buckets
      // because they contribute to deductible input tax.
      if (!purchaseUse) break;
      const impKey = purchaseUseKey(purchaseUse);
      addToBucket(agg.purchases[rk][impKey], amount, classification, sign);
      break;
    }

    case "import_tax_payment": {
      // Import tax payment codes (輸税/地消貨割) — the amount IS the tax paid.
      // Track separately so the adapter can pass them through to calculate-general.
      if (!purchaseUse) break;
      const itpSign = signMultiplier(category, entrySide);
      const signedTax = amount * itpSign;
      if (purchaseUse === "taxable") {
        agg.importTaxPayments.taxable += signedTax;
      } else if (purchaseUse === "non_taxable") {
        agg.importTaxPayments.nonTaxable += signedTax;
      } else {
        agg.importTaxPayments.common += signedTax;
      }
      break;
    }

    // ---- Import local tax (地消貨割) ----
    case "import_local_tax": {
      // Local consumption tax on imports — not deductible as input tax.
      // No accumulation needed (地方消費税は仕入税額控除の対象外).
      break;
    }

    // ---- Securities transfer ----
    case "securities_transfer": {
      // Securities transfer — tracked separately for 5% rule in taxable sales ratio
      agg.securitiesTransfer += amount * signMultiplier(category, entrySide);
      break;
    }

    // ---- Simplified types ----
    case "simplified_type_1": {
      addToBucket(agg.simplifiedSales.type1, amount, classification, sign);
      break;
    }
    case "simplified_type_2": {
      addToBucket(agg.simplifiedSales.type2, amount, classification, sign);
      break;
    }
    case "simplified_type_3": {
      addToBucket(agg.simplifiedSales.type3, amount, classification, sign);
      break;
    }
    case "simplified_type_4": {
      addToBucket(agg.simplifiedSales.type4, amount, classification, sign);
      break;
    }
    case "simplified_type_5": {
      addToBucket(agg.simplifiedSales.type5, amount, classification, sign);
      break;
    }
    case "simplified_type_6": {
      addToBucket(agg.simplifiedSales.type6, amount, classification, sign);
      break;
    }

    // ---- Non-taxable purchase expense ----
    case "non_taxable_purchase_expense": {
      // Not accumulated — these are non-deductible
      break;
    }

    default: {
      // Exhaustiveness check
      const _exhaustive: never = category;
      return false;
    }
  }

  return true;
}

// ---------------------------------------------------------------------------
// Extract details from deals
// ---------------------------------------------------------------------------

interface DealDetail {
  tax_code: number;
  amount: number;
  entry_side: string;
}

function extractDealDetails(deal: any): DealDetail[] {
  const results: DealDetail[] = [];
  const details = deal.details ?? [];
  for (const d of details) {
    const taxCode = d.tax_code as number | undefined;
    const amount = d.amount as number | undefined;
    const entrySide = d.entry_side as string | undefined;
    if (taxCode != null && amount != null && entrySide != null) {
      results.push({ tax_code: taxCode, amount: Math.abs(amount), entry_side: entrySide });
    }
  }
  return results;
}

// ---------------------------------------------------------------------------
// Extract details from manual journals
// ---------------------------------------------------------------------------

function extractManualJournalDetails(journal: any): DealDetail[] {
  const results: DealDetail[] = [];
  const entries = journal.details ?? [];
  for (const e of entries) {
    const taxCode = e.tax_code as number | undefined;
    const amount = e.amount as number | undefined;
    const entrySide = e.entry_side as string | undefined;
    if (taxCode != null && amount != null && entrySide != null) {
      results.push({ tax_code: taxCode, amount: Math.abs(amount), entry_side: entrySide });
    }
  }
  return results;
}

// ---------------------------------------------------------------------------
// Main aggregation function
// ---------------------------------------------------------------------------

/**
 * Aggregate consumption tax from freee deals and manual journals.
 *
 * @param deals          Array of freee deal objects (JSON from freee_cache)
 * @param manualJournals Array of freee manual_journal objects (JSON from freee_cache)
 * @returns Fully bucketed consumption tax aggregation
 */
export function aggregateConsumptionTax(
  deals: any[],
  manualJournals: any[],
): ConsumptionTaxAggregation {
  const agg = emptyAggregation();
  const unclassifiedSet = new Set<number>();

  // Process deals
  for (const deal of deals) {
    const details = extractDealDetails(deal);
    for (const detail of details) {
      agg.meta.totalEntries++;
      const ok = processDetail(agg, detail.tax_code, detail.amount, detail.entry_side);
      if (ok) {
        agg.meta.classifiedEntries++;
      } else {
        agg.meta.unclassifiedEntries++;
        unclassifiedSet.add(detail.tax_code);
      }
    }
  }

  // Process manual journals
  for (const journal of manualJournals) {
    const details = extractManualJournalDetails(journal);
    for (const detail of details) {
      agg.meta.totalEntries++;
      const ok = processDetail(agg, detail.tax_code, detail.amount, detail.entry_side);
      if (ok) {
        agg.meta.classifiedEntries++;
      } else {
        agg.meta.unclassifiedEntries++;
        unclassifiedSet.add(detail.tax_code);
      }
    }
  }

  agg.meta.unclassifiedTaxCodes = [...unclassifiedSet].sort((a, b) => a - b);

  return agg;
}
