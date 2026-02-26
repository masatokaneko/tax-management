/**
 * 消費税申告書（一般課税・原則課税）計算ツール
 *
 * 計算フロー: 付表2-3 → 付表1-3 → 第一表
 *
 * - freee のtax_codeベース自動集計に対応（useFreeeData=true）
 * - 手動入力にも対応（useFreeeData=false）
 * - インボイス経過措置（80%控除 / 50%控除）対応
 * - 個別対応方式 / 一括比例配分方式 / 全額控除の自動判定
 * - 還付申告に対応（還付を潰さない）
 */

import { z } from "zod";
import type { ToolDefinition } from "../../types/tool-definition.js";
import { getDb } from "../../db/client.js";
import { errorResult, jsonResult, formatError } from "../../helpers/format-error.js";
import { floorToUnit } from "../../services/rounding.service.js";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { aggregateConsumptionTax } from "../../services/consumption-tax-aggregator.service.js";
import { flattenAggregation, type FlatConsumptionTaxData } from "../../services/consumption-tax-adapter.service.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

const schema = z.object({
  fiscalYearId: z.string().describe("事業年度ID"),

  // freeeデータ使用モード（推奨）
  useFreeeData: z.boolean().default(true)
    .describe("trueの場合、freee_cacheから自動集計。falseの場合、手動入力パラメータを使用"),

  // 手動入力・補正用パラメータ（useFreeeData=falseまたは補正用）
  // 売上
  standardRateSales: z.number().int().default(0).describe("標準税率10%の課税売上高（税抜・円）"),
  reducedRateSales: z.number().int().default(0).describe("軽減税率8%の課税売上高（税抜・円）"),
  exemptSales: z.number().int().default(0).describe("免税売上高（円）"),
  nonTaxableSales: z.number().int().default(0).describe("非課税売上高（円）"),

  // 仕入（個別対応方式の3区分）
  taxablePurchases: z.number().int().default(0).describe("課税売上対応の仕入高（税抜・円）"),
  nonTaxablePurchases: z.number().int().default(0).describe("非課税売上対応の仕入高（税抜・円）"),
  commonPurchases: z.number().int().default(0).describe("共通対応の仕入高（税抜・円）"),

  // インボイス経過措置
  nonQualifiedPurchases80: z.number().int().default(0).describe("適格請求書なし仕入（80%経過措置・税抜・円）"),
  nonQualifiedPurchases50: z.number().int().default(0).describe("適格請求書なし仕入（50%経過措置・税抜・円）"),

  // 返還・貸倒れ
  salesReturnAmount: z.number().int().default(0).describe("売上返還等の対価（税抜・円）"),
  badDebtAmount: z.number().int().default(0).describe("貸倒れに係る課税標準額（税抜・円）"),

  // 中間納付
  interimNationalTax: z.number().int().default(0).describe("中間納付消費税額（国税・円）"),
  interimLocalTax: z.number().int().default(0).describe("中間納付地方消費税額（円）"),

  // 控除方式
  deductionMethod: z.enum(["full", "individual", "proportional"])
    .default("individual")
    .describe("仕入税額控除の方法: full=全額控除(自動判定), individual=個別対応, proportional=一括比例配分"),
});

// FlatConsumptionTaxData is imported from consumption-tax-adapter.service.ts

// ---------------------------------------------------------------------------
// Consumption tax rates
// ---------------------------------------------------------------------------

interface ConsumptionTaxRates {
  standardRate: number;
  reducedRate: number;
  standardTaxPortion: number;   // 国税分: 0.078
  standardLocalPortion: number; // 地方分: 0.022
  reducedTaxPortion: number;    // 国税分: 0.0624
  reducedLocalPortion: number;  // 地方分: 0.0176
  invoiceTransition: Array<{
    periodFrom: string;
    periodTo: string;
    deductionRate: number;
  }>;
}

function loadConsumptionTaxRates(): ConsumptionTaxRates {
  const ratesPath = resolve(__dirname, "../../data/tax-rates/consumption-tax.json");
  return JSON.parse(readFileSync(ratesPath, "utf-8")) as ConsumptionTaxRates;
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

const handler = async (args: any) => {
  try {
    const p = args.params;
    const db = getDb();

    // --- Validate fiscal year ---
    const fy = db.prepare("SELECT * FROM fiscal_years WHERE id = ?").get(p.fiscalYearId) as any;
    if (!fy) return errorResult(`事業年度 ${p.fiscalYearId} が見つかりません。`);

    const rates = loadConsumptionTaxRates();

    // =====================================================================
    // Step 1: データ取得
    // =====================================================================

    let agg: FlatConsumptionTaxData;
    let freeeDataUsed = false;
    let freeeReconciliation: Record<string, unknown> | null = null;

    if (p.useFreeeData) {
      // freee_cache からデータ取得
      const dealsRow = db.prepare(
        "SELECT data_json FROM freee_cache WHERE fiscal_year_id = ? AND data_type = 'deals' ORDER BY fetched_at DESC LIMIT 1"
      ).get(p.fiscalYearId) as any;

      const mjRow = db.prepare(
        "SELECT data_json FROM freee_cache WHERE fiscal_year_id = ? AND data_type = 'manual_journals' ORDER BY fetched_at DESC LIMIT 1"
      ).get(p.fiscalYearId) as any;

      if (!dealsRow && !mjRow) {
        return errorResult(
          "freee_cacheにデータがありません。先にfetch-freee-dataでデータを取得するか、useFreeeData=falseで手動入力してください。"
        );
      }

      const deals = dealsRow ? JSON.parse(dealsRow.data_json) : [];
      const manualJournals = mjRow ? JSON.parse(mjRow.data_json) : [];

      const rawAgg = aggregateConsumptionTax(
        Array.isArray(deals) ? deals : (deals.deals ?? []),
        Array.isArray(manualJournals) ? manualJournals : (manualJournals.manual_journals ?? []),
      );
      agg = flattenAggregation(rawAgg);
      freeeDataUsed = true;

      // 手動補正: パラメータが0でない場合、手動入力値で上書き
      if (p.standardRateSales !== 0) agg.standardRateSales = p.standardRateSales;
      if (p.reducedRateSales !== 0) agg.reducedRateSales = p.reducedRateSales;
      if (p.exemptSales !== 0) agg.exemptSales = p.exemptSales;
      if (p.nonTaxableSales !== 0) agg.nonTaxableSales = p.nonTaxableSales;
      if (p.taxablePurchases !== 0) agg.taxablePurchases = p.taxablePurchases;
      if (p.nonTaxablePurchases !== 0) agg.nonTaxablePurchases = p.nonTaxablePurchases;
      if (p.commonPurchases !== 0) agg.commonPurchases = p.commonPurchases;
      if (p.nonQualifiedPurchases80 !== 0) agg.nonQualifiedPurchases80 = p.nonQualifiedPurchases80;
      if (p.nonQualifiedPurchases50 !== 0) agg.nonQualifiedPurchases50 = p.nonQualifiedPurchases50;
      if (p.salesReturnAmount !== 0) {
        agg.salesReturnStandard = p.salesReturnAmount;
        agg.salesReturnReduced = 0;
      }
      if (p.badDebtAmount !== 0) {
        agg.badDebtStandard = p.badDebtAmount;
        agg.badDebtReduced = 0;
      }
    } else {
      // 手動入力モード: パラメータからaggを組み立て
      // 手動入力時は税率別内訳が不明なので、仕入は全額標準税率として扱う
      agg = {
        standardRateSales: p.standardRateSales,
        reducedRateSales: p.reducedRateSales,
        exemptSales: p.exemptSales,
        nonTaxableSales: p.nonTaxableSales,

        taxablePurchases: p.taxablePurchases,
        nonTaxablePurchases: p.nonTaxablePurchases,
        commonPurchases: p.commonPurchases,

        taxablePurchasesStandard: p.taxablePurchases,
        taxablePurchasesReduced: 0,
        nonTaxablePurchasesStandard: p.nonTaxablePurchases,
        nonTaxablePurchasesReduced: 0,
        commonPurchasesStandard: p.commonPurchases,
        commonPurchasesReduced: 0,

        nonQualifiedPurchases80: p.nonQualifiedPurchases80,
        nonQualifiedPurchases50: p.nonQualifiedPurchases50,
        nonQualifiedPurchases80Standard: p.nonQualifiedPurchases80,
        nonQualifiedPurchases80Reduced: 0,
        nonQualifiedPurchases50Standard: p.nonQualifiedPurchases50,
        nonQualifiedPurchases50Reduced: 0,

        salesReturnStandard: p.salesReturnAmount,
        salesReturnReduced: 0,
        badDebtStandard: p.badDebtAmount,
        badDebtReduced: 0,

        purchaseReturnTaxableStandard: 0,
        purchaseReturnTaxableReduced: 0,
        purchaseReturnNonTaxableStandard: 0,
        purchaseReturnNonTaxableReduced: 0,
        purchaseReturnCommonStandard: 0,
        purchaseReturnCommonReduced: 0,

        badDebtRecoveredStandard: 0,
        badDebtRecoveredReduced: 0,

        securitiesTransfer: 0,

        unclassifiedTaxCodes: [],
        totalEntries: 0,
        classifiedEntries: 0,
        unclassifiedEntries: 0,

        totalVatFromFreee: 0,
        dealCount: 0,
        manualJournalCount: 0,
      };
    }

    // =====================================================================
    // Step 2: 付表2-3の計算（課税売上割合・控除対象仕入税額）
    // =====================================================================

    // --- 課税売上割合 ---
    // ① 課税資産の譲渡等の対価の額（課税売上高 税抜合計）
    const s2_01_taxableSalesAmount = agg.standardRateSales + agg.reducedRateSales;
    // ② 免税売上額
    const s2_02_exemptSales = agg.exemptSales;
    // ③ 非課税資産の譲渡等の対価の額（有価証券譲渡は5%のみ算入 — No.6405）
    const securitiesTransfer5pct = Math.floor(agg.securitiesTransfer * 0.05);
    const s2_03_nonTaxableSales = agg.nonTaxableSales + securitiesTransfer5pct;

    // ④ 課税標準額 = 千円未満切捨
    const s2_04_taxableBase_standard = floorToUnit(agg.standardRateSales, 1000);
    const s2_04_taxableBase_reduced = floorToUnit(agg.reducedRateSales, 1000);
    const s2_04_taxableBase_total = s2_04_taxableBase_standard + s2_04_taxableBase_reduced;

    // 売上返還等の税額（課税売上割合の計算用 — 分子分母から控除）
    const salesReturnTotal = agg.salesReturnStandard + agg.salesReturnReduced;

    // ⑤ 資産の譲渡等の対価の額 = (① - 返還等) + ② + ③
    const s2_05_totalTransferAmount =
      (s2_01_taxableSalesAmount - salesReturnTotal) + s2_02_exemptSales + s2_03_nonTaxableSales;

    // ⑥ 課税売上割合 = (① - 返還等 + ②) / ⑤ — No.6405
    const taxableSalesNumerator = (s2_01_taxableSalesAmount - salesReturnTotal) + s2_02_exemptSales;
    const s2_06_taxableSalesRatio =
      s2_05_totalTransferAmount > 0
        ? taxableSalesNumerator / s2_05_totalTransferAmount
        : 0;

    // --- 95%ルール判定（短期事業年度は年換算 — No.6401）---
    let taxableSalesForRule = taxableSalesNumerator;
    const fyStart = new Date(fy.start_date);
    const fyEnd = new Date(fy.end_date);
    const fyMonths = Math.max(1, Math.round(
      (fyEnd.getTime() - fyStart.getTime()) / (1000 * 60 * 60 * 24 * 30.4375)
    ));
    if (fyMonths < 12) {
      // 短期事業年度: 年換算で5億円判定
      taxableSalesForRule = Math.floor(taxableSalesNumerator * 12 / fyMonths);
    }
    const qualifiesForFullDeduction =
      s2_06_taxableSalesRatio >= 0.95 && taxableSalesForRule <= 500_000_000;

    let effectiveDeductionMethod: "full" | "individual" | "proportional";
    if (qualifiesForFullDeduction) {
      effectiveDeductionMethod = "full";
    } else if (p.deductionMethod === "full") {
      // ユーザーがfullを指定したが95%ルール非該当の場合、individualにフォールバック
      effectiveDeductionMethod = "individual";
    } else {
      effectiveDeductionMethod = p.deductionMethod;
    }

    // --- 仕入に係る消費税額（国税分）の計算 ---
    // 適格請求書ありの仕入
    const purchaseTax_taxable_standard = Math.floor(agg.taxablePurchasesStandard * rates.standardTaxPortion);
    const purchaseTax_taxable_reduced = Math.floor(agg.taxablePurchasesReduced * rates.reducedTaxPortion);
    const purchaseTax_nonTaxable_standard = Math.floor(agg.nonTaxablePurchasesStandard * rates.standardTaxPortion);
    const purchaseTax_nonTaxable_reduced = Math.floor(agg.nonTaxablePurchasesReduced * rates.reducedTaxPortion);
    const purchaseTax_common_standard = Math.floor(agg.commonPurchasesStandard * rates.standardTaxPortion);
    const purchaseTax_common_reduced = Math.floor(agg.commonPurchasesReduced * rates.reducedTaxPortion);

    // 仕入返還に係る消費税額（国税分） — 控除対象仕入税額から差し引く
    const returnTax_taxable_standard = Math.floor(agg.purchaseReturnTaxableStandard * rates.standardTaxPortion);
    const returnTax_taxable_reduced = Math.floor(agg.purchaseReturnTaxableReduced * rates.reducedTaxPortion);
    const returnTax_nonTaxable_standard = Math.floor(agg.purchaseReturnNonTaxableStandard * rates.standardTaxPortion);
    const returnTax_nonTaxable_reduced = Math.floor(agg.purchaseReturnNonTaxableReduced * rates.reducedTaxPortion);
    const returnTax_common_standard = Math.floor(agg.purchaseReturnCommonStandard * rates.standardTaxPortion);
    const returnTax_common_reduced = Math.floor(agg.purchaseReturnCommonReduced * rates.reducedTaxPortion);

    // ⑯ 課税売上対応の仕入に係る消費税額（国税分）— 返還控除後
    const s2_16_taxablePurchaseTax =
      (purchaseTax_taxable_standard + purchaseTax_taxable_reduced)
      - (returnTax_taxable_standard + returnTax_taxable_reduced);
    // ⑰ 非課税売上対応の仕入に係る消費税額（国税分）— 返還控除後
    const s2_17_nonTaxablePurchaseTax =
      (purchaseTax_nonTaxable_standard + purchaseTax_nonTaxable_reduced)
      - (returnTax_nonTaxable_standard + returnTax_nonTaxable_reduced);
    // ⑱ 共通対応の仕入に係る消費税額（国税分）— 返還控除後
    const s2_18_commonPurchaseTax =
      (purchaseTax_common_standard + purchaseTax_common_reduced)
      - (returnTax_common_standard + returnTax_common_reduced);

    // 仕入税額の合計（全区分）
    const totalPurchaseTax = s2_16_taxablePurchaseTax + s2_17_nonTaxablePurchaseTax + s2_18_commonPurchaseTax;

    // 仕入返還税額合計（参考表示用）
    const totalReturnTax =
      (returnTax_taxable_standard + returnTax_taxable_reduced)
      + (returnTax_nonTaxable_standard + returnTax_nonTaxable_reduced)
      + (returnTax_common_standard + returnTax_common_reduced);

    // --- インボイス経過措置控除税額 ---
    // 経過措置は個別対応方式/一括比例配分方式の按分も必要
    // アダプターでは用途別に分けていないため、全額合算で計算し、
    // 按分は控除方式に応じて後で適用する
    // TODO: アダプターにインボイス経過措置の用途別内訳を追加して精緻化

    const transitTax80_standard_raw = Math.floor(agg.nonQualifiedPurchases80Standard * rates.standardTaxPortion);
    const transitTax80_reduced_raw = Math.floor(agg.nonQualifiedPurchases80Reduced * rates.reducedTaxPortion);
    const transitTax50_standard_raw = Math.floor(agg.nonQualifiedPurchases50Standard * rates.standardTaxPortion);
    const transitTax50_reduced_raw = Math.floor(agg.nonQualifiedPurchases50Reduced * rates.reducedTaxPortion);

    const transitTax80_total = Math.floor((transitTax80_standard_raw + transitTax80_reduced_raw) * 0.8);
    const transitTax50_total = Math.floor((transitTax50_standard_raw + transitTax50_reduced_raw) * 0.5);

    // 経過措置も控除方式に応じた按分を適用
    let s2_transitTax: number;
    if (effectiveDeductionMethod === "full") {
      s2_transitTax = transitTax80_total + transitTax50_total;
    } else if (effectiveDeductionMethod === "proportional") {
      // 一括比例配分: 経過措置全額 × 課税売上割合
      s2_transitTax = Math.floor((transitTax80_total + transitTax50_total) * s2_06_taxableSalesRatio);
    } else {
      // 個別対応方式: 用途別内訳がないため、暫定的に課税売上割合で按分
      // 本来は課対分は全額、非対分は0、共対分は按分が必要
      // TODO: アダプターに用途別内訳追加後に精緻化
      s2_transitTax = Math.floor((transitTax80_total + transitTax50_total) * s2_06_taxableSalesRatio);
    }

    // --- 控除対象仕入税額の決定 ---
    let s2_deductibleInputTax: number;
    let s2_19_taxablePortion = 0;     // 課税売上対応分（全額控除可）
    let s2_20_commonPortion = 0;      // 共通対応分（按分後）
    let deductionDetail: Record<string, unknown>;

    if (effectiveDeductionMethod === "full") {
      // 全額控除
      s2_deductibleInputTax = totalPurchaseTax;
      deductionDetail = {
        method: "full",
        reason: "課税売上割合95%以上かつ課税売上高5億円以下",
        totalPurchaseTax,
      };
    } else if (effectiveDeductionMethod === "individual") {
      // 個別対応方式
      // ⑲ = ⑯（課税売上対応分は全額控除可）
      s2_19_taxablePortion = s2_16_taxablePurchaseTax;
      // ⑳ = floor(⑱ × 課税売上割合)（共通対応分は課税売上割合で按分）
      s2_20_commonPortion = Math.floor(s2_18_commonPurchaseTax * s2_06_taxableSalesRatio);
      // 非課税売上対応分（⑰）は控除不可
      s2_deductibleInputTax = s2_19_taxablePortion + s2_20_commonPortion;
      deductionDetail = {
        method: "individual",
        taxablePurchaseTax: s2_16_taxablePurchaseTax,
        nonTaxablePurchaseTax_控除不可: s2_17_nonTaxablePurchaseTax,
        commonPurchaseTax: s2_18_commonPurchaseTax,
        taxablePortion: s2_19_taxablePortion,
        commonPortion: s2_20_commonPortion,
        taxableSalesRatio: Math.round(s2_06_taxableSalesRatio * 10000) / 10000,
      };
    } else {
      // 一括比例配分方式
      s2_deductibleInputTax = Math.floor(totalPurchaseTax * s2_06_taxableSalesRatio);
      deductionDetail = {
        method: "proportional",
        totalPurchaseTax,
        taxableSalesRatio: Math.round(s2_06_taxableSalesRatio * 10000) / 10000,
        deductibleInputTax: s2_deductibleInputTax,
      };
    }

    // --- 貸倒回収に係る税額（控除過大調整税額 — 付表2-3 ㉘ → 第一表③）---
    const badDebtRecoveredTax_standard = Math.floor(agg.badDebtRecoveredStandard * rates.standardTaxPortion);
    const badDebtRecoveredTax_reduced = Math.floor(agg.badDebtRecoveredReduced * rates.reducedTaxPortion);
    const totalBadDebtRecoveredTax = badDebtRecoveredTax_standard + badDebtRecoveredTax_reduced;

    // 付表2-3 結果
    const schedule2_3 = {
      "01_課税資産の譲渡等の対価の額": s2_01_taxableSalesAmount,
      "02_免税売上額": s2_02_exemptSales,
      "03_非課税資産の譲渡等の対価の額": s2_03_nonTaxableSales,
      "03_うち有価証券譲渡5%算入額": securitiesTransfer5pct,
      "04_課税標準額_標準税率": s2_04_taxableBase_standard,
      "04_課税標準額_軽減税率": s2_04_taxableBase_reduced,
      "04_課税標準額_合計": s2_04_taxableBase_total,
      "05_資産の譲渡等の対価の額": s2_05_totalTransferAmount,
      "06_課税売上割合": Math.round(s2_06_taxableSalesRatio * 10000) / 10000,
      "06_課税売上割合_パーセント": Math.round(s2_06_taxableSalesRatio * 10000) / 100,
      "95%ルール該当": qualifiesForFullDeduction,
      "95%ルール_年換算売上": taxableSalesForRule,
      "適用控除方式": effectiveDeductionMethod,
      "16_課税売上対応仕入税額": s2_16_taxablePurchaseTax,
      "17_非課税売上対応仕入税額": s2_17_nonTaxablePurchaseTax,
      "18_共通対応仕入税額": s2_18_commonPurchaseTax,
      "19_課税売上対応分_控除": s2_19_taxablePortion,
      "20_共通対応分_按分後": s2_20_commonPortion,
      "控除対象仕入税額": s2_deductibleInputTax,
      "仕入返還税額": totalReturnTax,
      "経過措置控除税額_80%": transitTax80_total,
      "経過措置控除税額_50%": transitTax50_total,
      "経過措置控除税額_合計": s2_transitTax,
      "28_貸倒回収税額_控除過大調整": totalBadDebtRecoveredTax,
      deductionDetail,
    };

    // =====================================================================
    // Step 3: 付表1-3の計算（税率別集計）
    // =====================================================================

    // --- 売上税額（国税分）---
    const salesTax_standard = Math.floor(s2_04_taxableBase_standard * rates.standardTaxPortion);
    const salesTax_reduced = Math.floor(s2_04_taxableBase_reduced * rates.reducedTaxPortion);
    const totalSalesTax = salesTax_standard + salesTax_reduced;

    // --- 売上返還税額（国税分）---
    const salesReturnTax_standard = Math.floor(agg.salesReturnStandard * rates.standardTaxPortion);
    const salesReturnTax_reduced = Math.floor(agg.salesReturnReduced * rates.reducedTaxPortion);
    const totalSalesReturnTax = salesReturnTax_standard + salesReturnTax_reduced;

    // --- 貸倒税額（国税分）---
    const badDebtTax_standard = Math.floor(agg.badDebtStandard * rates.standardTaxPortion);
    const badDebtTax_reduced = Math.floor(agg.badDebtReduced * rates.reducedTaxPortion);
    const totalBadDebtTax = badDebtTax_standard + badDebtTax_reduced;

    const schedule1_3 = {
      "売上税額_標準税率10%": salesTax_standard,
      "売上税額_軽減税率8%": salesTax_reduced,
      "売上税額_合計": totalSalesTax,
      "売上返還税額_標準税率10%": salesReturnTax_standard,
      "売上返還税額_軽減税率8%": salesReturnTax_reduced,
      "売上返還税額_合計": totalSalesReturnTax,
      "控除対象仕入税額": s2_deductibleInputTax,
      "経過措置控除税額": s2_transitTax,
      "貸倒税額_標準税率10%": badDebtTax_standard,
      "貸倒税額_軽減税率8%": badDebtTax_reduced,
      "貸倒税額_合計": totalBadDebtTax,
      "課税標準額_標準税率": s2_04_taxableBase_standard,
      "課税標準額_軽減税率": s2_04_taxableBase_reduced,
    };

    // =====================================================================
    // Step 4: 第一表の計算
    // =====================================================================

    // ① 課税標準額 = 千円未満切捨（税率別合計）
    const f1_01_taxableBase = s2_04_taxableBase_total;

    // ② 消費税額 = 合計売上税額
    const f1_02_consumptionTax = totalSalesTax;

    // ③ 控除過大調整税額（貸倒回収があった場合 — 付表2-3 ㉘から転記）
    const f1_03_excessDeductionAdj = totalBadDebtRecoveredTax;

    // ④ = ② + ③
    const f1_04_subtotal = f1_02_consumptionTax + f1_03_excessDeductionAdj;

    // ⑤ 売上返還等税額
    const f1_05_salesReturnTax = totalSalesReturnTax;

    // ⑥ = ④ - ⑤
    const f1_06_netSalesTax = f1_04_subtotal - f1_05_salesReturnTax;

    // ⑦ 控除対象仕入税額
    const f1_07_deductibleInputTax = s2_deductibleInputTax;

    // ⑩ 貸倒れ税額
    const f1_10_badDebtTax = totalBadDebtTax;

    // ⑪ 経過措置控除税額
    const f1_11_transitTax = s2_transitTax;

    // ⑧ 控除税額小計 = ⑦ + ⑩ + ⑪
    const f1_08_deductionSubtotal = f1_07_deductibleInputTax + f1_10_badDebtTax + f1_11_transitTax;

    // ⑨ 差引税額 = ⑥ - ⑧（百円未満切捨、ただし負の場合はそのまま）
    const f1_09_rawDifference = f1_06_netSalesTax - f1_08_deductionSubtotal;
    const f1_09_differentialTax =
      f1_09_rawDifference >= 0
        ? floorToUnit(f1_09_rawDifference, 100)
        : f1_09_rawDifference; // 負（還付）の場合は切捨不要

    // ⑫ = ⑨（ここではそのまま）
    const f1_12_afterBadDebt = f1_09_differentialTax;

    // ⑬ 納付税額 = max(⑫, 0) → 百円未満切捨
    const f1_13_nationalTaxPayable =
      f1_12_afterBadDebt > 0
        ? floorToUnit(f1_12_afterBadDebt, 100)
        : 0;

    // ⑭ 中間納付税額
    const f1_14_interimNationalTax = p.interimNationalTax;

    // ⑮ 控除不足還付税額 = 差引税額がマイナスの場合の還付額
    const f1_15_refundAmount =
      f1_12_afterBadDebt < 0
        ? Math.abs(f1_12_afterBadDebt)
        : 0;

    // ⑯ 差引納付(還付)税額 = ⑬ - ⑭（負なら還付）
    const f1_16_netNationalTax = f1_13_nationalTaxPayable - f1_14_interimNationalTax;

    // --- 地方消費税 ---

    // ⑰ 地方消費税の課税標準（差引税額ベース）
    // 正の差引税額を基に 22/78 で計算
    const f1_17_localTaxBase = f1_09_differentialTax;

    // 地方消費税額の計算
    let f1_localTaxRaw: number;
    if (f1_09_differentialTax >= 0) {
      f1_localTaxRaw = Math.floor(f1_09_differentialTax * 22 / 78);
    } else {
      // 還付の場合: 地方消費税も還付
      f1_localTaxRaw = -Math.floor(Math.abs(f1_09_differentialTax) * 22 / 78);
    }

    // ㉔ 地方消費税納付税額 = max(地方税, 0) → 百円未満切捨
    const f1_24_localTaxPayable =
      f1_localTaxRaw > 0
        ? floorToUnit(f1_localTaxRaw, 100)
        : 0;

    // ㉕ 中間納付地方消費税額
    const f1_25_interimLocalTax = p.interimLocalTax;

    // ㉖ 控除不足還付地方消費税額
    const f1_26_localRefundAmount =
      f1_localTaxRaw < 0
        ? Math.abs(f1_localTaxRaw)
        : 0;

    // 地方消費税の差引納付(還付)税額
    const f1_netLocalTax = f1_24_localTaxPayable - f1_25_interimLocalTax;

    // 消費税及び地方消費税の合計納付（還付）税額
    const totalNetTax = f1_16_netNationalTax + f1_netLocalTax;

    // 第一表 結果
    const form1 = {
      "01_課税標準額": f1_01_taxableBase,
      "02_消費税額": f1_02_consumptionTax,
      "03_控除過大調整税額": f1_03_excessDeductionAdj,
      "04_小計": f1_04_subtotal,
      "05_売上返還等税額": f1_05_salesReturnTax,
      "06_差引": f1_06_netSalesTax,
      "07_控除対象仕入税額": f1_07_deductibleInputTax,
      "08_控除税額小計": f1_08_deductionSubtotal,
      "09_差引税額": f1_09_differentialTax,
      "10_貸倒れ税額": f1_10_badDebtTax,
      "11_経過措置控除税額": f1_11_transitTax,
      "12_差引後": f1_12_afterBadDebt,
      "13_納付税額": f1_13_nationalTaxPayable,
      "14_中間納付税額": f1_14_interimNationalTax,
      "15_控除不足還付税額": f1_15_refundAmount,
      "16_差引納付還付税額": f1_16_netNationalTax,
      "17_地方消費税課税標準": f1_17_localTaxBase,
      "地方消費税額_計算値": f1_localTaxRaw,
      "24_地方消費税納付税額": f1_24_localTaxPayable,
      "25_中間納付地方消費税額": f1_25_interimLocalTax,
      "26_控除不足還付地方消費税額": f1_26_localRefundAmount,
      "地方消費税_差引納付還付": f1_netLocalTax,
      "合計納付還付税額": totalNetTax,
    };

    // =====================================================================
    // freee検算（reconciliation）
    // =====================================================================

    if (freeeDataUsed && agg.totalVatFromFreee > 0) {
      const calculatedTotalTax = f1_02_consumptionTax + Math.floor(
        s2_04_taxableBase_standard * rates.standardLocalPortion
      ) + Math.floor(
        s2_04_taxableBase_reduced * rates.reducedLocalPortion
      );
      freeeReconciliation = {
        freee側VAT合計: agg.totalVatFromFreee,
        計算側売上税額_国税: f1_02_consumptionTax,
        計算側売上税額_国地合計: calculatedTotalTax,
        差額: agg.totalVatFromFreee - calculatedTotalTax,
        注記: "差額が大きい場合は仕訳の税コード設定を確認してください",
      };
    }

    // =====================================================================
    // Summary
    // =====================================================================

    const isRefund = totalNetTax < 0;
    const summary = {
      判定: isRefund ? "還付" : "納付",
      国税_納付税額: f1_13_nationalTaxPayable,
      国税_還付税額: f1_15_refundAmount,
      国税_中間納付: f1_14_interimNationalTax,
      国税_差引: f1_16_netNationalTax,
      地方税_納付税額: f1_24_localTaxPayable,
      地方税_還付税額: f1_26_localRefundAmount,
      地方税_中間納付: f1_25_interimLocalTax,
      地方税_差引: f1_netLocalTax,
      合計納付還付税額: totalNetTax,
      課税売上割合: `${Math.round(s2_06_taxableSalesRatio * 10000) / 100}%`,
      適用控除方式: effectiveDeductionMethod,
    };

    // =====================================================================
    // Meta
    // =====================================================================

    const meta = {
      freeeデータ使用: freeeDataUsed,
      集計件数_合計: agg.totalEntries,
      集計件数_分類済: agg.classifiedEntries,
      集計件数_未分類: agg.unclassifiedEntries,
      未分類tax_codes: agg.unclassifiedTaxCodes,
      事業年度: { start: fy.start_date, end: fy.end_date },
      事業年度月数: fyMonths,
      使用税率: {
        standardTaxPortion: rates.standardTaxPortion,
        reducedTaxPortion: rates.reducedTaxPortion,
        standardLocalPortion: rates.standardLocalPortion,
        reducedLocalPortion: rates.reducedLocalPortion,
      },
      ...(agg.unclassifiedEntries > 0 ? {
        警告: `${agg.unclassifiedEntries}件の仕訳が未分類のtax_codeを持っています。` +
          `申告額に影響する可能性があります。対象コード: ${agg.unclassifiedTaxCodes.join(", ")}`,
      } : {}),
    };

    // =====================================================================
    // Build final result
    // =====================================================================

    const result = {
      schedule2_3,
      schedule1_3,
      form1,
      summary,
      meta,
      ...(freeeReconciliation ? { freeeReconciliation } : {}),
    };

    // =====================================================================
    // Save to schedule_results
    // =====================================================================

    const now = new Date().toISOString();
    const existing = db.prepare(
      "SELECT version FROM schedule_results WHERE fiscal_year_id = ? AND schedule_number = 'consumption-general' ORDER BY version DESC LIMIT 1"
    ).get(p.fiscalYearId) as any;
    const version = existing ? existing.version + 1 : 1;

    const inputData = {
      useFreeeData: p.useFreeeData,
      deductionMethod: effectiveDeductionMethod,
      standardRateSales: agg.standardRateSales,
      reducedRateSales: agg.reducedRateSales,
      exemptSales: agg.exemptSales,
      nonTaxableSales: agg.nonTaxableSales,
      interimNationalTax: p.interimNationalTax,
      interimLocalTax: p.interimLocalTax,
    };

    db.prepare(`
      INSERT INTO schedule_results (fiscal_year_id, schedule_number, version, input_data, result_data, is_valid, calculated_at)
      VALUES (?, 'consumption-general', ?, ?, ?, 1, ?)
    `).run(p.fiscalYearId, version, JSON.stringify(inputData), JSON.stringify(result), now);

    // Audit log
    db.prepare(`
      INSERT INTO audit_log (fiscal_year_id, action, target, detail, timestamp)
      VALUES (?, 'calculate', 'consumption-general', ?, ?)
    `).run(p.fiscalYearId, JSON.stringify({
      version,
      method: effectiveDeductionMethod,
      nationalTax: f1_16_netNationalTax,
      localTax: f1_netLocalTax,
      total: totalNetTax,
      freeeDataUsed,
    }), now);

    return jsonResult("消費税申告書（一般課税）— 付表2-3 → 付表1-3 → 第一表", result);
  } catch (error) {
    return errorResult(formatError(error));
  }
};

// ---------------------------------------------------------------------------
// Tool definition
// ---------------------------------------------------------------------------

export const CalculateGeneralConsumptionTaxTool: ToolDefinition<typeof schema> = {
  name: "calculate-consumption-tax-general",
  description:
    "消費税（一般課税・原則課税）を計算します。" +
    "付表2-3（課税売上割合・控除対象仕入税額）→ 付表1-3（税率別集計）→ 第一表の順に計算。" +
    "freeeデータから自動集計（useFreeeData=true）または手動入力（useFreeeData=false）に対応。" +
    "個別対応方式・一括比例配分方式・全額控除の自動判定、インボイス経過措置、還付申告に対応。",
  schema,
  handler,
};
