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
  employeeCount: z.number().int().describe("従業員数"),
  fiscalYearMonths: z.number().int().default(12).describe("事業年度の月数"),
});

const handler = async (args: any) => {
  try {
    const { fiscalYearId, employeeCount, fiscalYearMonths } = args.params;
    const db = getDb();

    const fy = db.prepare("SELECT * FROM fiscal_years WHERE id = ?").get(fiscalYearId) as any;
    if (!fy) return errorResult(`事業年度 ${fiscalYearId} が見つかりません。`);

    const company = db.prepare("SELECT * FROM companies WHERE id = ?").get(fy.company_id) as any;
    if (!company) return errorResult(`会社情報が見つかりません。`);
    if (!company.capital_amount) return errorResult(`資本金が設定されていません。`);

    // Get corporate tax amount from schedule 01
    const schedule01 = db.prepare(
      "SELECT result_data FROM schedule_results WHERE fiscal_year_id = ? AND schedule_number = '01' ORDER BY version DESC LIMIT 1"
    ).get(fiscalYearId) as any;
    if (!schedule01) return errorResult(`別表一が計算されていません。先に calculate-schedule-01 を実行してください。`);

    const schedule01Data = JSON.parse(schedule01.result_data);
    const corporateTaxAmount = schedule01Data.corporateTaxAmount ?? 0;

    // Load Tokyo tax rates
    const tokyoRatesPath = resolve(__dirname, "../../data/master/tokyo-tax-rates.json");
    const tokyoRates = JSON.parse(readFileSync(tokyoRatesPath, "utf-8"));

    // === 法人税割（道府県民税） ===
    const prefecturalTaxRate = tokyoRates.residentTax.prefectural.taxRate.tokyoRate;
    const prefecturalTaxOnIncome = Math.floor(corporateTaxAmount * prefecturalTaxRate / 100) * 100;

    // === 法人税割（市町村民税）- 東京23区は都税のみ ===
    const municipalTaxRate = tokyoRates.residentTax.municipal.taxRate.tokyoRate;
    const municipalTaxOnIncome = Math.floor(corporateTaxAmount * municipalTaxRate / 100) * 100;

    // === 均等割（道府県民税） ===
    const prefecturalPerCapita = Math.floor(
      tokyoRates.residentTax.prefectural.perCapita * fiscalYearMonths / 12
    );

    // === 均等割（市町村民税） ===
    const capitalBrackets = tokyoRates.residentTax.municipal.perCapita.capitalBrackets;
    let municipalPerCapitaAnnual = 0;
    for (const bracket of capitalBrackets) {
      if (bracket.capital === null || company.capital_amount <= bracket.capital) {
        municipalPerCapitaAnnual = employeeCount > 50
          ? bracket.employeesOver50
          : bracket.employees50orLess;
        break;
      }
    }
    const municipalPerCapita = Math.floor(municipalPerCapitaAnnual * fiscalYearMonths / 12);

    const totalPerCapita = prefecturalPerCapita + municipalPerCapita;
    const totalTaxOnIncome = prefecturalTaxOnIncome + municipalTaxOnIncome;
    const totalResidentTax = totalTaxOnIncome + totalPerCapita;

    const result = {
      corporateTaxAmount,
      capitalAmount: company.capital_amount,
      employeeCount,
      fiscalYearMonths,
      prefectural: {
        taxOnIncome: prefecturalTaxOnIncome,
        taxRate: prefecturalTaxRate,
        perCapita: prefecturalPerCapita,
        total: prefecturalTaxOnIncome + prefecturalPerCapita,
      },
      municipal: {
        taxOnIncome: municipalTaxOnIncome,
        taxRate: municipalTaxRate,
        perCapita: municipalPerCapita,
        perCapitaAnnual: municipalPerCapitaAnnual,
        total: municipalTaxOnIncome + municipalPerCapita,
      },
      summary: {
        totalTaxOnIncome,
        totalPerCapita,
        totalResidentTax,
      },
    };

    // Save
    const now = new Date().toISOString();
    const existing = db.prepare(
      "SELECT version FROM schedule_results WHERE fiscal_year_id = ? AND schedule_number = 'resident-tax' ORDER BY version DESC LIMIT 1"
    ).get(fiscalYearId) as any;
    const version = existing ? existing.version + 1 : 1;

    db.prepare(`
      INSERT INTO schedule_results (fiscal_year_id, schedule_number, version, input_data, result_data, is_valid, calculated_at)
      VALUES (?, 'resident-tax', ?, ?, ?, 1, ?)
    `).run(fiscalYearId, version, JSON.stringify({ employeeCount, fiscalYearMonths }), JSON.stringify(result), now);

    return jsonResult("法人住民税の計算", result);
  } catch (error) {
    return errorResult(formatError(error));
  }
};

export const CalculateResidentTaxTool: ToolDefinition<typeof schema> = {
  name: "calculate-resident-tax",
  description: "法人住民税（法人税割+均等割）を計算します。法人税額に住民税率を適用し、資本金・従業員数に基づく均等割を加算。",
  schema,
  handler,
};
