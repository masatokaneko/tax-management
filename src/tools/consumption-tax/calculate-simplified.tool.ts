import { z } from "zod";
import type { ToolDefinition } from "../../types/tool-definition.js";
import { getDb } from "../../db/client.js";
import { errorResult, jsonResult, formatError } from "../../helpers/format-error.js";
import { floorToUnit } from "../../services/rounding.service.js";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

const salesByTypeSchema = z.object({
  type: z.enum(["1", "2", "3", "4", "5", "6"]).describe(
    "事業区分: 1=卸売業, 2=小売業, 3=製造業等, 4=その他, 5=サービス業等, 6=不動産業"
  ),
  standardRateSales: z.number().int().default(0).describe("標準税率10%の課税売上高（税抜・円）"),
  reducedRateSales: z.number().int().default(0).describe("軽減税率8%の課税売上高（税抜・円）"),
});

const schema = z.object({
  fiscalYearId: z.string().describe("事業年度ID"),

  // freeeデータ使用モード
  useFreeeData: z.boolean().default(true)
    .describe("trueの場合、freee_cacheから自動集計。freeeで簡易課税用tax_code（課売上一〜六）を使っている場合に有効"),

  // 手動入力（useFreeeData=false または補正用）
  salesByType: z.array(salesByTypeSchema).default([])
    .describe("事業区分ごとの課税売上高"),

  // 中間納付
  interimNationalTax: z.number().int().default(0).describe("中間納付消費税額（国税・円）"),
  interimLocalTax: z.number().int().default(0).describe("中間納付地方消費税額（円）"),
});

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** みなし仕入率 */
const DEEMED_PURCHASE_RATES: Record<string, number> = {
  "1": 0.90, // 第一種（卸売業）
  "2": 0.80, // 第二種（小売業）
  "3": 0.70, // 第三種（製造業等）
  "4": 0.60, // 第四種（その他）
  "5": 0.50, // 第五種（サービス業等）
  "6": 0.40, // 第六種（不動産業）
};

const TYPE_LABELS: Record<string, string> = {
  "1": "第一種（卸売業）",
  "2": "第二種（小売業）",
  "3": "第三種（製造業等）",
  "4": "第四種（その他）",
  "5": "第五種（サービス業等）",
  "6": "第六種（不動産業）",
};

const SIMPLIFIED_TYPE_KEYS = ["1", "2", "3", "4", "5", "6"] as const;

// ---------------------------------------------------------------------------
// Internal types
// ---------------------------------------------------------------------------

/** Unified type detail used in both freee and manual modes */
interface TypeDetail {
  type: string;
  typeLabel: string;
  standardRateSales: number;  // 0 when from freee (not rate-split)
  reducedRateSales: number;   // 0 when from freee (not rate-split)
  totalSales: number;
  deemedPurchaseRate: number;
  outputTaxStandard: number;  // 0 when from freee (not rate-split)
  outputTaxReduced: number;   // 0 when from freee (not rate-split)
  outputTax: number;          // = nationalTax from aggregator, or computed from rates
}

interface SpecialRuleResult {
  method: "single_type" | "one_type_75" | "two_type_75" | "standard";
  description: string;
  deemedInputTax: number;
  breakdown: Record<string, number>; // typeKey -> deemed input tax for that type
}

// ---------------------------------------------------------------------------
// freee data loader
// ---------------------------------------------------------------------------

interface RateBucketLike {
  taxableAmount: number;
  nationalTax: number;
  localTax: number;
}

/**
 * Load freee data from the SQLite cache, aggregate via the
 * consumption-tax-aggregator service, and return simplified sales buckets.
 */
async function loadFreeeSimplifiedSales(
  fiscalYearId: string,
): Promise<Record<string, RateBucketLike> | null> {
  try {
    // Dynamic import — the aggregator service may not exist yet
    const mod = await import("../../services/consumption-tax-aggregator.service.js");
    if (typeof mod.aggregateConsumptionTax !== "function") return null;

    // Read from freee_cache
    const db = getDb();
    const dealsRow = db.prepare(
      "SELECT data_json FROM freee_cache WHERE fiscal_year_id = ? AND data_type = 'journals' ORDER BY fetched_at DESC LIMIT 1"
    ).get(fiscalYearId) as { data_json: string } | undefined;

    const manualJournalsRow = db.prepare(
      "SELECT data_json FROM freee_cache WHERE fiscal_year_id = ? AND data_type = 'manual_journals' ORDER BY fetched_at DESC LIMIT 1"
    ).get(fiscalYearId) as { data_json: string } | undefined;

    const deals = dealsRow ? JSON.parse(dealsRow.data_json) : [];
    const manualJournals = manualJournalsRow ? JSON.parse(manualJournalsRow.data_json) : [];

    if ((!Array.isArray(deals) || deals.length === 0) &&
        (!Array.isArray(manualJournals) || manualJournals.length === 0)) {
      return null;
    }

    const agg = mod.aggregateConsumptionTax(
      Array.isArray(deals) ? deals : [],
      Array.isArray(manualJournals) ? manualJournals : [],
    );

    if (!agg || !agg.simplifiedSales) return null;

    // Map to a keyed object: "1" -> RateBucket, "2" -> RateBucket, etc.
    const result: Record<string, RateBucketLike> = {};
    for (const k of SIMPLIFIED_TYPE_KEYS) {
      const bucket = agg.simplifiedSales[`type${k}` as keyof typeof agg.simplifiedSales];
      if (bucket && (bucket.taxableAmount !== 0 || bucket.nationalTax !== 0)) {
        result[k] = bucket;
      }
    }

    return Object.keys(result).length > 0 ? result : null;
  } catch {
    // Module not found or error — fall through
    return null;
  }
}

// ---------------------------------------------------------------------------
// Calculation helpers
// ---------------------------------------------------------------------------

/**
 * Build TypeDetail array from manual sales input.
 */
function computeTypeDetailsManual(
  salesByType: Array<{ type: string; standardRateSales: number; reducedRateSales: number }>,
  rates: { standardTaxPortion: number; reducedTaxPortion: number },
): TypeDetail[] {
  return salesByType.map((s) => {
    const deemedRate = DEEMED_PURCHASE_RATES[s.type];
    const outputTaxStandard = Math.floor(s.standardRateSales * rates.standardTaxPortion);
    const outputTaxReduced = Math.floor(s.reducedRateSales * rates.reducedTaxPortion);
    const outputTax = outputTaxStandard + outputTaxReduced;

    return {
      type: s.type,
      typeLabel: TYPE_LABELS[s.type],
      standardRateSales: s.standardRateSales,
      reducedRateSales: s.reducedRateSales,
      totalSales: s.standardRateSales + s.reducedRateSales,
      deemedPurchaseRate: deemedRate,
      outputTaxStandard,
      outputTaxReduced,
      outputTax,
    };
  });
}

/**
 * Build TypeDetail array from freee aggregator RateBuckets.
 *
 * In this mode, the aggregator has already computed nationalTax correctly
 * per entry (splitting standard/reduced at the journal-entry level), so
 * we use nationalTax directly as outputTax.
 */
function computeTypeDetailsFromFreee(
  buckets: Record<string, RateBucketLike>,
): TypeDetail[] {
  const details: TypeDetail[] = [];

  for (const k of SIMPLIFIED_TYPE_KEYS) {
    const bucket = buckets[k];
    if (!bucket) continue;

    details.push({
      type: k,
      typeLabel: TYPE_LABELS[k],
      standardRateSales: 0,   // not split by rate in freee mode
      reducedRateSales: 0,
      totalSales: bucket.taxableAmount,
      deemedPurchaseRate: DEEMED_PURCHASE_RATES[k],
      outputTaxStandard: 0,
      outputTaxReduced: 0,
      outputTax: bucket.nationalTax,
    });
  }

  return details;
}

/**
 * 75%特例の3パターンを全て計算し、最も有利な方式を選択する。
 *
 * - パターン1: 1業種が売上の75%以上 → そのみなし仕入率を全体に適用
 * - パターン2: 2業種合計が75%以上（3業種以上の場合のみ）
 *   → 高い率の業種にその率を適用、残り全てに低い率を適用
 * - パターン3: 特例なし → 各業種ごとに個別適用
 *
 * 控除税額が最大（=納付税額が最小）になる方式を自動選択。
 */
function computeSpecialRule(details: TypeDetail[]): SpecialRuleResult {
  const activeTypes = details.filter((d) => d.totalSales > 0);
  const totalSales = activeTypes.reduce((sum, d) => sum + d.totalSales, 0);
  const totalOutputTax = activeTypes.reduce((sum, d) => sum + d.outputTax, 0);

  // --- 1業種のみの場合 ---
  if (activeTypes.length === 1) {
    const t = activeTypes[0];
    const deemed = Math.floor(t.outputTax * DEEMED_PURCHASE_RATES[t.type]);
    return {
      method: "single_type",
      description: `${t.typeLabel}のみ（1業種）。みなし仕入率${DEEMED_PURCHASE_RATES[t.type] * 100}%を適用。`,
      deemedInputTax: deemed,
      breakdown: { [t.type]: deemed },
    };
  }

  // --- パターン3: 特例なし（各業種ごとに個別計算）---
  const standardBreakdown: Record<string, number> = {};
  let standardDeemedTotal = 0;
  for (const d of activeTypes) {
    const deemed = Math.floor(d.outputTax * DEEMED_PURCHASE_RATES[d.type]);
    standardBreakdown[d.type] = deemed;
    standardDeemedTotal += deemed;
  }
  const standardResult: SpecialRuleResult = {
    method: "standard",
    description: "各事業区分ごとに個別にみなし仕入率を適用。",
    deemedInputTax: standardDeemedTotal,
    breakdown: standardBreakdown,
  };

  // --- パターン1: 1業種が75%以上 ---
  let oneType75Result: SpecialRuleResult | null = null;
  if (totalSales > 0) {
    for (const d of activeTypes) {
      if (d.totalSales / totalSales >= 0.75) {
        const rate = DEEMED_PURCHASE_RATES[d.type];
        const deemed = Math.floor(totalOutputTax * rate);
        const breakdownMap: Record<string, number> = {};
        for (const dd of activeTypes) {
          breakdownMap[dd.type] = Math.floor(dd.outputTax * rate);
        }
        const candidate: SpecialRuleResult = {
          method: "one_type_75",
          description:
            `${d.typeLabel}の売上が全体の75%以上のため、みなし仕入率${rate * 100}%を全体に適用（75%特例・1業種）。`,
          deemedInputTax: deemed,
          breakdown: breakdownMap,
        };
        // 最も有利なものを選択
        if (!oneType75Result || candidate.deemedInputTax > oneType75Result.deemedInputTax) {
          oneType75Result = candidate;
        }
      }
    }
  }

  // --- パターン2: 2業種合計が75%以上（3種類以上の事業がある場合のみ）---
  let twoType75Result: SpecialRuleResult | null = null;
  if (activeTypes.length >= 3 && totalSales > 0) {
    for (let i = 0; i < activeTypes.length; i++) {
      for (let j = i + 1; j < activeTypes.length; j++) {
        const a = activeTypes[i];
        const b = activeTypes[j];
        const combinedSales = a.totalSales + b.totalSales;

        if (combinedSales / totalSales >= 0.75) {
          // みなし仕入率が高い方と低い方を決定
          const rateA = DEEMED_PURCHASE_RATES[a.type];
          const rateB = DEEMED_PURCHASE_RATES[b.type];
          const higherRateType = rateA >= rateB ? a : b;
          const lowerRateType = rateA >= rateB ? b : a;
          const higherRate = Math.max(rateA, rateB);
          const lowerRate = Math.min(rateA, rateB);

          const breakdownMap: Record<string, number> = {};
          let deemed = 0;

          // 高い率の業種にはその率を適用
          const deemedHigher = Math.floor(higherRateType.outputTax * higherRate);
          breakdownMap[higherRateType.type] = deemedHigher;
          deemed += deemedHigher;

          // 残り全て（低い率の業種 + その他の業種）に低い率を適用
          for (const d of activeTypes) {
            if (d.type !== higherRateType.type) {
              const deemedOther = Math.floor(d.outputTax * lowerRate);
              breakdownMap[d.type] = deemedOther;
              deemed += deemedOther;
            }
          }

          const candidate: SpecialRuleResult = {
            method: "two_type_75",
            description:
              `${higherRateType.typeLabel}と${lowerRateType.typeLabel}の売上合計が全体の75%以上のため、` +
              `${higherRateType.typeLabel}に${higherRate * 100}%、残りに${lowerRate * 100}%を適用（75%特例・2業種）。`,
            deemedInputTax: deemed,
            breakdown: breakdownMap,
          };

          if (!twoType75Result || candidate.deemedInputTax > twoType75Result.deemedInputTax) {
            twoType75Result = candidate;
          }
        }
      }
    }
  }

  // --- 最も有利な方式を選択（控除税額が最大 = 納付税額が最小）---
  const candidates: SpecialRuleResult[] = [standardResult];
  if (oneType75Result) candidates.push(oneType75Result);
  if (twoType75Result) candidates.push(twoType75Result);

  let best = candidates[0];
  for (const c of candidates) {
    if (c.deemedInputTax > best.deemedInputTax) {
      best = c;
    }
  }

  return best;
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

const handler = async (args: any) => {
  try {
    const { fiscalYearId, useFreeeData, salesByType, interimNationalTax, interimLocalTax } = args.params;
    const db = getDb();

    // Validate fiscal year
    const fy = db.prepare("SELECT * FROM fiscal_years WHERE id = ?").get(fiscalYearId) as any;
    if (!fy) return errorResult(`事業年度 ${fiscalYearId} が見つかりません。`);

    // Load consumption tax rates
    const ratesPath = resolve(__dirname, "../../data/tax-rates/consumption-tax.json");
    const rates = JSON.parse(readFileSync(ratesPath, "utf-8"));

    // -----------------------------------------------------------------------
    // Step 1: データ取得 & Step 2: 各事業区分の売上税額計算
    // -----------------------------------------------------------------------
    let details: TypeDetail[];
    let dataSource: "freee" | "manual" | "freee_with_override";

    if (useFreeeData) {
      const freeeData = await loadFreeeSimplifiedSales(fiscalYearId);

      if (freeeData) {
        if (salesByType.length > 0) {
          // freeeデータ + 手動補正
          // 手動入力がある業種は手動値で上書き、それ以外はfreee
          dataSource = "freee_with_override";
          const overrideTypes = new Set(salesByType.map((s: any) => s.type as string));

          // freee由来の業種（手動上書き対象外）
          const freeeDetails = computeTypeDetailsFromFreee(
            Object.fromEntries(
              Object.entries(freeeData).filter(([k]) => !overrideTypes.has(k))
            )
          );
          // 手動入力の業種
          const manualDetails = computeTypeDetailsManual(salesByType, rates);
          details = [...freeeDetails, ...manualDetails];
        } else {
          dataSource = "freee";
          details = computeTypeDetailsFromFreee(freeeData);
        }
      } else {
        // freeeデータが取得できない場合 → 手動入力にフォールバック
        if (salesByType.length === 0) {
          return errorResult(
            "useFreeeData=true ですが、freeeデータの自動集計に失敗しました" +
            "（aggregatorサービス未対応、またはキャッシュ未取得）。" +
            "salesByType パラメータで手動入力するか、先に fetch-freee-data でデータを取得してください。"
          );
        }
        dataSource = "manual";
        details = computeTypeDetailsManual(salesByType, rates);
      }
    } else {
      if (salesByType.length === 0) {
        return errorResult("useFreeeData=false の場合、salesByType の指定が必須です。");
      }
      dataSource = "manual";
      details = computeTypeDetailsManual(salesByType, rates);
    }

    if (details.length === 0) {
      return errorResult("課税売上が0件です。事業区分ごとの売上を入力してください。");
    }

    const totalOutputTax = details.reduce((sum, d) => sum + d.outputTax, 0);
    const totalSales = details.reduce((sum, d) => sum + d.totalSales, 0);

    // -----------------------------------------------------------------------
    // Step 3: 75%特例判定・みなし仕入税額計算
    // -----------------------------------------------------------------------
    const specialRule = computeSpecialRule(details);

    // -----------------------------------------------------------------------
    // Step 4: 第一表の計算
    // -----------------------------------------------------------------------

    // ① 課税標準額（千円未満切捨）
    const taxableBase = floorToUnit(totalSales, 1000);

    // ② 消費税額
    const consumptionTaxAmount = totalOutputTax;

    // ⑦ 控除対象仕入税額（みなし仕入税額）
    const deductibleInputTax = specialRule.deemedInputTax;

    // 差引税額 = ② - ⑦
    const rawDifference = consumptionTaxAmount - deductibleInputTax;

    // ⑨ 差引税額（百円未満切捨。マイナスの場合も百円単位に丸める）
    const deductedTaxAmount = rawDifference >= 0
      ? floorToUnit(rawDifference, 100)
      : -floorToUnit(Math.abs(rawDifference), 100);

    // ⑬ 納付税額 / ⑮ 還付税額
    const nationalTaxPayable = Math.max(deductedTaxAmount, 0);
    const nationalTaxRefund = Math.max(-deductedTaxAmount, 0);

    // ⑭ 中間納付税額
    const interimNational = interimNationalTax;

    // 差引納付税額（中間納付控除後）
    const nationalNetPayable = nationalTaxPayable - interimNational;
    const nationalNetRefund = nationalNetPayable < 0 ? Math.abs(nationalNetPayable) : 0;
    const nationalFinalPayable = Math.max(nationalNetPayable, 0);

    // --- 地方消費税 ---
    // 地方税 = floor(⑨ × 22/78) → 百円未満切捨
    const localTaxRaw = deductedTaxAmount >= 0
      ? Math.floor(deductedTaxAmount * 22 / 78)
      : -Math.floor(Math.abs(deductedTaxAmount) * 22 / 78);
    const localTax = localTaxRaw >= 0
      ? floorToUnit(localTaxRaw, 100)
      : -floorToUnit(Math.abs(localTaxRaw), 100);

    const localTaxPayable = Math.max(localTax, 0);
    const localTaxRefund = Math.max(-localTax, 0);

    // 地方中間納付控除後
    const localNetPayable = localTaxPayable - interimLocalTax;
    const localNetRefund = localNetPayable < 0 ? Math.abs(localNetPayable) : 0;
    const localFinalPayable = Math.max(localNetPayable, 0);

    // -----------------------------------------------------------------------
    // Build result
    // -----------------------------------------------------------------------

    const result = {
      details: details.map((d) => ({
        type: d.type,
        typeLabel: d.typeLabel,
        standardRateSales: d.standardRateSales,
        reducedRateSales: d.reducedRateSales,
        totalSales: d.totalSales,
        deemedPurchaseRate: d.deemedPurchaseRate,
        outputTaxStandard: d.outputTaxStandard,
        outputTaxReduced: d.outputTaxReduced,
        outputTax: d.outputTax,
        deemedInputTax: specialRule.breakdown[d.type] ?? 0,
      })),
      specialRule: {
        method: specialRule.method,
        description: specialRule.description,
        totalDeemedInputTax: specialRule.deemedInputTax,
      },
      form1: {
        line1_taxableBase: taxableBase,
        line2_consumptionTaxAmount: consumptionTaxAmount,
        line7_deductibleInputTax: deductibleInputTax,
        line9_deductedTaxAmount: deductedTaxAmount,
        line13_nationalTaxPayable: nationalTaxPayable,
        line14_interimNationalTax: interimNational,
        line15_nationalTaxRefund: nationalTaxRefund,
        nationalNetPayable: nationalFinalPayable,
        nationalNetRefund,
        localTax: localTaxPayable,
        localTaxRefund,
        interimLocalTax,
        localNetPayable: localFinalPayable,
        localNetRefund,
      },
      summary: {
        businessTypeCount: new Set(details.map((d) => d.type)).size,
        totalSales,
        totalOutputTax,
        totalDeemedInputTax: deductibleInputTax,
        nationalTaxPayable: nationalFinalPayable,
        nationalTaxRefund: nationalNetRefund,
        localTaxPayable: localFinalPayable,
        localTaxRefund: localNetRefund,
        totalPayable: nationalFinalPayable + localFinalPayable,
        totalRefund: nationalNetRefund + localNetRefund,
      },
      meta: {
        dataSource,
        useFreeeData,
        interimNationalTax,
        interimLocalTax,
      },
    };

    // -----------------------------------------------------------------------
    // Save to DB
    // -----------------------------------------------------------------------
    const now = new Date().toISOString();
    const existing = db.prepare(
      "SELECT version FROM schedule_results WHERE fiscal_year_id = ? AND schedule_number = 'consumption-simplified' ORDER BY version DESC LIMIT 1"
    ).get(fiscalYearId) as any;
    const version = existing ? existing.version + 1 : 1;

    const inputDataForSave = dataSource === "freee"
      ? { dataSource, interimNationalTax, interimLocalTax }
      : {
          dataSource,
          salesByType: salesByType.length > 0 ? salesByType : details.map((d) => ({
            type: d.type,
            totalSales: d.totalSales,
            outputTax: d.outputTax,
          })),
          interimNationalTax,
          interimLocalTax,
        };

    db.prepare(`
      INSERT INTO schedule_results (fiscal_year_id, schedule_number, version, input_data, result_data, is_valid, calculated_at)
      VALUES (?, 'consumption-simplified', ?, ?, ?, 1, ?)
    `).run(
      fiscalYearId,
      version,
      JSON.stringify(inputDataForSave),
      JSON.stringify(result),
      now,
    );

    return jsonResult("消費税申告書（簡易課税）", result);
  } catch (error) {
    return errorResult(formatError(error));
  }
};

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------

export const CalculateSimplifiedConsumptionTaxTool: ToolDefinition<typeof schema> = {
  name: "calculate-consumption-tax-simplified",
  description:
    "消費税（簡易課税）を計算します。freeeデータから自動集計、または手動入力で事業区分ごとのみなし仕入率を適用して納付税額を算出。75%特例（1業種・2業種）を自動判定し最有利方式を選択。還付・中間納付にも対応。",
  schema,
  handler,
};
