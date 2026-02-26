import { DatabaseSync } from "node:sqlite";
import { existsSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(__dirname, "..", "..");
const DB_PATH = resolve(PROJECT_ROOT, "data", "tax-filing.db");

let db: DatabaseSync | null = null;

export function getDb(): DatabaseSync {
  if (db) return db;

  // Ensure data directory exists
  const dataDir = dirname(DB_PATH);
  if (!existsSync(dataDir)) {
    mkdirSync(dataDir, { recursive: true });
  }

  db = new DatabaseSync(DB_PATH);

  // Enable WAL mode and foreign keys
  db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA foreign_keys = ON");

  // Run migrations
  initSchema(db);

  return db;
}

export function getTestDb(): DatabaseSync {
  const testDb = new DatabaseSync(":memory:");
  testDb.exec("PRAGMA foreign_keys = ON");
  initSchema(testDb);
  return testDb;
}

function initSchema(database: DatabaseSync): void {
  database.exec(`
    CREATE TABLE IF NOT EXISTS companies (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      fiscal_year_start_month INTEGER NOT NULL,
      capital_amount INTEGER,
      address TEXT,
      municipality_code TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS fiscal_years (
      id TEXT PRIMARY KEY,
      company_id TEXT NOT NULL REFERENCES companies(id),
      start_date TEXT NOT NULL,
      end_date TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'draft',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS tax_adjustments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      fiscal_year_id TEXT NOT NULL REFERENCES fiscal_years(id),
      adjustment_type TEXT NOT NULL CHECK (adjustment_type IN ('addition', 'deduction')),
      category TEXT NOT NULL CHECK (category IN ('retained', 'outflow')),
      item_name TEXT NOT NULL,
      schedule_ref TEXT,
      amount INTEGER NOT NULL,
      description TEXT,
      source_journal_ids TEXT,
      ai_estimated INTEGER NOT NULL DEFAULT 0,
      user_confirmed INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS schedule_results (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      fiscal_year_id TEXT NOT NULL REFERENCES fiscal_years(id),
      schedule_number TEXT NOT NULL,
      version INTEGER NOT NULL DEFAULT 1,
      input_data TEXT NOT NULL,
      result_data TEXT NOT NULL,
      is_valid INTEGER NOT NULL DEFAULT 0,
      calculated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS prior_year_data (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      fiscal_year_id TEXT NOT NULL REFERENCES fiscal_years(id),
      data_type TEXT NOT NULL,
      data_json TEXT NOT NULL,
      imported_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS filing_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      fiscal_year_id TEXT NOT NULL REFERENCES fiscal_years(id),
      filing_type TEXT NOT NULL,
      format TEXT NOT NULL,
      file_path TEXT NOT NULL,
      generated_at TEXT NOT NULL DEFAULT (datetime('now')),
      status TEXT NOT NULL DEFAULT 'generated'
    );

    CREATE TABLE IF NOT EXISTS audit_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      fiscal_year_id TEXT,
      action TEXT NOT NULL,
      target TEXT NOT NULL,
      detail TEXT,
      timestamp TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
}
