#!/usr/bin/env node

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createServer } from "./server.js";
import { registerAllTools } from "./tools/index.js";
import { getDb } from "./db/client.js";

const main = async () => {
  // Initialize database
  getDb();

  // Create MCP server and register tools
  const server = createServer();
  registerAllTools(server);

  // Start stdio transport
  const transport = new StdioServerTransport();
  await server.connect(transport);
};

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
