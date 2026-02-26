import { z } from "zod";
import type { ToolDefinition } from "../../types/tool-definition.js";
import { getDb } from "../../db/client.js";
import { errorResult, formatError } from "../../helpers/format-error.js";

const schema = z.object({
  fiscalYearId: z.string().describe("事業年度ID"),
});

function fmt(n: number): string {
  return n.toLocaleString("ja-JP");
}

const handler = async (args: any) => {
  try {
    const { fiscalYearId } = args.params;
    const db = getDb();

    const fy = db.prepare("SELECT * FROM fiscal_years WHERE id = ?").get(fiscalYearId) as any;
    if (!fy) return errorResult(`事業年度 ${fiscalYearId} が見つかりません。`);

    const company = db.prepare("SELECT * FROM companies WHERE id = ?").get(fy.company_id) as any;

    // Load all schedule results
    const scheduleRows = db.prepare(
      "SELECT schedule_number, result_data FROM schedule_results WHERE fiscal_year_id = ? ORDER BY schedule_number, version DESC"
    ).all(fiscalYearId) as any[];

    const schedules: Record<string, any> = {};
    for (const row of scheduleRows) {
      if (!schedules[row.schedule_number]) {
        schedules[row.schedule_number] = JSON.parse(row.result_data);
      }
    }

    // Load adjustments
    const adjustments = db.prepare(
      "SELECT * FROM tax_adjustments WHERE fiscal_year_id = ? ORDER BY adjustment_type, item_name"
    ).all(fiscalYearId) as any[];

    // Build Markdown preview
    let md = `# 法人税申告書プレビュー\n\n`;
    md += `**会社名**: ${company?.name ?? "未設定"}\n`;
    md += `**事業年度**: ${fy.start_date} ～ ${fy.end_date}\n`;
    md += `**資本金**: ${company?.capital_amount ? fmt(company.capital_amount) + "円" : "未設定"}\n`;
    md += `**ステータス**: ${fy.status}\n\n`;
    md += `---\n\n`;

    // Schedule 04
    if (schedules["04"]) {
      const s = schedules["04"];
      md += `## 別表四 - 所得の金額の計算\n\n`;
      md += `| 項目 | 金額 |\n|------|-----:|\n`;
      md += `| 当期純利益 | ${fmt(s.netIncome)}円 |\n`;

      if (s.additions.length > 0) {
        md += `| **加算項目** | |\n`;
        for (const a of s.additions) {
          md += `| 　${a.itemName} (${a.category === "retained" ? "留保" : "社外流出"}) | ${fmt(a.amount)}円 |\n`;
        }
        md += `| 加算合計 | ${fmt(s.additionTotal)}円 |\n`;
      }

      if (s.deductions.length > 0) {
        md += `| **減算項目** | |\n`;
        for (const d of s.deductions) {
          md += `| 　${d.itemName} (${d.category === "retained" ? "留保" : "社外流出"}) | ${fmt(d.amount)}円 |\n`;
        }
        md += `| 減算合計 | ${fmt(s.deductionTotal)}円 |\n`;
      }

      md += `| **所得金額** | **${fmt(s.taxableIncome)}円** |\n\n`;
    }

    // Schedule 01
    if (schedules["01"]) {
      const s = schedules["01"];
      md += `## 別表一 - 法人税額の計算\n\n`;
      md += `| 項目 | 金額 |\n|------|-----:|\n`;
      md += `| 課税所得（千円未満切捨て） | ${fmt(s.taxableIncomeRounded)}円 |\n`;
      if (s.smeReducedPortion > 0) {
        md += `| 中小法人軽減税率部分 | ${fmt(s.smeReducedPortion)}円 |\n`;
        md += `| 標準税率部分 | ${fmt(s.smeStandardPortion)}円 |\n`;
      }
      md += `| 法人税額 | ${fmt(s.corporateTaxAmount)}円 |\n`;
      if (s.taxCreditsApplied > 0) {
        md += `| 税額控除 | -${fmt(s.taxCreditsApplied)}円 |\n`;
      }
      md += `| 法人税額（控除後） | ${fmt(s.corporateTaxAfterCredits)}円 |\n`;
      md += `| 地方法人税 | ${fmt(s.localCorporateTax)}円 |\n`;
      if (s.defenseSpecialTax > 0) {
        md += `| 防衛特別法人税 | ${fmt(s.defenseSpecialTax)}円 |\n`;
      }
      md += `| **国税合計** | **${fmt(s.totalNationalTax)}円** |\n`;
      if (s.interimTaxPaid > 0) {
        md += `| 中間納付額 | -${fmt(s.interimTaxPaid)}円 |\n`;
      }
      md += `| **差引納付額** | **${fmt(s.nationalTaxPayable)}円** |\n\n`;
    }

    // Schedule 05-2
    if (schedules["05-2"]) {
      const s = schedules["05-2"];
      md += `## 別表五(二) - 租税公課の納付状況\n\n`;
      md += `| 税目 | 前期確定 | 中間 | 当期確定 |\n|------|-------:|-----:|-------:|\n`;
      md += `| 法人税 | ${fmt(s.corporateTax.priorConfirmed)}円 | ${fmt(s.corporateTax.interim)}円 | ${fmt(s.corporateTax.currentConfirmed)}円 |\n`;
      md += `| 地方法人税 | ${fmt(s.localCorporateTax.priorConfirmed)}円 | ${fmt(s.localCorporateTax.interim)}円 | ${fmt(s.localCorporateTax.currentConfirmed)}円 |\n`;
      md += `| 住民税 | ${fmt(s.residentTax.priorConfirmed)}円 | ${fmt(s.residentTax.interim)}円 | ${fmt(s.residentTax.currentConfirmed)}円 |\n`;
      md += `| 事業税 | ${fmt(s.enterpriseTax.priorConfirmed)}円 | ${fmt(s.enterpriseTax.interim)}円 | ${fmt(s.enterpriseTax.currentConfirmed)}円 |\n\n`;
    }

    // Schedule 05-1
    if (schedules["05-1"]) {
      const s = schedules["05-1"];
      md += `## 別表五(一) - 利益積立金額\n\n`;
      md += `| 項目 | 金額 |\n|------|-----:|\n`;
      md += `| 期首残高 | ${fmt(s.beginningBalance)}円 |\n`;
      md += `| 当期増減 | ${fmt(s.changes.netChange)}円 |\n`;
      md += `| **期末残高** | **${fmt(s.endingBalance)}円** |\n\n`;
    }

    // Unconfirmed adjustments warning
    const unconfirmed = adjustments.filter((a: any) => !a.user_confirmed);
    if (unconfirmed.length > 0) {
      md += `---\n\n`;
      md += `> **注意**: 未確認の税務調整項目が ${unconfirmed.length} 件あります。\n`;
    }

    return {
      content: [{ type: "text" as const, text: md }],
    };
  } catch (error) {
    return errorResult(formatError(error));
  }
};

export const PreviewReturnTool: ToolDefinition<typeof schema> = {
  name: "preview-return",
  description: "申告書のプレビューをMarkdown形式で出力します。全別表の計算結果を一覧表示。",
  schema,
  handler,
};
