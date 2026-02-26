import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerTool } from "../helpers/register-tool.js";

// Setup tools
import { SetCompanyInfoTool } from "./setup/set-company-info.tool.js";
import { InitFiscalYearTool } from "./setup/init-fiscal-year.tool.js";
import { ImportPriorDataTool } from "./setup/import-prior-data.tool.js";

// Data tools
import { GetTaxRatesTool } from "./data/get-tax-rates.tool.js";
import { FetchFreeeDataTool } from "./data/fetch-freee-data.tool.js";

// Adjustment tools
import { AddAdjustmentTool } from "./adjustment/add-adjustment.tool.js";
import { ListAdjustmentsTool } from "./adjustment/list-adjustments.tool.js";
import { UpdateAdjustmentTool } from "./adjustment/update-adjustment.tool.js";
import { DeleteAdjustmentTool } from "./adjustment/delete-adjustment.tool.js";
import { ConfirmAdjustmentTool } from "./adjustment/confirm-adjustment.tool.js";

// Schedule tools
import { CalculateSchedule04Tool } from "./schedules/calculate-schedule-04.tool.js";
import { CalculateSchedule01Tool } from "./schedules/calculate-schedule-01.tool.js";
import { CalculateSchedule05_2Tool } from "./schedules/calculate-schedule-05-2.tool.js";
import { CalculateSchedule05_1Tool } from "./schedules/calculate-schedule-05-1.tool.js";
import { CalculateAllSchedulesTool } from "./schedules/calculate-all-schedules.tool.js";
import { CalculateSchedule16Tool } from "./schedules/calculate-schedule-16.tool.js";
import { CalculateSchedule15Tool } from "./schedules/calculate-schedule-15.tool.js";
import { CalculateSchedule02Tool } from "./schedules/calculate-schedule-02.tool.js";
import { CalculateSchedule06Tool } from "./schedules/calculate-schedule-06.tool.js";
import { CalculateSchedule07Tool } from "./schedules/calculate-schedule-07.tool.js";
import { CalculateSchedule08Tool } from "./schedules/calculate-schedule-08.tool.js";
import { CalculateSchedule14Tool } from "./schedules/calculate-schedule-14.tool.js";

// Consumption tax tools
import { CalculateGeneralConsumptionTaxTool } from "./consumption-tax/calculate-general.tool.js";
import { CalculateSimplifiedConsumptionTaxTool } from "./consumption-tax/calculate-simplified.tool.js";

// Local tax tools
import { CalculateResidentTaxTool } from "./local-tax/calculate-resident-tax.tool.js";
import { CalculateEnterpriseTaxTool } from "./local-tax/calculate-enterprise-tax.tool.js";
import { CalculateSpecialEnterpriseTaxTool } from "./local-tax/calculate-special-enterprise-tax.tool.js";

// Validation tools
import { ValidateSchedulesTool } from "./validation/validate-schedules.tool.js";

// Export tools
import { PreviewReturnTool } from "./export/preview-return.tool.js";
import { ExportEtaxXmlTool } from "./export/export-etax-xml.tool.js";
import { ExportEltaxXmlTool } from "./export/export-eltax-xml.tool.js";
import { ExportFinancialXbrlTool } from "./export/export-financial-xbrl.tool.js";

// Status tools
import { GetFilingStatusTool } from "./status/get-filing-status.tool.js";
import { GetWorkflowTool } from "./status/get-workflow.tool.js";

export function registerAllTools(server: McpServer): void {
  // Setup tools
  registerTool(server, SetCompanyInfoTool);
  registerTool(server, InitFiscalYearTool);
  registerTool(server, ImportPriorDataTool);

  // Data tools
  registerTool(server, GetTaxRatesTool);
  registerTool(server, FetchFreeeDataTool);

  // Adjustment tools
  registerTool(server, AddAdjustmentTool);
  registerTool(server, ListAdjustmentsTool);
  registerTool(server, UpdateAdjustmentTool);
  registerTool(server, DeleteAdjustmentTool);
  registerTool(server, ConfirmAdjustmentTool);

  // Schedule tools
  registerTool(server, CalculateSchedule04Tool);
  registerTool(server, CalculateSchedule01Tool);
  registerTool(server, CalculateSchedule05_2Tool);
  registerTool(server, CalculateSchedule05_1Tool);
  registerTool(server, CalculateAllSchedulesTool);
  registerTool(server, CalculateSchedule16Tool);
  registerTool(server, CalculateSchedule15Tool);
  registerTool(server, CalculateSchedule02Tool);
  registerTool(server, CalculateSchedule06Tool);
  registerTool(server, CalculateSchedule07Tool);
  registerTool(server, CalculateSchedule08Tool);
  registerTool(server, CalculateSchedule14Tool);

  // Consumption tax tools
  registerTool(server, CalculateGeneralConsumptionTaxTool);
  registerTool(server, CalculateSimplifiedConsumptionTaxTool);

  // Local tax tools
  registerTool(server, CalculateResidentTaxTool);
  registerTool(server, CalculateEnterpriseTaxTool);
  registerTool(server, CalculateSpecialEnterpriseTaxTool);

  // Validation tools
  registerTool(server, ValidateSchedulesTool);

  // Export tools
  registerTool(server, PreviewReturnTool);
  registerTool(server, ExportEtaxXmlTool);
  registerTool(server, ExportEltaxXmlTool);
  registerTool(server, ExportFinancialXbrlTool);

  // Status tools
  registerTool(server, GetFilingStatusTool);
  registerTool(server, GetWorkflowTool);
}
