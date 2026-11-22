#!/usr/bin/env node

import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

import { createMcpServer } from './mcp.js';
import { ViewServer } from './views.js';

// CLAUDE_PROJECT_DIR is set for plugin MCP servers and hooks alike: relative
// paths resolve against the project, wherever the server was started, and the
// registry lists the server under it, so the plugin's prompt hook finds it
const projectDir = process.env.CLAUDE_PROJECT_DIR || process.cwd();
const views = new ViewServer({ baseDir: projectDir, isRegistered: true, projectDir });
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
