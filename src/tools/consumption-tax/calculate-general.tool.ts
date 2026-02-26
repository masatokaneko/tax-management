import { z } from "zod";
import type { ToolDefinition } from "../../types/tool-definition.js";
import { getDb } from "../../db/client.js";
import { errorResult, jsonResult, formatError } from "../../helpers/format-error.js";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

const schema = z.object({
  fiscalYearId: z.string().describe("事業年度ID"),

  // Taxable sales
  standardRateSales: z.number().int().default(0).describe("標準税率（10%）対象の課税売上高（税抜・円）"),
  reducedRateSales: z.number().int().default(0).describe("軽減税率（8%）対象の課税売上高（税抜・円）"),
  exemptSales: z.number().int().default(0).describe("免税売上高（輸出等）（円）"),
  nonTaxableSales: z.number().int().default(0).describe("非課税売上高（円）"),

  // Input tax (purchases)
  standardRatePurchases: z.number().int().default(0).describe("標準税率対象の課税仕入高（税抜・円）"),
  reducedRatePurchases: z.number().int().default(0).describe("軽減税率対象の課税仕入高（税抜・円）"),

  // Invoice transition (non-qualified invoice purchases)
  nonQualifiedPurchasesStandard: z.number().int().default(0).describe("適格請求書なし仕入（標準税率・税抜・円）"),
  nonQualifiedPurchasesReduced: z.number().int().default(0).describe("適格請求書なし仕入（軽減税率・税抜・円）"),

  // Deduction method
  deductionMethod: z.enum(["full", "individual", "proportional"])
    .default("full")
    .describe("仕入税額控除の方法: full=全額控除, individual=個別対応, proportional=一括比例配分"),

  // For individual method
  directlyAttributableTax: z.number().int().default(0).describe("個別対応方式：課税売上にのみ対応する課税仕入の税額"),
  commonTax: z.number().int().default(0).describe("個別対応方式：共通対応の課税仕入の税額"),
});

const handler = async (args: any) => {
  try {
    const p = args.params;
    const db = getDb();

    const fy = db.prepare("SELECT * FROM fiscal_years WHERE id = ?").get(p.fiscalYearId) as any;
    if (!fy) return errorResult(`事業年度 ${p.fiscalYearId} が見つかりません。`);

    // Load consumption tax rates
    const ratesPath = resolve(__dirname, "../../data/tax-rates/consumption-tax.json");
    const rates = JSON.parse(readFileSync(ratesPath, "utf-8"));

    // === Output tax (sales tax) ===
    const outputTaxStandard = Math.floor(p.standardRateSales * rates.standardTaxPortion);
    const outputTaxReduced = Math.floor(p.reducedRateSales * rates.reducedTaxPortion);
    const outputTaxLocal = Math.floor(p.standardRateSales * rates.standardLocalPortion)
      + Math.floor(p.reducedRateSales * rates.reducedLocalPortion);
    const totalOutputTax = outputTaxStandard + outputTaxReduced;

    // === Input tax (purchase tax) ===
    const inputTaxStandard = Math.floor(p.standardRatePurchases * rates.standardTaxPortion);
    const inputTaxReduced = Math.floor(p.reducedRatePurchases * rates.reducedTaxPortion);

    // Invoice transition: determine deduction rate for non-qualified invoices
    const fyEndDate = fy.end_date;
    let invoiceDeductionRate = 0;
    for (const period of rates.invoiceTransition) {
      if (fyEndDate >= period.periodFrom && fyEndDate <= period.periodTo) {
        invoiceDeductionRate = period.deductionRate;
        break;
      }
    }

    const nonQualifiedTaxStandard = Math.floor(
      Math.floor(p.nonQualifiedPurchasesStandard * rates.standardTaxPortion) * invoiceDeductionRate
    );
    const nonQualifiedTaxReduced = Math.floor(
      Math.floor(p.nonQualifiedPurchasesReduced * rates.reducedTaxPortion) * invoiceDeductionRate
    );

    const totalInputTax = inputTaxStandard + inputTaxReduced + nonQualifiedTaxStandard + nonQualifiedTaxReduced;

    // === Taxable sales ratio ===
    const totalTaxableSales = p.standardRateSales + p.reducedRateSales + p.exemptSales;
    const totalSales = totalTaxableSales + p.nonTaxableSales;
    const taxableSalesRatio = totalSales > 0 ? totalTaxableSales / totalSales : 0;

    // === Deductible input tax ===
    let deductibleInputTax: number;
    let deductionDetail: any;

    if (taxableSalesRatio >= 0.95 && totalTaxableSales <= 500000000) {
      // Full deduction: taxable sales ratio >= 95% and taxable sales <= 5億円
      deductibleInputTax = totalInputTax;
      deductionDetail = {
        method: "full",
        reason: "課税売上割合95%以上かつ課税売上高5億円以下",
      };
    } else if (p.deductionMethod === "individual") {
      // Individual attribution method
      const commonDeductible = Math.floor(p.commonTax * taxableSalesRatio);
      deductibleInputTax = p.directlyAttributableTax + commonDeductible;
      deductionDetail = {
        method: "individual",
        directlyAttributable: p.directlyAttributableTax,
        commonTax: p.commonTax,
        commonDeductible,
      };
    } else {
      // Proportional method
      deductibleInputTax = Math.floor(totalInputTax * taxableSalesRatio);
      deductionDetail = {
        method: "proportional",
        totalInputTax,
        taxableSalesRatio: Math.round(taxableSalesRatio * 10000) / 100,
      };
    }

    // === Tax payable ===
    const nationalTaxPayable = Math.max(0, Math.floor((totalOutputTax - deductibleInputTax) / 100) * 100);
    const localTaxPayable = Math.max(0, Math.floor((outputTaxLocal - Math.floor(deductibleInputTax * rates.standardLocalPortion / rates.standardTaxPortion)) / 100) * 100);

    // Simplified local tax calculation: national × 22/78
    const localTaxByRatio = Math.floor(nationalTaxPayable * 22 / 78);

    const result = {
      sales: {
        standardRateSales: p.standardRateSales,
        reducedRateSales: p.reducedRateSales,
        exemptSales: p.exemptSales,
        nonTaxableSales: p.nonTaxableSales,
        totalTaxableSales,
        taxableSalesRatio: Math.round(taxableSalesRatio * 10000) / 100,
      },
      outputTax: {
        standard: outputTaxStandard,
        reduced: outputTaxReduced,
        total: totalOutputTax,
        localPortion: outputTaxLocal,
      },
      inputTax: {
        standard: inputTaxStandard,
        reduced: inputTaxReduced,
        nonQualifiedStandard: nonQualifiedTaxStandard,
        nonQualifiedReduced: nonQualifiedTaxReduced,
        invoiceDeductionRate,
        total: totalInputTax,
      },
      deduction: {
        ...deductionDetail,
        deductibleInputTax,
      },
      taxPayable: {
        national: nationalTaxPayable,
        local: localTaxByRatio,
        total: nationalTaxPayable + localTaxByRatio,
      },
    };

    // Save
    const now = new Date().toISOString();
    const existing = db.prepare(
      "SELECT version FROM schedule_results WHERE fiscal_year_id = ? AND schedule_number = 'consumption-general' ORDER BY version DESC LIMIT 1"
    ).get(p.fiscalYearId) as any;
    const version = existing ? existing.version + 1 : 1;

    db.prepare(`
      INSERT INTO schedule_results (fiscal_year_id, schedule_number, version, input_data, result_data, is_valid, calculated_at)
      VALUES (?, 'consumption-general', ?, ?, ?, 1, ?)
    `).run(p.fiscalYearId, version, JSON.stringify({
      standardRateSales: p.standardRateSales,
      reducedRateSales: p.reducedRateSales,
      deductionMethod: p.deductionMethod,
    }), JSON.stringify(result), now);

    return jsonResult("消費税申告書（一般課税）", result);
  } catch (error) {
    return errorResult(formatError(error));
  }
};

export const CalculateGeneralConsumptionTaxTool: ToolDefinition<typeof schema> = {
  name: "calculate-consumption-tax-general",
  description: "消費税（一般課税・原則課税）を計算します。課税売上に係る消費税額から仕入税額控除を差し引いて納付税額を算出。",
  schema,
  handler,
};
