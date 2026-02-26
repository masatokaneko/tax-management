import { z } from "zod";

export const fiscalYearIdSchema = z.string().describe("事業年度ID（例: '2025'）");

export const companyIdSchema = z.string().describe("freee会社ID");

export const amountSchema = z.number().int().describe("金額（円単位・整数）");

export const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).describe("日付（YYYY-MM-DD形式）");
