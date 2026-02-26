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

    if (!available.includes(fiscalYear)) {
      return errorResult(`事業年度 ${fiscalYear} の税率テーブルが見つかりません。利用可能: ${available.join(", ")}`);
    }

    const rates = getCorporateTaxRates(fiscalYear);
    return jsonResult(`${fiscalYear}年度の法人税率テーブル`, rates);
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
