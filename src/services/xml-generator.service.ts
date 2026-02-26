/**
 * XML Generator Service for e-Tax (.xtx) and eLTAX XML output.
 *
 * NOTE: The XML structure follows the general e-Tax format.
 * Field codes (帳票ID, 項目コード) are placeholders.
 * Update src/data/etax/form-definitions.json with actual codes
 * from the official e-Tax XML構造設計書 (CAB download from
 * https://www.e-tax.nta.go.jp/shiyo/shiyo3.htm).
 */

// Simple XML builder (no dependencies)
function escapeXml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function xmlTag(name: string, value: string | number, attrs?: Record<string, string>): string {
  const attrStr = attrs
    ? " " + Object.entries(attrs).map(([k, v]) => `${k}="${escapeXml(v)}"`).join(" ")
    : "";
  return `    <${name}${attrStr}>${escapeXml(String(value))}</${name}>`;
}

interface FormField {
  code: string;
  name: string;
  value: string | number;
}

interface FormData {
  formId: string;
  formName: string;
  fields: FormField[];
}

interface EtaxXmlOptions {
  taxOfficeCode: string;    // 提出先税務署コード
  taxOfficeName: string;    // 提出先税務署名
  corporateNumber: string;  // 法人番号（13桁）
  companyName: string;
  representativeName: string;
  fiscalYearStart: string;  // YYYY-MM-DD
  fiscalYearEnd: string;
  filingDate: string;       // YYYY-MM-DD
  forms: FormData[];
}

export function generateEtaxXml(options: EtaxXmlOptions): string {
  const lines: string[] = [];

  lines.push(`<?xml version="1.0" encoding="UTF-8"?>`);
  lines.push(`<申告書等送信データ`);
  lines.push(`  xmlns="urn:e-tax:houjin:etax:1.0"`);
  lines.push(`  バージョン="1.0">`);
  lines.push(``);

  // Header section
  lines.push(`  <申告書等基本情報>`);
  lines.push(xmlTag("税目", "法人税"));
  lines.push(xmlTag("手続コード", "HOA"));
  lines.push(xmlTag("申告区分", "確定申告"));
  lines.push(xmlTag("提出先税務署コード", options.taxOfficeCode));
  lines.push(xmlTag("提出先税務署名", options.taxOfficeName));
  lines.push(xmlTag("法人番号", options.corporateNumber));
  lines.push(xmlTag("法人名", options.companyName));
  lines.push(xmlTag("代表者氏名", options.representativeName));
  lines.push(xmlTag("事業年度開始", formatDate(options.fiscalYearStart)));
  lines.push(xmlTag("事業年度終了", formatDate(options.fiscalYearEnd)));
  lines.push(xmlTag("申告年月日", formatDate(options.filingDate)));
  lines.push(`  </申告書等基本情報>`);
  lines.push(``);

  // Form data sections
  lines.push(`  <帳票一覧>`);
  for (const form of options.forms) {
    lines.push(`    <帳票>`);
    lines.push(`      <帳票ID>${escapeXml(form.formId)}</帳票ID>`);
    lines.push(`      <帳票名>${escapeXml(form.formName)}</帳票名>`);
    lines.push(`      <帳票データ>`);
    for (const field of form.fields) {
      lines.push(`        <項目 コード="${escapeXml(field.code)}" 名称="${escapeXml(field.name)}">${escapeXml(String(field.value))}</項目>`);
    }
    lines.push(`      </帳票データ>`);
    lines.push(`    </帳票>`);
  }
  lines.push(`  </帳票一覧>`);
  lines.push(``);
  lines.push(`</申告書等送信データ>`);

  return lines.join("\n");
}

interface EltaxXmlOptions {
  municipalityCode: string;  // 自治体コード
  municipalityName: string;
  corporateNumber: string;
  companyName: string;
  representativeName: string;
  fiscalYearStart: string;
  fiscalYearEnd: string;
  filingDate: string;
  residentTax?: {
    prefecturalTaxOnIncome: number;
    prefecturalPerCapita: number;
    municipalTaxOnIncome: number;
    municipalPerCapita: number;
    totalResidentTax: number;
  };
  enterpriseTax?: {
    taxableIncome: number;
    brackets: Array<{ taxableAmount: number; rate: number; tax: number }>;
    totalEnterpriseTax: number;
  };
  specialEnterpriseTax?: {
    baseAmount: number;
    rate: number;
    tax: number;
  };
}

export function generateEltaxXml(options: EltaxXmlOptions): string {
  const lines: string[] = [];

  lines.push(`<?xml version="1.0" encoding="UTF-8"?>`);
  lines.push(`<地方税申告データ`);
  lines.push(`  xmlns="urn:eltax:houjin:chihouzei:1.0"`);
  lines.push(`  バージョン="1.0">`);
  lines.push(``);

  // Header
  lines.push(`  <申告基本情報>`);
  lines.push(xmlTag("自治体コード", options.municipalityCode));
  lines.push(xmlTag("自治体名", options.municipalityName));
  lines.push(xmlTag("法人番号", options.corporateNumber));
  lines.push(xmlTag("法人名", options.companyName));
  lines.push(xmlTag("代表者氏名", options.representativeName));
  lines.push(xmlTag("事業年度開始", formatDate(options.fiscalYearStart)));
  lines.push(xmlTag("事業年度終了", formatDate(options.fiscalYearEnd)));
  lines.push(xmlTag("申告年月日", formatDate(options.filingDate)));
  lines.push(`  </申告基本情報>`);
  lines.push(``);

  // Resident tax
  if (options.residentTax) {
    const rt = options.residentTax;
    lines.push(`  <法人住民税>`);
    lines.push(`    <法人税割>`);
    lines.push(xmlTag("道府県民税法人税割額", rt.prefecturalTaxOnIncome));
    lines.push(xmlTag("市町村民税法人税割額", rt.municipalTaxOnIncome));
    lines.push(`    </法人税割>`);
    lines.push(`    <均等割>`);
    lines.push(xmlTag("道府県民税均等割額", rt.prefecturalPerCapita));
    lines.push(xmlTag("市町村民税均等割額", rt.municipalPerCapita));
    lines.push(`    </均等割>`);
    lines.push(xmlTag("法人住民税合計", rt.totalResidentTax));
    lines.push(`  </法人住民税>`);
    lines.push(``);
  }

  // Enterprise tax
  if (options.enterpriseTax) {
    const et = options.enterpriseTax;
    lines.push(`  <法人事業税>`);
    lines.push(xmlTag("課税所得", et.taxableIncome));
    lines.push(`    <税額計算>`);
    for (let i = 0; i < et.brackets.length; i++) {
      const b = et.brackets[i];
      lines.push(`      <段階 番号="${i + 1}">`);
      lines.push(`        <課税標準額>${b.taxableAmount}</課税標準額>`);
      lines.push(`        <税率>${b.rate}</税率>`);
      lines.push(`        <税額>${b.tax}</税額>`);
      lines.push(`      </段階>`);
    }
    lines.push(`    </税額計算>`);
    lines.push(xmlTag("法人事業税額", et.totalEnterpriseTax));
    lines.push(`  </法人事業税>`);
    lines.push(``);
  }

  // Special enterprise tax
  if (options.specialEnterpriseTax) {
    const set = options.specialEnterpriseTax;
    lines.push(`  <特別法人事業税>`);
    lines.push(xmlTag("基準法人事業税額", set.baseAmount));
    lines.push(xmlTag("税率", set.rate));
    lines.push(xmlTag("特別法人事業税額", set.tax));
    lines.push(`  </特別法人事業税>`);
    lines.push(``);
  }

  lines.push(`</地方税申告データ>`);

  return lines.join("\n");
}

// XBRL 2.1 for financial statements
interface XbrlOptions {
  companyName: string;
  fiscalYearEnd: string;
  bs: Record<string, number>; // Balance sheet items
  pl: Record<string, number>; // P&L items
}

export function generateFinancialXbrl(options: XbrlOptions): string {
  const lines: string[] = [];

  lines.push(`<?xml version="1.0" encoding="UTF-8"?>`);
  lines.push(`<xbrli:xbrl`);
  lines.push(`  xmlns:xbrli="http://www.xbrl.org/2003/instance"`);
  lines.push(`  xmlns:jppfs_cor="http://disclosure.edinet-fsa.go.jp/taxonomy/jppfs/2023-11-01/jppfs_cor"`);
  lines.push(`  xmlns:xlink="http://www.w3.org/1999/xlink"`);
  lines.push(`  xmlns:iso4217="http://www.xbrl.org/2003/iso4217">`);
  lines.push(``);

  // Context
  lines.push(`  <xbrli:context id="CurrentYearInstant">`);
  lines.push(`    <xbrli:entity>`);
  lines.push(`      <xbrli:identifier scheme="http://disclosure.edinet-fsa.go.jp">${escapeXml(options.companyName)}</xbrli:identifier>`);
  lines.push(`    </xbrli:entity>`);
  lines.push(`    <xbrli:period>`);
  lines.push(`      <xbrli:instant>${options.fiscalYearEnd}</xbrli:instant>`);
  lines.push(`    </xbrli:period>`);
  lines.push(`  </xbrli:context>`);
  lines.push(``);

  // Unit
  lines.push(`  <xbrli:unit id="JPY">`);
  lines.push(`    <xbrli:measure>iso4217:JPY</xbrli:measure>`);
  lines.push(`  </xbrli:unit>`);
  lines.push(``);

  // Balance Sheet
  lines.push(`  <!-- 貸借対照表 -->`);
  for (const [key, value] of Object.entries(options.bs)) {
    lines.push(`  <jppfs_cor:${escapeXml(key)} contextRef="CurrentYearInstant" unitRef="JPY" decimals="0">${value}</jppfs_cor:${escapeXml(key)}>`);
  }
  lines.push(``);

  // P&L
  lines.push(`  <!-- 損益計算書 -->`);
  for (const [key, value] of Object.entries(options.pl)) {
    lines.push(`  <jppfs_cor:${escapeXml(key)} contextRef="CurrentYearInstant" unitRef="JPY" decimals="0">${value}</jppfs_cor:${escapeXml(key)}>`);
  }
  lines.push(``);

  lines.push(`</xbrli:xbrl>`);

  return lines.join("\n");
}

function formatDate(date: string): string {
  // Convert YYYY-MM-DD to 令和X年M月D日 format
  const [y, m, d] = date.split("-").map(Number);
  const reiwaYear = y - 2018;
  return `令和${reiwaYear}年${m}月${d}日`;
}

// Extract form data from schedule results
export function extractFormData(
  scheduleNumber: string,
  resultData: any,
  formDef: any,
): FormData {
  const fields: FormField[] = [];
  const fieldDefs = formDef.fields;

  for (const [key, def] of Object.entries(fieldDefs) as [string, any][]) {
    // Try to find the value in the result data (support nested paths)
    let value = resultData[key];
    if (value === undefined && resultData.summary) {
      value = resultData.summary[key];
    }
    if (value !== undefined && value !== null) {
      fields.push({
        code: def.code,
        name: def.name,
        value: value,
      });
    }
  }

  return {
    formId: formDef.formId,
    formName: formDef.formName,
    fields,
  };
}
