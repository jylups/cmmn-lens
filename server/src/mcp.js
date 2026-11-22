import { createRequire } from 'node:module';
import { relative } from 'node:path';

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import { VIEWABLE_EXTENSIONS } from './views.js';

const { version } = createRequire(import.meta.url)('../package.json');

/**
 * The MCP server and its tools, backed by a ViewServer.
 *
 * @param {import('./views.js').ViewServer} views
 * @returns {McpServer}
 */
export function createMcpServer(views) {
  const server = new McpServer({ name: 'cmmn-lens', version });

  server.registerTool('open_view', {
    title: 'Open a CMMN viewer',
    description:
      'Opens an interactive viewer for a local CMMN file and returns its URL on localhost. ' +
      'Show the URL in a browser pane or a browser to see the diagram. ' +
      'Calling it again for the same file returns the same URL. ' +
      `Accepts ${VIEWABLE_EXTENSIONS.join(' and ')} files.`,
    inputSchema: {
      path: z.string().min(1).describe('Path of the CMMN file, absolute or relative to the working directory')
    },
    outputSchema: {
      url: z.string().describe('The viewer page for the file'),
      path: z.string().describe('The file\'s full path'),
      isReused: z.boolean().describe('Whether a view of this file was already open')
    },
    annotations: {
      readOnlyHint: true,
      openWorldHint: false
    }
  }, async ({ path }) => {
    try {
      const view = await views.open(path);
      const shown = relative(views.baseDir, view.path) || view.path;

      return {
        content: [{ type: 'text', text: `Viewer for ${shown}: ${view.url}` }],
        structuredContent: view
      };
    } catch (error) {
      return {
        content: [{ type: 'text', text: error.message }],
        isError: true
      };
    }
  });

  return server;
}
