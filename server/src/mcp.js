import { createRequire } from 'node:module';
import { relative } from 'node:path';

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import { CMMN_EXTENSIONS, resolveCmmnFile } from './paths.js';
import { validateFile } from './validate.js';

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
      `Accepts ${CMMN_EXTENSIONS.join(' and ')} files.`,
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

  const problemSchema = z.object({
    level: z.enum(['error', 'warning']),
    message: z.string(),
    elementId: z.string().optional(),
    property: z.string().optional(),
    value: z.string().optional(),
    line: z.number().optional(),
    column: z.number().optional()
  });

  server.registerTool('validate', {
    title: 'Validate a CMMN file',
    description:
      'Checks a local CMMN file the way the viewer reads it, with the CMMN and Flowable descriptors, and lists ' +
      'the problems with their element ids and lines: XML that doesn\'t parse, duplicate ids, references to ' +
      'elements that don\'t exist, attributes nobody reads, and elements with no shape in the diagram. ' +
      'Run it after each edit of a CMMN file and fix the errors. ' +
      `Accepts ${CMMN_EXTENSIONS.join(' and ')} files.`,
    inputSchema: {
      path: z.string().min(1).describe('Path of the CMMN file, absolute or relative to the working directory')
    },
    outputSchema: {
      path: z.string().describe('The file\'s full path'),
      isValid: z.boolean().describe('Whether the file has no errors (it may still have warnings)'),
      errorCount: z.number(),
      warningCount: z.number(),
      problems: z.array(problemSchema)
    },
    annotations: {
      readOnlyHint: true,
      openWorldHint: false
    }
  }, async ({ path }) => {
    let file;

    try {
      file = await resolveCmmnFile(views.baseDir, path);
    } catch (error) {
      return { content: [{ type: 'text', text: error.message }], isError: true };
    }

    const result = await validateFile(file);
    const shown = relative(views.baseDir, file) || file;

    return {
      content: [{ type: 'text', text: formatValidation(shown, result) }],
      structuredContent: { path: file, ...result }
    };
  });

  server.registerTool('get_selection', {
    title: 'Get the selection in a CMMN viewer',
    description:
      'Returns the elements the user has selected in a cmmn-lens viewer, described from the file as it is now: ' +
      'id, type, name, the attributes set (Flowable ones included), the task or other item a plan item stands for, ' +
      'its entry and exit criteria with their sentries, and the stage it is in. ' +
      'Call it when the user refers to "this", "the selected task" or "what I selected". ' +
      'Without a path, it reads the viewer whose selection changed last.',
    inputSchema: {
      path: z.string().min(1).optional().describe('The CMMN file whose viewer to read; the last one used if left out')
    },
    annotations: {
      readOnlyHint: true,
      openWorldHint: false
    }
  }, async ({ path }) => {
    let selection;

    try {
      selection = await views.selectionDetails(path);
    } catch (error) {
      return { content: [{ type: 'text', text: error.message }], isError: true };
    }

    return { content: [{ type: 'text', text: formatSelection(selection, views.baseDir, path) }] };
  });

  server.registerTool('highlight', {
    title: 'Highlight elements in a CMMN viewer',
    description:
      'Marks elements in a cmmn-lens viewer and scrolls them into view, until the file changes again. ' +
      'Use it after an edit to show the user what you changed, or to point at elements you are talking about. ' +
      'Takes element ids: plan items, criteria, on parts and the case plan model are marked themselves; a task, ' +
      'stage, milestone or other plan item definition is marked through the plan items that use it, a sentry through ' +
      'its criteria. An empty list clears the marks. Without a path, it uses the viewer last opened or selected in.',
    inputSchema: {
      ids: z.array(z.string().min(1)).describe('The ids of the elements to mark'),
      path: z.string().min(1).optional().describe('The CMMN file whose viewer to use; the last one used if left out')
    },
    annotations: {
      readOnlyHint: true,
      openWorldHint: false
    }
  }, async ({ ids, path }) => {
    let result;

    try {
      result = await views.highlight(path, ids);
    } catch (error) {
      return { content: [{ type: 'text', text: error.message.split('\n')[0] }], isError: true };
    }

    return { content: [{ type: 'text', text: formatHighlight(result, views.baseDir, path, ids) }] };
  });

  server.registerTool('get_changes', {
    title: 'Get the changes the user saved in a CMMN viewer',
    description:
      'Returns what the user changed and saved in a cmmn-lens viewer since you last looked: elements added, ' +
      'removed and changed (names, attributes, events, moves between stages), and how many shapes they moved. ' +
      'Each change is returned once. Call it when the user says they changed the model in the viewer. ' +
      'Without a path, it reads every open viewer.',
    inputSchema: {
      path: z.string().min(1).optional().describe('The CMMN file whose viewer to read; every viewer if left out')
    },
    annotations: {
      readOnlyHint: false,
      openWorldHint: false
    }
  }, async ({ path }) => {
    let changes;

    try {
      changes = await views.takeUserChanges(path);
    } catch (error) {
      return { content: [{ type: 'text', text: error.message.split('\n')[0] }], isError: true };
    }

    return { content: [{ type: 'text', text: formatChanges(changes, views.baseDir) }] };
  });

  return server;
}

/** The user's saved changes (ViewServer.takeUserChanges) as text. */
export function formatChanges(changes, baseDir) {
  if (!changes.length) {
    return 'The user has saved no changes in the viewer since you last looked.';
  }

  return changes.map(change => {
    const shown = relative(baseDir, change.path) || change.path;
    const time = new Date(change.at).toLocaleTimeString();

    return `The user saved changes to ${shown} in the viewer at ${time}:\n${change.text}`;
  }).join('\n\n');
}

/** A highlight result (ViewServer.highlight) as text. */
export function formatHighlight(result, baseDir, path, ids) {
  if (!result) {
    return path ? `No viewer is open for ${path}.` : 'No viewer is open. Open one with open_view.';
  }

  const shown = relative(baseDir, result.path) || result.path;

  if (!ids.length) {
    return `Cleared the highlight in ${shown}.`;
  }

  const lines = [
    result.drawn.length ? `Highlighted ${result.drawn.join(', ')} in ${shown}.` : `Nothing to highlight in ${shown}.`
  ];

  if (result.unknown.length) {
    lines.push(`Not in the file: ${result.unknown.join(', ')}.`);
  }

  if (result.undrawn.length) {
    lines.push(`Not drawn in the diagram: ${result.undrawn.join(', ')}.`);
  }

  return lines.join(' ');
}

/** The validation result as text, one line per problem. */
export function formatValidation(name, { errorCount, warningCount, problems }) {
  if (!problems.length) {
    return `${name}: no problems found.`;
  }

  const counts = [
    errorCount && `${errorCount} error${errorCount === 1 ? '' : 's'}`,
    warningCount && `${warningCount} warning${warningCount === 1 ? '' : 's'}`
  ].filter(Boolean).join(', ');

  const lines = problems.map(problem => {
    const where = [
      problem.elementId,
      problem.line && `line ${problem.line}`
    ].filter(Boolean).join(', ');

    return `- ${problem.level}${where ? ` (${where})` : ''}: ${problem.message}`;
  });

  return `${name}: ${counts}\n${lines.join('\n')}`;
}

/**
 * A selection (ViewServer.selectionDetails) as text: a summary line, then the
 * details as JSON.
 *
 * @param {object|null} selection
 * @param {string} baseDir
 * @param {string} [path] the file asked about, if any
 */
export function formatSelection(selection, baseDir, path) {
  if (!selection) {
    return path ? `No viewer is open for ${path}.` : 'No viewer is open. Open one with open_view.';
  }

  const shown = relative(baseDir, selection.path) || selection.path;

  if (!selection.ids.length) {
    return `Nothing is selected in the viewer of ${shown}.`;
  }

  if (selection.error) {
    return `${shown} can't be read as CMMN right now (${selection.error}). The selected ids are: ${selection.ids.join(', ')}.`;
  }

  const summary = selection.elements.map(element => {
    const name = element.name ?? element.definition?.name;

    return name ? `${element.id} ("${name}")` : element.id;
  }).join(', ');

  return `Selected in ${shown}: ${summary}\n${JSON.stringify(selection.elements, null, 2)}`;
}
