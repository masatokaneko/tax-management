/**
 * freee tax_code to consumption tax classification mapping service.
 *
 * Maps every freee tax_code to the bucket it belongs to on the
 * consumption tax return (general / simplified).  The mapping is kept
 * as a flat Map<number, TaxCodeClassification> for O(1) lookups.
 */

// ---------------------------------------------------------------------------
// Type definitions
// ---------------------------------------------------------------------------

/** Consumption tax category */
export type ConsumptionTaxCategory =
  | "taxable_sales"              // 課税売上
  | "exempt_sales"               // 免税売上
  | "non_taxable_sales"          // 非課税売上
  | "securities_transfer"        // 有価証券譲渡（課税売上割合計算で5%のみ算入）
  | "out_of_scope"               // 対象外・不課税
  | "taxable_purchase"           // 課税仕入（課税売上対応）
  | "non_taxable_purchase"       // 課税仕入（非課税売上対応）
  | "common_purchase"            // 課税仕入（共通対応）
  | "non_taxable_purchase_expense" // 非課税仕入
  | "sales_return"               // 売上返還
  | "bad_debt"                   // 貸倒れ
  | "bad_debt_recovered"         // 貸倒回収
  | "purchase_return"            // 仕入返還
  | "import_taxable"             // 輸入（課税貨物）— 本体額コード
  | "import_tax_payment"         // 輸入（税額コード）— 金額がそのまま税額
  | "simplified_type_1"
  | "simplified_type_2"
  | "simplified_type_3"
  | "simplified_type_4"
  | "simplified_type_5"
  | "simplified_type_6";

/** Tax rate bracket */
export type TaxRateType = "standard_10" | "reduced_8" | "old_8" | "old_5";

/** Invoice transition measure */
export type InvoiceTransition = "none" | "exempt_80" | "exempt_50";

/** Purchase use classification (individual attribution method) */
export type PurchaseUse = "taxable" | "non_taxable" | "common";

/** Classification result for a single tax_code */
export interface TaxCodeClassification {
  category: ConsumptionTaxCategory;
  rateType: TaxRateType;
  invoiceTransition: InvoiceTransition;
  purchaseUse: PurchaseUse | null;
  nationalTaxRate: number;  // e.g. 0.078 for standard 10%
  localTaxRate: number;     // e.g. 0.022 for standard 10%
}

// ---------------------------------------------------------------------------
// Tax-rate constants
// ---------------------------------------------------------------------------

const RATE_STANDARD_10 = { nationalTaxRate: 0.078, localTaxRate: 0.022 } as const;
const RATE_REDUCED_8   = { nationalTaxRate: 0.0624, localTaxRate: 0.0176 } as const;
const RATE_OLD_8       = { nationalTaxRate: 0.063, localTaxRate: 0.017 } as const;
const RATE_OLD_5       = { nationalTaxRate: 0.04, localTaxRate: 0.01 } as const;

function rates(rateType: TaxRateType): { nationalTaxRate: number; localTaxRate: number } {
  switch (rateType) {
    case "standard_10": return RATE_STANDARD_10;
    case "reduced_8":   return RATE_REDUCED_8;
    case "old_8":       return RATE_OLD_8;
    case "old_5":       return RATE_OLD_5;
  }
}

// ---------------------------------------------------------------------------
// Helper to build entries
// ---------------------------------------------------------------------------

function entry(
  category: ConsumptionTaxCategory,
  rateType: TaxRateType,
  invoiceTransition: InvoiceTransition = "none",
  purchaseUse: PurchaseUse | null = null,
): TaxCodeClassification {
  const r = rates(rateType);
  return { category, rateType, invoiceTransition, purchaseUse, ...r };
}

/**
 * Build an import_tax_payment entry.
 *
 * For tax-amount codes (課対輸税, 地消貨割, 非対輸税, 共対輸税),
 * the amount in freee IS the tax already paid — it must NOT be
 * multiplied by a tax rate again.  We therefore set rates to 0.
 */
function importTaxPaymentEntry(
  rateType: TaxRateType,
  purchaseUse: PurchaseUse,
): TaxCodeClassification {
  return {
    category: "import_tax_payment",
    rateType,
    invoiceTransition: "none",
    purchaseUse,
    nationalTaxRate: 0,
    localTaxRate: 0,
  };
}

// ---------------------------------------------------------------------------
// The map
// ---------------------------------------------------------------------------

const TAX_CODE_MAP = new Map<number, TaxCodeClassification>();

// === Sales (課税売上) ===
TAX_CODE_MAP.set(129, entry("taxable_sales", "standard_10"));
TAX_CODE_MAP.set(156, entry("taxable_sales", "reduced_8"));
TAX_CODE_MAP.set(101, entry("taxable_sales", "old_8"));
TAX_CODE_MAP.set(21,  entry("taxable_sales", "old_5"));

// === Exempt sales (免税売上) ===
TAX_CODE_MAP.set(22,  entry("exempt_sales", "old_5"));  // rate is irrelevant

// === Non-taxable sales (非課税売上) ===
TAX_CODE_MAP.set(23,  entry("non_taxable_sales", "old_5"));

// === Non-taxable asset transfer (非課税資産の譲渡) ===
TAX_CODE_MAP.set(24,  entry("non_taxable_sales", "old_5"));

// === Out of scope / without tax ===
TAX_CODE_MAP.set(2,   entry("out_of_scope", "old_5"));
TAX_CODE_MAP.set(20,  entry("out_of_scope", "old_5"));

// === Securities transfer (有価証券譲渡) ===
// Special category: only 5% of transfer amount counts in taxable sales ratio denominator.
TAX_CODE_MAP.set(10,  entry("securities_transfer", "old_5"));

// === Sales return (売上返還) ===
TAX_CODE_MAP.set(143, entry("sales_return", "standard_10"));
TAX_CODE_MAP.set(170, entry("sales_return", "reduced_8"));
TAX_CODE_MAP.set(115, entry("sales_return", "old_8"));
TAX_CODE_MAP.set(26,  entry("sales_return", "old_5"));

// === Bad debt (貸倒れ) ===
TAX_CODE_MAP.set(150, entry("bad_debt", "standard_10"));
TAX_CODE_MAP.set(177, entry("bad_debt", "reduced_8"));
TAX_CODE_MAP.set(121, entry("bad_debt", "old_8"));
TAX_CODE_MAP.set(8,   entry("bad_debt", "old_5"));

// === Bad debt recovered (貸倒回収) ===
TAX_CODE_MAP.set(151, entry("bad_debt_recovered", "standard_10"));
TAX_CODE_MAP.set(178, entry("bad_debt_recovered", "reduced_8"));
TAX_CODE_MAP.set(122, entry("bad_debt_recovered", "old_8"));
TAX_CODE_MAP.set(9,   entry("bad_debt_recovered", "old_5"));

// === Taxable purchase — taxable sales use (課対仕入) ===
TAX_CODE_MAP.set(136, entry("taxable_purchase", "standard_10", "none", "taxable"));
TAX_CODE_MAP.set(163, entry("taxable_purchase", "reduced_8",   "none", "taxable"));
TAX_CODE_MAP.set(108, entry("taxable_purchase", "old_8",       "none", "taxable"));
TAX_CODE_MAP.set(34,  entry("taxable_purchase", "old_5",       "none", "taxable"));

// === Taxable purchase — non-taxable sales use (非対仕入) ===
TAX_CODE_MAP.set(137, entry("non_taxable_purchase", "standard_10", "none", "non_taxable"));
TAX_CODE_MAP.set(164, entry("non_taxable_purchase", "reduced_8",   "none", "non_taxable"));
TAX_CODE_MAP.set(109, entry("non_taxable_purchase", "old_8",       "none", "non_taxable"));
TAX_CODE_MAP.set(35,  entry("non_taxable_purchase", "old_5",       "none", "non_taxable"));

// === Taxable purchase — common use (共対仕入) ===
TAX_CODE_MAP.set(138, entry("common_purchase", "standard_10", "none", "common"));
TAX_CODE_MAP.set(165, entry("common_purchase", "reduced_8",   "none", "common"));
TAX_CODE_MAP.set(110, entry("common_purchase", "old_8",       "none", "common"));
TAX_CODE_MAP.set(36,  entry("common_purchase", "old_5",       "none", "common"));

// === Invoice transition 80% (インボイス経過措置 80%控除) ===
// 課対仕入（控80）
TAX_CODE_MAP.set(189, entry("taxable_purchase", "standard_10", "exempt_80", "taxable"));
TAX_CODE_MAP.set(187, entry("taxable_purchase", "reduced_8",   "exempt_80", "taxable"));
TAX_CODE_MAP.set(185, entry("taxable_purchase", "old_8",       "exempt_80", "taxable"));
TAX_CODE_MAP.set(183, entry("taxable_purchase", "old_5",       "exempt_80", "taxable"));
// 非対仕入（控80）
TAX_CODE_MAP.set(197, entry("non_taxable_purchase", "standard_10", "exempt_80", "non_taxable"));
TAX_CODE_MAP.set(195, entry("non_taxable_purchase", "reduced_8",   "exempt_80", "non_taxable"));
TAX_CODE_MAP.set(193, entry("non_taxable_purchase", "old_8",       "exempt_80", "non_taxable"));
TAX_CODE_MAP.set(191, entry("non_taxable_purchase", "old_5",       "exempt_80", "non_taxable"));
// 共対仕入（控80）
// Code 205 = 共対仕入（控80）10% per freee Developer Community official list.
// Code 199 = 共対仕入（控80）5% (old rate).
TAX_CODE_MAP.set(205, entry("common_purchase", "standard_10", "exempt_80", "common"));
TAX_CODE_MAP.set(203, entry("common_purchase", "reduced_8",   "exempt_80", "common"));
TAX_CODE_MAP.set(201, entry("common_purchase", "old_8",       "exempt_80", "common"));
TAX_CODE_MAP.set(199, entry("common_purchase", "old_5",       "exempt_80", "common"));

// === Invoice transition 50% (インボイス経過措置 50%控除) ===
// 課対仕入（控50）
TAX_CODE_MAP.set(190, entry("taxable_purchase", "standard_10", "exempt_50", "taxable"));
TAX_CODE_MAP.set(188, entry("taxable_purchase", "reduced_8",   "exempt_50", "taxable"));
TAX_CODE_MAP.set(186, entry("taxable_purchase", "old_8",       "exempt_50", "taxable"));
TAX_CODE_MAP.set(184, entry("taxable_purchase", "old_5",       "exempt_50", "taxable"));
// 非対仕入（控50）
TAX_CODE_MAP.set(198, entry("non_taxable_purchase", "standard_10", "exempt_50", "non_taxable"));
TAX_CODE_MAP.set(196, entry("non_taxable_purchase", "reduced_8",   "exempt_50", "non_taxable"));
TAX_CODE_MAP.set(194, entry("non_taxable_purchase", "old_8",       "exempt_50", "non_taxable"));
TAX_CODE_MAP.set(192, entry("non_taxable_purchase", "old_5",       "exempt_50", "non_taxable"));
// 共対仕入（控50）
TAX_CODE_MAP.set(206, entry("common_purchase", "standard_10", "exempt_50", "common"));
TAX_CODE_MAP.set(204, entry("common_purchase", "reduced_8",   "exempt_50", "common"));
TAX_CODE_MAP.set(202, entry("common_purchase", "old_8",       "exempt_50", "common"));
TAX_CODE_MAP.set(200, entry("common_purchase", "old_5",       "exempt_50", "common"));

// === Purchase return (仕入返還) ===
// 課対仕返
TAX_CODE_MAP.set(152, entry("purchase_return", "standard_10", "none", "taxable"));
TAX_CODE_MAP.set(179, entry("purchase_return", "reduced_8",   "none", "taxable"));
TAX_CODE_MAP.set(123, entry("purchase_return", "old_8",       "none", "taxable"));
TAX_CODE_MAP.set(39,  entry("purchase_return", "old_5",       "none", "taxable"));
// 非対仕返
TAX_CODE_MAP.set(153, entry("purchase_return", "standard_10", "none", "non_taxable"));
TAX_CODE_MAP.set(180, entry("purchase_return", "reduced_8",   "none", "non_taxable"));
TAX_CODE_MAP.set(124, entry("purchase_return", "old_8",       "none", "non_taxable"));
TAX_CODE_MAP.set(40,  entry("purchase_return", "old_5",       "none", "non_taxable"));
// 共対仕返
TAX_CODE_MAP.set(154, entry("purchase_return", "standard_10", "none", "common"));
TAX_CODE_MAP.set(181, entry("purchase_return", "reduced_8",   "none", "common"));
TAX_CODE_MAP.set(125, entry("purchase_return", "old_8",       "none", "common"));
TAX_CODE_MAP.set(41,  entry("purchase_return", "old_5",       "none", "common"));

// === Purchase return — Invoice transition 80% (仕入返還 控80) ===
// NOTE: These codes need verification against freee's official documentation.
// The numbering pattern is inferred from the invoice transition purchase codes.
// 課対仕返（控80）
TAX_CODE_MAP.set(207, entry("purchase_return", "standard_10", "exempt_80", "taxable"));
TAX_CODE_MAP.set(209, entry("purchase_return", "reduced_8",   "exempt_80", "taxable"));
TAX_CODE_MAP.set(211, entry("purchase_return", "old_8",       "exempt_80", "taxable"));
TAX_CODE_MAP.set(213, entry("purchase_return", "old_5",       "exempt_80", "taxable"));
// 非対仕返（控80）
TAX_CODE_MAP.set(215, entry("purchase_return", "standard_10", "exempt_80", "non_taxable"));
TAX_CODE_MAP.set(217, entry("purchase_return", "reduced_8",   "exempt_80", "non_taxable"));
TAX_CODE_MAP.set(219, entry("purchase_return", "old_8",       "exempt_80", "non_taxable"));
TAX_CODE_MAP.set(221, entry("purchase_return", "old_5",       "exempt_80", "non_taxable"));
// 共対仕返（控80）
TAX_CODE_MAP.set(223, entry("purchase_return", "standard_10", "exempt_80", "common"));
TAX_CODE_MAP.set(225, entry("purchase_return", "reduced_8",   "exempt_80", "common"));
TAX_CODE_MAP.set(227, entry("purchase_return", "old_8",       "exempt_80", "common"));
TAX_CODE_MAP.set(229, entry("purchase_return", "old_5",       "exempt_80", "common"));

// === Purchase return — Invoice transition 50% (仕入返還 控50) ===
// NOTE: These codes need verification against freee's official documentation.
// 課対仕返（控50）
TAX_CODE_MAP.set(208, entry("purchase_return", "standard_10", "exempt_50", "taxable"));
TAX_CODE_MAP.set(210, entry("purchase_return", "reduced_8",   "exempt_50", "taxable"));
TAX_CODE_MAP.set(212, entry("purchase_return", "old_8",       "exempt_50", "taxable"));
TAX_CODE_MAP.set(214, entry("purchase_return", "old_5",       "exempt_50", "taxable"));
// 非対仕返（控50）
TAX_CODE_MAP.set(216, entry("purchase_return", "standard_10", "exempt_50", "non_taxable"));
TAX_CODE_MAP.set(218, entry("purchase_return", "reduced_8",   "exempt_50", "non_taxable"));
TAX_CODE_MAP.set(220, entry("purchase_return", "old_8",       "exempt_50", "non_taxable"));
TAX_CODE_MAP.set(222, entry("purchase_return", "old_5",       "exempt_50", "non_taxable"));
// 共対仕返（控50）
TAX_CODE_MAP.set(224, entry("purchase_return", "standard_10", "exempt_50", "common"));
TAX_CODE_MAP.set(226, entry("purchase_return", "reduced_8",   "exempt_50", "common"));
TAX_CODE_MAP.set(228, entry("purchase_return", "old_8",       "exempt_50", "common"));
TAX_CODE_MAP.set(230, entry("purchase_return", "old_5",       "exempt_50", "common"));

// === Simplified taxation types (簡易課税 第一種〜第六種) ===
// 10%
TAX_CODE_MAP.set(130, entry("simplified_type_1", "standard_10"));
TAX_CODE_MAP.set(131, entry("simplified_type_2", "standard_10"));
TAX_CODE_MAP.set(132, entry("simplified_type_3", "standard_10"));
TAX_CODE_MAP.set(133, entry("simplified_type_4", "standard_10"));
TAX_CODE_MAP.set(134, entry("simplified_type_5", "standard_10"));
TAX_CODE_MAP.set(135, entry("simplified_type_6", "standard_10"));
// 8%（軽減）
TAX_CODE_MAP.set(157, entry("simplified_type_1", "reduced_8"));
TAX_CODE_MAP.set(158, entry("simplified_type_2", "reduced_8"));
TAX_CODE_MAP.set(159, entry("simplified_type_3", "reduced_8"));
TAX_CODE_MAP.set(160, entry("simplified_type_4", "reduced_8"));
TAX_CODE_MAP.set(161, entry("simplified_type_5", "reduced_8"));
TAX_CODE_MAP.set(162, entry("simplified_type_6", "reduced_8"));

// === Import — base amount codes (輸入 本体額) ===
// These are the BASE amount codes: amount × tax_rate to calculate tax.
// 課対輸本 (import principal — taxable sales use)
TAX_CODE_MAP.set(5,   entry("import_taxable", "old_5", "none", "taxable"));
// 非対輸本
TAX_CODE_MAP.set(30,  entry("import_taxable", "old_5", "none", "non_taxable"));
// 共対輸本
TAX_CODE_MAP.set(31,  entry("import_taxable", "old_5", "none", "common"));

// === Import — tax amount codes (輸入 税額) ===
// These are TAX AMOUNT codes: the amount IS the tax paid at customs.
// Do NOT apply nationalTaxRate/localTaxRate again (rates set to 0).
// 課対輸税 10%
TAX_CODE_MAP.set(139, importTaxPaymentEntry("standard_10", "taxable"));
// 課対輸税 8%（軽）
TAX_CODE_MAP.set(166, importTaxPaymentEntry("reduced_8", "taxable"));
// 地消貨割 10%
TAX_CODE_MAP.set(142, importTaxPaymentEntry("standard_10", "taxable"));
// 地消貨割 8%（軽）
TAX_CODE_MAP.set(169, importTaxPaymentEntry("reduced_8", "taxable"));
// 非対輸税 10%
TAX_CODE_MAP.set(140, importTaxPaymentEntry("standard_10", "non_taxable"));
// 共対輸税 10%
TAX_CODE_MAP.set(141, importTaxPaymentEntry("standard_10", "common"));

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Classify a freee tax_code into a consumption tax bucket.
 *
 * @returns The classification, or `null` if the code is unknown.
 */
export function classifyTaxCode(taxCode: number): TaxCodeClassification | null {
  return TAX_CODE_MAP.get(taxCode) ?? null;
}

/**
 * Return all registered tax codes (useful for diagnostics).
 */
export function getAllRegisteredTaxCodes(): number[] {
  return [...TAX_CODE_MAP.keys()].sort((a, b) => a - b);
}
