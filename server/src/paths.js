import { realpath, stat } from 'node:fs/promises';
import { extname, resolve } from 'node:path';

/** The file types the tools open. */
export const CMMN_EXTENSIONS = ['.cmmn', '.xml'];

/**
 * Resolves the path of a CMMN file a tool was given, and checks that it is an
 * existing file of a CMMN type.
 *
 * @param {string} baseDir the folder relative paths are resolved against
 * @param {string} path absolute, or relative to `baseDir`
 * @returns {Promise<string>} the file's real path, links resolved
 */
export async function resolveCmmnFile(baseDir, path) {
  const absolute = resolve(baseDir, path);

  if (!CMMN_EXTENSIONS.includes(extname(absolute).toLowerCase())) {
    throw new Error(`${path} is not a CMMN file: the tools open ${CMMN_EXTENSIONS.join(' and ')} files.`);
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

  return realpath(absolute);
}
