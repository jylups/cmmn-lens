#!/usr/bin/env node

import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

import { createMcpServer } from './mcp.js';
import { ViewServer } from './views.js';

const views = new ViewServer({ baseDir: process.cwd() });
const server = createMcpServer(views);
const transport = new StdioServerTransport();

let isStopping = false;

/** Stops the web server with the MCP connection, so no view outlives it. */
async function stop() {
  if (isStopping) {
    return;
  }

  isStopping = true;

  try {
    await views.close();
  } finally {
    process.exit(0);
  }
}

transport.onclose = stop;
process.stdin.on('end', stop);
process.on('SIGINT', stop);
process.on('SIGTERM', stop);

await server.connect(transport);
