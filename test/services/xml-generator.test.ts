import { describe, it, expect } from "vitest";
import {
  generateEtaxXml,
  generateEltaxXml,
  generateFinancialXbrl,
  extractFormData,
} from "../../src/services/xml-generator.service.js";

describe("xml-generator - e-Tax XML", () => {
  it("generates valid XML structure", () => {
    const xml = generateEtaxXml({
      taxOfficeCode: "01101",
      taxOfficeName: "麹町税務署",
      corporateNumber: "1234567890123",
      companyName: "株式会社テスト",
      representativeName: "山田太郎",
      fiscalYearStart: "2025-04-01",
      fiscalYearEnd: "2026-03-31",
      filingDate: "2026-05-31",
      forms: [
        {
          formId: "HOA200",
          formName: "別表一",
          fields: [
            { code: "KHO001", name: "所得金額", value: 10000000 },
            { code: "KHO010", name: "法人税額", value: 2320000 },
          ],
        },
      ],
    });

    expect(xml).toContain('<?xml version="1.0" encoding="UTF-8"?>');
    expect(xml).toContain("<申告書等送信データ");
    expect(xml).toContain("<税目>法人税</税目>");
    expect(xml).toContain("<法人番号>1234567890123</法人番号>");
    expect(xml).toContain("<法人名>株式会社テスト</法人名>");
    expect(xml).toContain("<帳票ID>HOA200</帳票ID>");
    expect(xml).toContain('コード="KHO001"');
    expect(xml).toContain(">10000000<");
    expect(xml).toContain("</申告書等送信データ>");
  });

  it("formats dates as Reiwa era", () => {
    const xml = generateEtaxXml({
      taxOfficeCode: "01101",
      taxOfficeName: "テスト",
      corporateNumber: "1234567890123",
      companyName: "テスト",
      representativeName: "テスト",
      fiscalYearStart: "2025-04-01",
      fiscalYearEnd: "2026-03-31",
      filingDate: "2026-05-31",
      forms: [],
    });

    expect(xml).toContain("令和7年4月1日");  // 2025 - 2018 = 7
    expect(xml).toContain("令和8年3月31日"); // 2026 - 2018 = 8
  });

  it("escapes XML special characters", () => {
    const xml = generateEtaxXml({
      taxOfficeCode: "01101",
      taxOfficeName: "テスト",
      corporateNumber: "1234567890123",
      companyName: "A&B<Corp>",
      representativeName: 'John "Test"',
      fiscalYearStart: "2025-04-01",
      fiscalYearEnd: "2026-03-31",
      filingDate: "2026-05-31",
      forms: [],
    });

    expect(xml).toContain("A&amp;B&lt;Corp&gt;");
    expect(xml).toContain("John &quot;Test&quot;");
  });
});

describe("xml-generator - eLTAX XML", () => {
  it("generates resident tax section", () => {
    const xml = generateEltaxXml({
      municipalityCode: "13100",
      municipalityName: "東京都（特別区）",
      corporateNumber: "1234567890123",
      companyName: "テスト株式会社",
      representativeName: "テスト太郎",
      fiscalYearStart: "2025-04-01",
      fiscalYearEnd: "2026-03-31",
      filingDate: "2026-05-31",
      residentTax: {
        prefecturalTaxOnIncome: 17700,
        prefecturalPerCapita: 20000,
        municipalTaxOnIncome: 59500,
        municipalPerCapita: 50000,
        totalResidentTax: 147200,
      },
    });

    expect(xml).toContain("<法人住民税>");
    expect(xml).toContain("<道府県民税法人税割額>17700</道府県民税法人税割額>");
    expect(xml).toContain("<市町村民税均等割額>50000</市町村民税均等割額>");
    expect(xml).toContain("<法人住民税合計>147200</法人住民税合計>");
  });

  it("generates enterprise tax section", () => {
    const xml = generateEltaxXml({
      municipalityCode: "13100",
      municipalityName: "東京都",
      corporateNumber: "1234567890123",
      companyName: "テスト",
      representativeName: "テスト",
      fiscalYearStart: "2025-04-01",
      fiscalYearEnd: "2026-03-31",
      filingDate: "2026-05-31",
      enterpriseTax: {
        taxableIncome: 10000000,
        brackets: [
          { taxableAmount: 4000000, rate: 0.0348, tax: 139200 },
          { taxableAmount: 4000000, rate: 0.0521, tax: 208400 },
          { taxableAmount: 2000000, rate: 0.0695, tax: 139000 },
        ],
        totalEnterpriseTax: 486600,
      },
    });

    expect(xml).toContain("<法人事業税>");
    expect(xml).toContain("<課税所得>10000000</課税所得>");
    expect(xml).toContain('<段階 番号="1">');
    expect(xml).toContain("<法人事業税額>486600</法人事業税額>");
  });
});

describe("xml-generator - XBRL", () => {
  it("generates valid XBRL structure", () => {
    const xbrl = generateFinancialXbrl({
      companyName: "テスト株式会社",
      fiscalYearEnd: "2026-03-31",
      bs: {
        CashAndDeposits: 5000000,
        AccountsReceivableTrade: 3000000,
      },
      pl: {
        NetSales: 50000000,
        CostOfSales: 30000000,
      },
    });

    expect(xbrl).toContain("<xbrli:xbrl");
    expect(xbrl).toContain("xmlns:jppfs_cor");
    expect(xbrl).toContain("<xbrli:instant>2026-03-31</xbrli:instant>");
    expect(xbrl).toContain("iso4217:JPY");
    expect(xbrl).toContain("<jppfs_cor:CashAndDeposits");
    expect(xbrl).toContain(">5000000<");
    expect(xbrl).toContain("<jppfs_cor:NetSales");
    expect(xbrl).toContain(">50000000<");
  });
});

describe("extractFormData", () => {
  it("extracts matching fields from result data", () => {
    const resultData = {
      taxableIncome: 10000000,
      corporateTaxAmount: 2320000,
      localCorporateTax: 238960,
    };
    const formDef = {
      formId: "HOA200",
      formName: "別表一",
      fields: {
        taxableIncome: { code: "KHO001", name: "所得金額", row: 1 },
        corporateTaxAmount: { code: "KHO010", name: "法人税額", row: 10 },
        missingField: { code: "KHO099", name: "存在しないフィールド", row: 99 },
      },
    };

    const result = extractFormData("01", resultData, formDef);
    expect(result.formId).toBe("HOA200");
    expect(result.fields).toHaveLength(2);
    expect(result.fields[0].code).toBe("KHO001");
    expect(result.fields[0].value).toBe(10000000);
  });

  it("looks in summary sub-object", () => {
    const resultData = {
      summary: {
        totalDonations: 500000,
        totalNonDeductible: 200000,
      },
    };
    const formDef = {
      formId: "HOA230",
      formName: "別表十四",
      fields: {
        totalDonations: { code: "KKF001", name: "寄付金合計", row: 1 },
        totalNonDeductible: { code: "KKF010", name: "損金不算入額", row: 10 },
      },
    };

    const result = extractFormData("14", resultData, formDef);
    expect(result.fields).toHaveLength(2);
    expect(result.fields[1].value).toBe(200000);
  });
});
