import { z } from "zod";
import type { ToolDefinition } from "../../types/tool-definition.js";
import { getDb } from "../../db/client.js";
import { errorResult, jsonResult, formatError } from "../../helpers/format-error.js";

const withheldTaxSchema = z.object({
  source: z.string().describe("源泉徴収された所得の種類（例: 預金利子、配当金、報酬等）"),
  payerName: z.string().describe("支払者名"),
  grossAmount: z.number().int().describe("収入金額（円）"),
  withheldTax: z.number().int().describe("源泉徴収税額（円）"),
});

const schema = z.object({
  fiscalYearId: z.string().describe("事業年度ID"),
  withheldTaxes: z.array(withheldTaxSchema).describe("源泉徴収された所得税の一覧"),
});

const handler = async (args: any) => {
  try {
    const { fiscalYearId, withheldTaxes } = args.params;
    const db = getDb();

    const fy = db.prepare("SELECT * FROM fiscal_years WHERE id = ?").get(fiscalYearId) as any;
    if (!fy) return errorResult(`事業年度 ${fiscalYearId} が見つかりません。`);

    // Get schedule 01 to check corporate tax amount (credit cannot exceed tax)
    const schedule01 = db.prepare(
      "SELECT result_data FROM schedule_results WHERE fiscal_year_id = ? AND schedule_number = '01' ORDER BY version DESC LIMIT 1"
    ).get(fiscalYearId) as any;

    let corporateTaxAmount = Infinity;
    if (schedule01) {
      const data = JSON.parse(schedule01.result_data);
      corporateTaxAmount = data.corporateTaxAmount ?? Infinity;
    }

    const details = withheldTaxes.map((item: any) => ({
      source: item.source,
      payerName: item.payerName,
      grossAmount: item.grossAmount,
      withheldTax: item.withheldTax,
    }));

    const totalWithheldTax = details.reduce((sum: number, d: any) => sum + d.withheldTax, 0);

    // Tax credit is limited to corporate tax amount
    const creditableAmount = Math.min(totalWithheldTax, corporateTaxAmount);
    const excessAmount = totalWithheldTax - creditableAmount; // Refundable excess

    const result = {
      details,
      totalGrossAmount: details.reduce((sum: number, d: any) => sum + d.grossAmount, 0),
      totalWithheldTax,
      corporateTaxLimit: corporateTaxAmount === Infinity ? null : corporateTaxAmount,
      creditableAmount,
      excessAmount,
    };

    // Save
    const now = new Date().toISOString();
    const existing = db.prepare(
      "SELECT version FROM schedule_results WHERE fiscal_year_id = ? AND schedule_number = '06' ORDER BY version DESC LIMIT 1"
    ).get(fiscalYearId) as any;
    const version = existing ? existing.version + 1 : 1;

    db.prepare(`
      INSERT INTO schedule_results (fiscal_year_id, schedule_number, version, input_data, result_data, is_valid, calculated_at)
      VALUES (?, '06', ?, ?, ?, 1, ?)
    `).run(fiscalYearId, version, JSON.stringify({ itemCount: withheldTaxes.length }), JSON.stringify(result), now);

    return jsonResult("別表六（所得税額の控除に関する明細書）", result);
  } catch (error) {
    return errorResult(formatError(error));
  }
};

export const CalculateSchedule06Tool: ToolDefinition<typeof schema> = {
  name: "calculate-schedule-06",
  description: "別表六（所得税額の控除に関する明細書）を計算します。源泉徴収された所得税額を法人税額から控除。",
  schema,
  handler,
};
