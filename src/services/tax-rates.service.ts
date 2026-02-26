import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import type { CorporateTaxRates } from "../types/index.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = resolve(__dirname, "..", "data", "tax-rates");

const ratesCache = new Map<string, CorporateTaxRates>();

export function getCorporateTaxRates(fiscalYear: string): CorporateTaxRates {
  const cached = ratesCache.get(fiscalYear);
  if (cached) return cached;

  const filePath = resolve(DATA_DIR, `corporate-tax-${fiscalYear}.json`);
  try {
    const raw = readFileSync(filePath, "utf-8");
    const rates = JSON.parse(raw) as CorporateTaxRates;
    ratesCache.set(fiscalYear, rates);
    return rates;
  } catch {
    throw new Error(`Tax rates not found for fiscal year ${fiscalYear}. Available: check src/data/tax-rates/`);
  }
}

export function getAvailableFiscalYears(): string[] {
  return ["2025", "2026"];
}
