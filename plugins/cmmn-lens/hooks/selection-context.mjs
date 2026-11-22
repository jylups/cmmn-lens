// UserPromptSubmit hook: adds to the prompt's context what the user has
// selected in a cmmn-lens viewer, so "this task" needs no name, and what they
// changed and saved in the viewer since the agent last heard, so the agent
// doesn't work on a model it remembers wrong.
//
// The viewer servers (the plugin's MCP server, one per session) list
// themselves in a registry folder under the system's temporary folder, with
// their port, token and project. This hook reads the servers of the session's
// project, asks each for its selection (the newest is used) and for the
// changes the user saved (each is reported once). The selection_context option
// turns the selection off; saved changes are always reported. It prints
// nothing when there is nothing to say, and it never blocks the prompt: every
// failure exits 0 with no output.
//
// The registry format is server/src/registry.js's; keep the two in step.

import { readdir, readFile, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { isAbsolute, join, relative } from 'node:path';

const REGISTRY_DIR = process.env.CMMN_LENS_REGISTRY_DIR || join(tmpdir(), 'cmmn-lens', 'servers');
const REQUEST_TIMEOUT_MS = 1000;

/** The context is cut to this length; the hook output limit is 10,000 characters. */
const MAX_CONTEXT = 6000;

function isOff(value) {
  return ['false', '0', 'no', 'off'].includes(String(value ?? '').trim().toLowerCase());
}

async function readInput() {
  let text = '';

  for await (const chunk of process.stdin) {
    text += chunk;
  }

  try {
    return JSON.parse(text);
  } catch {
    return {};
  }
}

function isRunning(pid) {
  try {
    process.kill(pid, 0);

    return true;
  } catch {
    return false;
  }
}

async function serversOf(projectDir) {
  let names;

  try {
    names = await readdir(REGISTRY_DIR);
  } catch {
    return [];
  }

  const servers = [];

  for (const name of names.filter(file => file.endsWith('.json'))) {
    try {
      const entry = JSON.parse(await readFile(join(REGISTRY_DIR, name), 'utf8'));

      if (entry.projectDir === projectDir && isRunning(entry.pid)) {
        servers.push(entry);
      }
    } catch {
      // a file being written, or not ours
    }
  }

  return servers;
}

async function ask(server, path) {
  try {
    const response = await fetch(`http://127.0.0.1:${server.port}${path}?t=${server.token}`, {
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
    });

    return response.ok ? await response.json() : null;
  } catch {
    return null;
  }
}

/** The file's path relative to the project, or in full when it is outside. */
async function shownPath(path, projectDir) {
  let base = projectDir;

  try {
    // the selection's path has its links resolved (macOS's /var is /private/var)
    base = await realpath(projectDir);
  } catch {
    // keep the path as given
  }

  const inside = relative(base, path);

  return inside && !inside.startsWith('..') && !isAbsolute(inside) ? inside : path;
}

function describe(selection, file) {
  const opening = `The user has selected in the cmmn-lens viewer of ${file}`;

  if (selection.error) {
    return `${opening} the elements ${selection.ids.join(', ')} (the file can't be read as CMMN right now: ${selection.error}). ` +
      'Use this when the prompt refers to "this" or "the selected" element; it may not relate to the prompt.';
  }

  const names = selection.elements.map(element => {
    const name = element.name ?? element.definition?.name;

    return name ? `${element.id} ("${name}")` : element.id;
  }).join(', ');

  const text = `${opening}: ${names}. ` +
    'Use this when the prompt refers to "this" or "the selected" element; it may not relate to the prompt. ' +
    `Details from the file as it is now: ${JSON.stringify(selection.elements)}`;

  return text.length > MAX_CONTEXT ? `${text.slice(0, MAX_CONTEXT)}… (cut; call get_selection for the rest)` : text;
}

async function main() {
  const isSelectionOn = !isOff(process.env.CLAUDE_PLUGIN_OPTION_SELECTION_CONTEXT);
  const input = await readInput();
  const projectDir = process.env.CLAUDE_PROJECT_DIR || input.cwd || process.cwd();
  const servers = await serversOf(projectDir);
  const parts = [];

  const changes = (await Promise.all(servers.map(server => ask(server, '/changes'))))
    .flat()
    .filter(change => change?.text)
    .sort((a, b) => a.at - b.at);

  for (const change of changes) {
    parts.push(`The user changed ${await shownPath(change.path, projectDir)} in the cmmn-lens viewer and saved it ` +
      `(read the file again before editing it):\n${change.text}`);
  }

  if (isSelectionOn) {
    const selections = (await Promise.all(servers.map(server => ask(server, '/selection'))))
      .filter(selection => selection?.ids?.length)
      .sort((a, b) => (b.at ?? 0) - (a.at ?? 0));

    if (selections.length) {
      parts.push(describe(selections[0], await shownPath(selections[0].path, projectDir)));
    }
  }

  if (!parts.length) {
    return;
  }

  const context = parts.join('\n\n');

  process.stdout.write(JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'UserPromptSubmit',
      additionalContext: context.length > 9000 ? `${context.slice(0, 9000)}… (cut)` : context
    }
  }));
}

main().catch(() => {
  // never block the prompt
});
