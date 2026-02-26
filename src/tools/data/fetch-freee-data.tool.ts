import { z } from "zod";
import type { ToolDefinition } from "../../types/tool-definition.js";
import { getDb } from "../../db/client.js";
import { errorResult, jsonResult, formatError } from "../../helpers/format-error.js";

const schema = z.object({
  fiscalYearId: z.string().describe("事業年度ID"),
  dataType: z.enum(["trial_balance", "deals", "manual_journals", "accounts", "all"])
    .describe("取得データ種別: trial_balance=試算表, deals=取引データ, manual_journals=振替伝票, accounts=勘定科目マスタ, all=全て"),
  data: z.record(z.unknown()).describe("freee MCPから取得したデータ（JSON）"),
  netIncome: z.number().int().optional().describe("試算表から読み取った当期純利益（円・整数）。dataType=trial_balance時に指定推奨。"),
});

const handler = async (args: any) => {
  try {
    const { fiscalYearId, dataType, data, netIncome } = args.params;
    const db = getDb();

    const fy = db.prepare("SELECT * FROM fiscal_years WHERE id = ?").get(fiscalYearId) as any;
    if (!fy) return errorResult(`事業年度 ${fiscalYearId} が見つかりません。`);

    const now = new Date().toISOString();

    // Delete existing cache for this data type
    if (dataType === "all") {
      db.prepare("DELETE FROM freee_cache WHERE fiscal_year_id = ?").run(fiscalYearId);
    } else {
      db.prepare("DELETE FROM freee_cache WHERE fiscal_year_id = ? AND data_type = ?")
        .run(fiscalYearId, dataType);
    }

    // Normalize legacy key names to canonical freee API terms
    const KEY_ALIASES: Record<string, string> = {
      journals: "deals",
      manualJournals: "manual_journals",
    };

    // Store the data
    if (dataType === "all") {
      // Expect data to have keys: trial_balance, deals, manual_journals, accounts
      for (const [rawKey, value] of Object.entries(data)) {
        const key = KEY_ALIASES[rawKey] ?? rawKey;
        db.prepare("INSERT INTO freee_cache (fiscal_year_id, data_type, data_json, fetched_at) VALUES (?, ?, ?, ?)")
          .run(fiscalYearId, key, JSON.stringify(value), now);
      }
    } else {
      db.prepare("INSERT INTO freee_cache (fiscal_year_id, data_type, data_json, fetched_at) VALUES (?, ?, ?, ?)")
        .run(fiscalYearId, dataType, JSON.stringify(data), now);
    }

    // Update fiscal year status
    db.prepare("UPDATE fiscal_years SET status = 'data_fetched', updated_at = ? WHERE id = ? AND status = 'draft'")
      .run(now, fiscalYearId);

    // Audit log
    db.prepare("INSERT INTO audit_log (fiscal_year_id, action, target, detail, timestamp) VALUES (?, 'fetch', ?, ?, ?)")
      .run(fiscalYearId, `freee_${dataType}`, JSON.stringify({ netIncome }), now);

    // Return summary
    const cached = db.prepare("SELECT data_type, fetched_at FROM freee_cache WHERE fiscal_year_id = ?")
      .all(fiscalYearId);

    return jsonResult("freeeデータをキャッシュしました", {
      fiscalYearId,
      cachedDataTypes: cached,
      netIncome: netIncome ?? "未指定（試算表から手動で確認してください）",
      nextStep: "add-adjustment で税務調整項目を登録し、confirm-adjustment で確認してください。",
    });
  } catch (error) {
    return errorResult(formatError(error));
  }
};

export const FetchFreeeDataTool: ToolDefinition<typeof schema> = {
  name: "fetch-freee-data",
  description: "freee MCPから取得したBS/PL/仕訳データをSQLiteにキャッシュします。Claude Codeがfreee MCPで取得したデータをこのツールに渡してください。",
  schema,
  handler,
};
