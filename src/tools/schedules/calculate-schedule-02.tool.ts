import { z } from "zod";
import type { ToolDefinition } from "../../types/tool-definition.js";
import { getDb } from "../../db/client.js";
import { errorResult, jsonResult, formatError } from "../../helpers/format-error.js";

const shareholderSchema = z.object({
  name: z.string().describe("株主名"),
  groupName: z.string().optional().describe("株主グループ名（同一グループに属する場合）"),
  shares: z.number().int().describe("保有株式数"),
  isRelatedPerson: z.boolean().default(false).describe("特殊関係者か否か"),
});

const schema = z.object({
  fiscalYearId: z.string().describe("事業年度ID"),
  totalShares: z.number().int().describe("発行済株式総数"),
  shareholders: z.array(shareholderSchema).describe("株主一覧"),
});

const handler = async (args: any) => {
  try {
    const { fiscalYearId, totalShares, shareholders } = args.params;
    const db = getDb();

    const fy = db.prepare("SELECT id FROM fiscal_years WHERE id = ?").get(fiscalYearId) as any;
    if (!fy) return errorResult(`事業年度 ${fiscalYearId} が見つかりません。`);

    // Save shareholders to DB
    db.prepare("DELETE FROM shareholders WHERE fiscal_year_id = ?").run(fiscalYearId);
    const now = new Date().toISOString();
    for (const sh of shareholders) {
      db.prepare(
        "INSERT INTO shareholders (fiscal_year_id, name, group_name, shares, is_related_person, created_at) VALUES (?, ?, ?, ?, ?, ?)"
      ).run(fiscalYearId, sh.name, sh.groupName ?? sh.name, sh.shares, sh.isRelatedPerson ? 1 : 0, now);
    }

    // Group shareholders by group name
    const groups = new Map<string, { members: string[]; totalShares: number }>();
    for (const sh of shareholders) {
      const gName = sh.groupName ?? sh.name;
      const existing = groups.get(gName);
      if (existing) {
        existing.members.push(sh.name);
        existing.totalShares += sh.shares;
      } else {
        groups.set(gName, { members: [sh.name], totalShares: sh.shares });
      }
    }

    // Sort groups by shares (descending)
    const sortedGroups = [...groups.entries()]
      .map(([name, data]) => ({
        groupName: name,
        members: data.members,
        shares: data.totalShares,
        ratio: data.totalShares / totalShares,
      }))
      .sort((a, b) => b.shares - a.shares);

    // Top 3 groups
    const top3 = sortedGroups.slice(0, 3);
    const top3ShareTotal = top3.reduce((sum, g) => sum + g.shares, 0);
    const top3Ratio = top3ShareTotal / totalShares;

    // Determination: 同族会社 = top 3 groups hold > 50%
    const isDozokuCompany = top3Ratio > 0.5;

    // 特定同族会社: 1 group holds > 50%
    const isSpecificDozoku = sortedGroups.length > 0 && sortedGroups[0].ratio > 0.5;

    const result = {
      totalShares,
      shareholderCount: shareholders.length,
      groupCount: groups.size,
      groups: sortedGroups,
      top3Groups: top3,
      top3ShareTotal,
      top3Ratio: Math.round(top3Ratio * 10000) / 100, // percentage with 2 decimal places
      isDozokuCompany,
      isSpecificDozoku,
      determination: isDozokuCompany ? "同族会社" : "非同族会社",
    };

    // Save
    const existing = db.prepare(
      "SELECT version FROM schedule_results WHERE fiscal_year_id = ? AND schedule_number = '02' ORDER BY version DESC LIMIT 1"
    ).get(fiscalYearId) as any;
    const version = existing ? existing.version + 1 : 1;

    db.prepare(`
      INSERT INTO schedule_results (fiscal_year_id, schedule_number, version, input_data, result_data, is_valid, calculated_at)
      VALUES (?, '02', ?, ?, ?, 1, ?)
    `).run(fiscalYearId, version, JSON.stringify({ totalShares, shareholderCount: shareholders.length }), JSON.stringify(result), now);

    return jsonResult("別表二（同族会社等の判定に関する明細書）", result);
  } catch (error) {
    return errorResult(formatError(error));
  }
};

export const CalculateSchedule02Tool: ToolDefinition<typeof schema> = {
  name: "calculate-schedule-02",
  description: "別表二（同族会社等の判定に関する明細書）を計算します。株主グループの持株比率から同族会社/非同族会社を判定。",
  schema,
  handler,
};
