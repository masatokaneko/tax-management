import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerTool } from "../helpers/register-tool.js";

// Setup tools
import { SetCompanyInfoTool } from "./setup/set-company-info.tool.js";
import { InitFiscalYearTool } from "./setup/init-fiscal-year.tool.js";
import { ImportPriorDataTool } from "./setup/import-prior-data.tool.js";

// Data tools
import { GetTaxRatesTool } from "./data/get-tax-rates.tool.js";

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

// Validation tools
import { ValidateSchedulesTool } from "./validation/validate-schedules.tool.js";

// Export tools
import { PreviewReturnTool } from "./export/preview-return.tool.js";

// Status tools
import { GetFilingStatusTool } from "./status/get-filing-status.tool.js";

export function registerAllTools(server: McpServer): void {
  // Setup tools
  registerTool(server, SetCompanyInfoTool);
  registerTool(server, InitFiscalYearTool);
  registerTool(server, ImportPriorDataTool);

  // Data tools
  registerTool(server, GetTaxRatesTool);

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

  // Validation tools
  registerTool(server, ValidateSchedulesTool);

  // Export tools
  registerTool(server, PreviewReturnTool);

  // Status tools
  registerTool(server, GetFilingStatusTool);
}
