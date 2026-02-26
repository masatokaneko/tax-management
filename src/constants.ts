// Schedule numbers (zero-padded)
export const SCHEDULE_NUMBERS = {
  SCHEDULE_01: "01",
  SCHEDULE_02: "02",
  SCHEDULE_04: "04",
  SCHEDULE_05_1: "05-1",
  SCHEDULE_05_2: "05-2",
  SCHEDULE_06: "06",
  SCHEDULE_07: "07",
  SCHEDULE_08: "08",
  SCHEDULE_14: "14",
  SCHEDULE_15: "15",
  SCHEDULE_16: "16",
} as const;

// Fiscal year statuses
export const FISCAL_YEAR_STATUS = {
  DRAFT: "draft",
  DATA_FETCHED: "data_fetched",
  ADJUSTMENTS_ESTIMATED: "adjustments_estimated",
  ADJUSTMENTS_CONFIRMED: "adjustments_confirmed",
  CALCULATED: "calculated",
  VALIDATED: "validated",
  EXPORTED: "exported",
  FILED: "filed",
} as const;

// Adjustment types
export const ADJUSTMENT_TYPE = {
  ADDITION: "addition",
  DEDUCTION: "deduction",
} as const;

// Adjustment categories (留保 / 社外流出)
export const ADJUSTMENT_CATEGORY = {
  RETAINED: "retained",
  OUTFLOW: "outflow",
} as const;

// Schedule dependency graph for topological calculation order
export const SCHEDULE_DEPENDENCY_GRAPH: Record<string, string[]> = {
  "16": [],
  "15": [],
  "14": [],
  "08": [],
  "04": ["16", "15", "14", "08"],
  "07": ["04"],
  "06": [],
  "01": ["04", "07", "06"],
  "05-2": ["01"],
  "05-1": ["04", "05-2"],
  "02": [],
};
