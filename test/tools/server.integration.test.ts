import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createServer } from "../../src/server.js";
import { registerAllTools } from "../../src/tools/index.js";
import { getTestDb, setDb } from "../../src/db/client.js";
import type { DatabaseSync } from "node:sqlite";

/** Extract text content from tool result */
function getText(result: any): string {
  if (result.content && Array.isArray(result.content)) {
    return result.content.map((c: any) => c.text).join("\n");
  }
  return "";
}

/** Parse JSON from tool result (for jsonResult responses) */
function getJson(result: any): any {
  const text = getText(result);
  const jsonStart = text.indexOf("\n");
  if (jsonStart === -1) return null;
  return JSON.parse(text.slice(jsonStart + 1));
}

describe("MCP Server Integration", () => {
  let client: Client;
  let db: DatabaseSync;
  let clientTransport: InMemoryTransport;
  let serverTransport: InMemoryTransport;

  beforeEach(async () => {
    // Use in-memory DB for tests
    db = getTestDb();
    setDb(db);

    // Create MCP server
    const server = createServer();
    registerAllTools(server);

    // Create linked transport pair
    [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

    // Connect server and client
    await server.connect(serverTransport);

    client = new Client({ name: "test-client", version: "1.0.0" });
    await client.connect(clientTransport);
  });

  afterEach(async () => {
    await clientTransport.close();
    db.close();
  });

  // ------------------------------------------------------------------
  // Tool discovery
  // ------------------------------------------------------------------

  it("lists all registered tools", async () => {
    const { tools } = await client.listTools();
    const names = tools.map((t) => t.name);

    // Core tools from each category
    expect(names).toContain("set-company-info");
    expect(names).toContain("init-fiscal-year");
    expect(names).toContain("add-adjustment");
    expect(names).toContain("calculate-schedule-04");
    expect(names).toContain("calculate-all-schedules");
    expect(names).toContain("validate-schedules");
    expect(names).toContain("export-etax-xml");
    expect(names).toContain("get-filing-status");

    // Verify tool count (check for unexpected additions)
    expect(tools.length).toBeGreaterThanOrEqual(30);
  });

  // ------------------------------------------------------------------
  // Setup flow: company → fiscal year
  // ------------------------------------------------------------------

  it("sets up company info", async () => {
    const result = await client.callTool({
      name: "set-company-info",
      arguments: {
        params: {
          companyId: "1356167",
          name: "株式会社テスト",
          fiscalYearStartMonth: 4,
          capitalAmount: 10000000,
          address: "東京都千代田区",
        },
      },
    });

    const text = getText(result);
    expect(text).toContain("会社情報を設定しました");
    expect(text).toContain("株式会社テスト");
    expect(result.isError).toBeFalsy();
  });

  it("initializes fiscal year", async () => {
    await client.callTool({
      name: "set-company-info",
      arguments: {
        params: {
          companyId: "1356167",
          name: "株式会社テスト",
          fiscalYearStartMonth: 4,
        },
      },
    });

    const result = await client.callTool({
      name: "init-fiscal-year",
      arguments: {
        params: {
          fiscalYearId: "2025",
          companyId: "1356167",
          startDate: "2025-04-01",
          endDate: "2026-03-31",
        },
      },
    });

    const text = getText(result);
    expect(text).toContain("事業年度を作成しました");
    expect(result.isError).toBeFalsy();
  });

  it("returns error for non-existent company", async () => {
    const result = await client.callTool({
      name: "init-fiscal-year",
      arguments: {
        params: {
          fiscalYearId: "2025",
          companyId: "nonexistent",
          startDate: "2025-04-01",
          endDate: "2026-03-31",
        },
      },
    });

    expect(result.isError).toBe(true);
    expect(getText(result)).toContain("見つかりません");
  });

  // ------------------------------------------------------------------
  // Tax adjustment CRUD
  // ------------------------------------------------------------------

  describe("tax adjustment workflow", () => {
    beforeEach(async () => {
      await client.callTool({
        name: "set-company-info",
        arguments: {
          params: {
            companyId: "1356167",
            name: "株式会社テスト",
            fiscalYearStartMonth: 4,
            capitalAmount: 10000000,
          },
        },
      });
      await client.callTool({
        name: "init-fiscal-year",
        arguments: {
          params: {
            fiscalYearId: "2025",
            companyId: "1356167",
            startDate: "2025-04-01",
            endDate: "2026-03-31",
          },
        },
      });
    });

    it("adds, lists, confirms, and deletes adjustments", async () => {
      // Add
      const addResult = await client.callTool({
        name: "add-adjustment",
        arguments: {
          params: {
            fiscalYearId: "2025",
            adjustmentType: "addition",
            category: "retained",
            itemName: "交際費等の損金不算入額",
            amount: 500000,
            description: "交際費限度超過額",
          },
        },
      });
      expect(addResult.isError).toBeFalsy();
      expect(getText(addResult)).toContain("交際費等の損金不算入額");

      // List
      const listResult = await client.callTool({
        name: "list-adjustments",
        arguments: { params: { fiscalYearId: "2025" } },
      });
      expect(getText(listResult)).toContain("交際費等の損金不算入額");

      // Confirm (takes array of ids)
      const confirmResult = await client.callTool({
        name: "confirm-adjustment",
        arguments: { params: { ids: [1] } },
      });
      expect(confirmResult.isError).toBeFalsy();
      expect(getText(confirmResult)).toContain("確認済み");

      // Delete
      const deleteResult = await client.callTool({
        name: "delete-adjustment",
        arguments: { params: { id: 1 } },
      });
      expect(deleteResult.isError).toBeFalsy();
    });
  });

  // ------------------------------------------------------------------
  // Schedule calculation E2E
  // ------------------------------------------------------------------

  describe("end-to-end schedule calculation", () => {
    beforeEach(async () => {
      await client.callTool({
        name: "set-company-info",
        arguments: {
          params: {
            companyId: "1356167",
            name: "株式会社テスト",
            fiscalYearStartMonth: 4,
            capitalAmount: 10000000,
          },
        },
      });
      await client.callTool({
        name: "init-fiscal-year",
        arguments: {
          params: {
            fiscalYearId: "2025",
            companyId: "1356167",
            startDate: "2025-04-01",
            endDate: "2026-03-31",
          },
        },
      });

      // Add a tax adjustment
      const addResult = await client.callTool({
        name: "add-adjustment",
        arguments: {
          params: {
            fiscalYearId: "2025",
            adjustmentType: "addition",
            category: "retained",
            itemName: "交際費等の損金不算入額",
            amount: 2000000,
          },
        },
      });

      // Confirm the adjustment (required for schedule 04 to pick it up)
      const addText = getText(addResult);
      const idMatch = addText.match(/"id":\s*(\d+)/);
      if (idMatch) {
        await client.callTool({
          name: "confirm-adjustment",
          arguments: {
            params: {
              ids: [parseInt(idMatch[1])],
            },
          },
        });
      }
    });

    it("calculates schedule 04 (所得計算)", async () => {
      const result = await client.callTool({
        name: "calculate-schedule-04",
        arguments: {
          params: {
            fiscalYearId: "2025",
            netIncome: 8000000,
          },
        },
      });

      expect(result.isError).toBeFalsy();
      const text = getText(result);
      expect(text).toContain("10000000"); // 8M + 2M adjustment
    });

    it("calculates schedule 01 after 04 (法人税)", async () => {
      // First calculate schedule 04
      await client.callTool({
        name: "calculate-schedule-04",
        arguments: {
          params: {
            fiscalYearId: "2025",
            netIncome: 8000000,
          },
        },
      });

      // Then calculate schedule 01
      const result = await client.callTool({
        name: "calculate-schedule-01",
        arguments: {
          params: {
            fiscalYearId: "2025",
          },
        },
      });

      expect(result.isError).toBeFalsy();
      const text = getText(result);
      expect(text).toContain("法人税");
    });

    it("validates schedules after full calculation", async () => {
      // Calculate 04
      await client.callTool({
        name: "calculate-schedule-04",
        arguments: {
          params: { fiscalYearId: "2025", netIncome: 8000000 },
        },
      });

      // Calculate 01
      await client.callTool({
        name: "calculate-schedule-01",
        arguments: { params: { fiscalYearId: "2025" } },
      });

      // Calculate 05-2
      await client.callTool({
        name: "calculate-schedule-05-2",
        arguments: { params: { fiscalYearId: "2025" } },
      });

      // Calculate 05-1
      await client.callTool({
        name: "calculate-schedule-05-1",
        arguments: { params: { fiscalYearId: "2025" } },
      });

      // Validate
      const result = await client.callTool({
        name: "validate-schedules",
        arguments: { params: { fiscalYearId: "2025" } },
      });

      expect(result.isError).toBeFalsy();
      const text = getText(result);
      expect(text).toContain("整合性チェック結果");

      const data = getJson(result);
      expect(data.overallPassed).toBe(true);
    });
  });

  // ------------------------------------------------------------------
  // Filing status
  // ------------------------------------------------------------------

  it("returns filing status", async () => {
    await client.callTool({
      name: "set-company-info",
      arguments: {
        params: {
          companyId: "1356167",
          name: "テスト",
          fiscalYearStartMonth: 4,
        },
      },
    });
    await client.callTool({
      name: "init-fiscal-year",
      arguments: {
        params: {
          fiscalYearId: "2025",
          companyId: "1356167",
          startDate: "2025-04-01",
          endDate: "2026-03-31",
        },
      },
    });

    const result = await client.callTool({
      name: "get-filing-status",
      arguments: { params: { fiscalYearId: "2025" } },
    });

    expect(result.isError).toBeFalsy();
    expect(getText(result)).toContain("申告進捗状況");
  });

  // ------------------------------------------------------------------
  // Tax rates
  // ------------------------------------------------------------------

  it("returns tax rates", async () => {
    const result = await client.callTool({
      name: "get-tax-rates",
      arguments: { params: { fiscalYear: "2025" } },
    });

    expect(result.isError).toBeFalsy();
    const text = getText(result);
    expect(text).toContain("税率");
  });

  // ------------------------------------------------------------------
  // Local tax tools (require schedule 01 result in DB)
  // ------------------------------------------------------------------

  describe("local tax calculation", () => {
    beforeEach(async () => {
      await client.callTool({
        name: "set-company-info",
        arguments: {
          params: {
            companyId: "1356167",
            name: "テスト",
            fiscalYearStartMonth: 4,
            capitalAmount: 10000000,
          },
        },
      });
      await client.callTool({
        name: "init-fiscal-year",
        arguments: {
          params: {
            fiscalYearId: "2025",
            companyId: "1356167",
            startDate: "2025-04-01",
            endDate: "2026-03-31",
          },
        },
      });

      // Need schedule 04 → 01 for resident/enterprise tax
      await client.callTool({
        name: "add-adjustment",
        arguments: {
          params: {
            fiscalYearId: "2025",
            adjustmentType: "addition",
            category: "retained",
            itemName: "交際費",
            amount: 2000000,
          },
        },
      });
      await client.callTool({
        name: "calculate-schedule-04",
        arguments: { params: { fiscalYearId: "2025", netIncome: 8000000 } },
      });
      await client.callTool({
        name: "calculate-schedule-01",
        arguments: { params: { fiscalYearId: "2025" } },
      });
    });

    it("calculates resident tax", async () => {
      const result = await client.callTool({
        name: "calculate-resident-tax",
        arguments: {
          params: {
            fiscalYearId: "2025",
            employeeCount: 5,
          },
        },
      });

      expect(result.isError).toBeFalsy();
      expect(getText(result)).toContain("住民税");
    });

    it("calculates enterprise tax", async () => {
      const result = await client.callTool({
        name: "calculate-enterprise-tax",
        arguments: {
          params: {
            fiscalYearId: "2025",
          },
        },
      });

      expect(result.isError).toBeFalsy();
      expect(getText(result)).toContain("事業税");
    });
  });

  // ------------------------------------------------------------------
  // Consumption tax
  // ------------------------------------------------------------------

  describe("consumption tax", () => {
    beforeEach(async () => {
      await client.callTool({
        name: "set-company-info",
        arguments: {
          params: {
            companyId: "1356167",
            name: "テスト",
            fiscalYearStartMonth: 4,
          },
        },
      });
      await client.callTool({
        name: "init-fiscal-year",
        arguments: {
          params: {
            fiscalYearId: "2025",
            companyId: "1356167",
            startDate: "2025-04-01",
            endDate: "2026-03-31",
          },
        },
      });
    });

    it("calculates simplified consumption tax", async () => {
      const result = await client.callTool({
        name: "calculate-consumption-tax-simplified",
        arguments: {
          params: {
            fiscalYearId: "2025",
            salesByType: [
              { type: "2", standardRateSales: 30000000, reducedRateSales: 0 },
              { type: "5", standardRateSales: 20000000, reducedRateSales: 0 },
            ],
          },
        },
      });

      expect(result.isError).toBeFalsy();
      expect(getText(result)).toContain("消費税");
    });
  });
});
