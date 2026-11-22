import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * Where running viewer servers register themselves, so the plugin's hooks
 * (separate processes) can find them: one file per server process, holding
 * its port and token, readable by the user only. CMMN_LENS_REGISTRY_DIR
 * names another folder (for tests); the hook reads the same variable.
 */
export const REGISTRY_DIR = process.env.CMMN_LENS_REGISTRY_DIR || join(tmpdir(), 'cmmn-lens', 'servers');

/**
 * @typedef {object} ServerEntry
 * @property {number} pid the MCP server's process id
 * @property {number} port the web server's port on 127.0.0.1
 * @property {string} token
 * @property {string} projectDir the project the agent session runs in
 */

/**
 * Registers a running server.
 *
 * @param {ServerEntry} entry
 * @param {string} [dir]
 */
export async function register(entry, dir = REGISTRY_DIR) {
  await mkdir(dir, { recursive: true, mode: 0o700 });
  await writeFile(join(dir, `${entry.pid}.json`), JSON.stringify(entry), { mode: 0o600 });
}

/**
 * Removes a server's entry.
 *
 * @param {number} pid
 * @param {string} [dir]
 */
export async function unregister(pid, dir = REGISTRY_DIR) {
  await rm(join(dir, `${pid}.json`), { force: true });
}

/**
 * The running servers of a project. Entries of processes that no longer run
 * are removed. (MCP servers get no session id, so a project with several
 * sessions has several servers; callers take the newest selection.)
 *
 * @param {string} projectDir
 * @param {string} [dir]
 * @returns {Promise<ServerEntry[]>}
 */
export async function findServers(projectDir, dir = REGISTRY_DIR) {
  let names;

  try {
    names = await readdir(dir);
  } catch {
    return [];
  }

  const entries = [];

  for (const name of names.filter(file => file.endsWith('.json'))) {
    let entry;

    try {
      entry = JSON.parse(await readFile(join(dir, name), 'utf8'));
    } catch {
      continue;
    }

    if (!isRunning(entry.pid)) {
      await rm(join(dir, name), { force: true });
      continue;
    }

    entries.push(entry);
  }

  return entries.filter(entry => entry.projectDir === projectDir);
}

function isRunning(pid) {
  try {
    process.kill(pid, 0);

    return true;
  } catch {
    // gone, or (EPERM) a process of another user that took the id over
    return false;
  }
}
