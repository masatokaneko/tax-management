export type { ToolDefinition } from "./tool-definition.js";

// Corporate tax rate table
export interface CorporateTaxRates {
  fiscalYear: string;
  effectiveFrom: string;
  effectiveTo: string;
  corporateTax: {
    standardRate: number;
    sme: {
      capitalThreshold: number;
      reducedRateThreshold: number;
      reducedRate: number;
      standardRate: number;
    };
  };
  localCorporateTax: {
    rate: number;
  };
  defenseSpecialTax: {
    applicable: boolean;
    rate: number;
    deductionAmount: number;
    startDate: string;
  };
  rounding: {
    taxableIncome: { unit: number; method: string };
    taxAmount: { unit: number; method: string };
  };
}

// Schedule result stored in DB
export interface ScheduleResult {
  scheduleNumber: string;
  version: number;
  inputData: Record<string, unknown>;
  resultData: Record<string, unknown>;
  isValid: boolean;
  calculatedAt: string;
}

// Tax adjustment record
export interface TaxAdjustment {
  id: number;
  fiscalYearId: string;
  adjustmentType: "addition" | "deduction";
  category: "retained" | "outflow";
  itemName: string;
  scheduleRef: string | null;
  amount: number;
  description: string | null;
  sourceJournalIds: string | null;
  aiEstimated: boolean;
  userConfirmed: boolean;
  createdAt: string;
  updatedAt: string;
}

// Company record
export interface Company {
  id: string;
  name: string;
  fiscalYearStartMonth: number;
  capitalAmount: number | null;
  address: string | null;
  municipalityCode: string | null;
  createdAt: string;
  updatedAt: string;
}

// Fiscal year record
export interface FiscalYear {
  id: string;
  companyId: string;
  startDate: string;
  endDate: string;
  status: string;
  createdAt: string;
  updatedAt: string;
}
