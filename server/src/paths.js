import { open, realpath, stat } from 'node:fs/promises';
import { basename, resolve } from 'node:path';

import { MODEL_TYPES, describeAccepted, typeByContent, typeByName, typeLabels } from './types/index.js';

/** How much of an `.xml` file is read to find its root element. */
const HEAD_BYTES = 64 * 1024;

/**
 * Resolves the path of a model file a tool was given, checks that it is an
 * existing file, and finds its model type: by its name, or for an `.xml` file
 * by its root element's namespace.
 *
 * @param {string} baseDir the folder relative paths are resolved against
 * @param {string} path absolute, or relative to `baseDir`
 * @param {import('./types/index.js').ModelType[]} [types]
 * @returns {Promise<{ path: string, type: import('./types/index.js').ModelType }>}
 *   the file's real path, links resolved, and its model type
 */
export async function resolveModelFile(baseDir, path, types = MODEL_TYPES) {
  const absolute = resolve(baseDir, path);
  const byName = typeByName(basename(absolute), types);
  const isXml = absolute.toLowerCase().endsWith('.xml');

  if (!byName && !isXml) {
    throw new Error(`${path} is not a ${typeLabels(types)} file: the tools open ${describeAccepted(types)} files.`);
  }

  let info;

  try {
    info = await stat(absolute);
  } catch {
    throw new Error(`${path} doesn't exist.`);
  }

  if (!info.isFile()) {
    throw new Error(`${path} is not a file.`);
  }

  const real = await realpath(absolute);
  const type = byName ?? typeByContent(await readHead(real), types);

  if (!type) {
    throw new Error(
      `${path} is not a ${typeLabels(types)} file: its root element has no namespace the tools know. ` +
      `They open ${describeAccepted(types)} files.`
    );
  }

  return { path: real, type };
}

async function readHead(path) {
  const handle = await open(path, 'r');

  try {
    const { buffer, bytesRead } = await handle.read(Buffer.alloc(HEAD_BYTES), 0, HEAD_BYTES, 0);

    return buffer.subarray(0, bytesRead).toString('utf8');
  } finally {
    await handle.close();
  }
}
