import { z } from "zod";
import type { ToolDefinition } from "../../types/tool-definition.js";
import { getCorporateTaxRates, getAvailableFiscalYears } from "../../services/tax-rates.service.js";
import { errorResult, jsonResult, formatError } from "../../helpers/format-error.js";

const schema = z.object({
  fiscalYear: z.string().describe("事業年度（例: '2025'）"),
});

const handler = async (args: any) => {
  try {
    const { fiscalYear } = args.params;
    const available = getAvailableFiscalYears();

    // getCorporateTaxRates has fallback logic, so we always try it
    const rates = getCorporateTaxRates(fiscalYear);
    const isExactMatch = available.includes(fiscalYear);
    const note = isExactMatch
      ? ""
      : `\n※ ${fiscalYear}年度の税率テーブルがないため、${rates.fiscalYear}年度の税率を適用しています。`;

    return jsonResult(`${fiscalYear}年度の法人税率テーブル${note}`, {
      ...rates,
      availableFiscalYears: available,
    });
  } catch (error) {
    return errorResult(formatError(error));
  }
};

export const GetTaxRatesTool: ToolDefinition<typeof schema> = {
  name: "get-tax-rates",
  description: "指定事業年度の法人税率テーブルを表示します。",
  schema,
  handler,
};
