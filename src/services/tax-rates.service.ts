import { readFileSync, readdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import type { CorporateTaxRates } from "../types/index.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = resolve(__dirname, "..", "data", "tax-rates");

const ratesCache = new Map<string, CorporateTaxRates>();

/** Load tax rates for the given fiscal year, with fallback to nearest available year */
export function getCorporateTaxRates(fiscalYear: string): CorporateTaxRates {
  const cached = ratesCache.get(fiscalYear);
  if (cached) return cached;

  // Try exact match first
  const filePath = resolve(DATA_DIR, `corporate-tax-${fiscalYear}.json`);
  try {
    const raw = readFileSync(filePath, "utf-8");
    const rates = JSON.parse(raw) as CorporateTaxRates;
    ratesCache.set(fiscalYear, rates);
    return rates;
  } catch {
    // Fallback: find nearest available year
    const available = getAvailableFiscalYears();
    if (available.length === 0) {
      throw new Error(`税率テーブルが見つかりません。src/data/tax-rates/ を確認してください。`);
    }

    const targetYear = parseInt(fiscalYear, 10);
    // Find the closest year (prefer same or earlier year)
    let bestYear = available[0];
    let bestDiff = Math.abs(parseInt(bestYear, 10) - targetYear);
    for (const y of available) {
      const diff = Math.abs(parseInt(y, 10) - targetYear);
      if (diff < bestDiff || (diff === bestDiff && parseInt(y, 10) <= targetYear)) {
        bestYear = y;
        bestDiff = diff;
      }
    }

    const fallbackPath = resolve(DATA_DIR, `corporate-tax-${bestYear}.json`);
    try {
      const raw = readFileSync(fallbackPath, "utf-8");
      const rates = JSON.parse(raw) as CorporateTaxRates;
      // Cache under the requested year so we don't repeat the search
      ratesCache.set(fiscalYear, rates);
      return rates;
    } catch {
      throw new Error(
        `税率テーブルが見つかりません（${fiscalYear}年度）。利用可能: ${available.join(", ")}`,
      );
    }
  }
}

/** List all available fiscal years from the tax-rates directory */
export function getAvailableFiscalYears(): string[] {
  try {
    const files = readdirSync(DATA_DIR);
    return files
      .filter((f) => f.startsWith("corporate-tax-") && f.endsWith(".json"))
      .map((f) => f.replace("corporate-tax-", "").replace(".json", ""))
      .sort();
  } catch {
    return [];
  }
}
