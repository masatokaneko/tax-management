import { describe, it, expect } from "vitest";
import { getTestDb } from "../../src/db/client.js";

describe("database", () => {
  it("creates all tables", () => {
    const db = getTestDb();

    const tables = db.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name"
    ).all() as any[];

    const tableNames = tables.map(t => t.name);
    expect(tableNames).toContain("companies");
    expect(tableNames).toContain("fiscal_years");
    expect(tableNames).toContain("tax_adjustments");
    expect(tableNames).toContain("schedule_results");
    expect(tableNames).toContain("prior_year_data");
    expect(tableNames).toContain("filing_history");
    expect(tableNames).toContain("audit_log");

    db.close();
  });

  it("enforces foreign key constraints", () => {
    const db = getTestDb();

    // Trying to insert a fiscal year with non-existent company should fail
    expect(() => {
      db.prepare(
        "INSERT INTO fiscal_years (id, company_id, start_date, end_date, status, created_at, updated_at) VALUES ('2025', 'nonexistent', '2025-04-01', '2026-03-31', 'draft', datetime('now'), datetime('now'))"
      ).run();
    }).toThrow();

    db.close();
  });

  it("enforces check constraints on adjustment types", () => {
    const db = getTestDb();

    // Create company and fiscal year first
    db.prepare("INSERT INTO companies (id, name, fiscal_year_start_month, created_at, updated_at) VALUES ('1', 'Test', 4, datetime('now'), datetime('now'))").run();
    db.prepare("INSERT INTO fiscal_years (id, company_id, start_date, end_date, created_at, updated_at) VALUES ('2025', '1', '2025-04-01', '2026-03-31', datetime('now'), datetime('now'))").run();

    // Invalid adjustment_type should fail
    expect(() => {
      db.prepare(
        "INSERT INTO tax_adjustments (fiscal_year_id, adjustment_type, category, item_name, amount, created_at, updated_at) VALUES ('2025', 'invalid', 'retained', 'test', 100, datetime('now'), datetime('now'))"
      ).run();
    }).toThrow();

    // Valid insert should work
    expect(() => {
      db.prepare(
        "INSERT INTO tax_adjustments (fiscal_year_id, adjustment_type, category, item_name, amount, created_at, updated_at) VALUES ('2025', 'addition', 'retained', 'test', 100, datetime('now'), datetime('now'))"
      ).run();
    }).not.toThrow();

    db.close();
  });
});
