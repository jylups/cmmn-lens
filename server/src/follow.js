import { createHash } from 'node:crypto';
import { watch } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { basename, dirname } from 'node:path';

/** How long a burst of file events must be quiet before the file is read. */
const SETTLE_MS = 75;

/**
 * The version of a file's content: changes when the content does, and only then.
 *
 * @param {Buffer|string} content
 * @returns {string}
 */
export function versionOf(content) {
  return createHash('sha256').update(content).digest('hex').slice(0, 16);
}

/**
 * Follows one file and reports when its content changes, it disappears or it
 * comes back. Watches the folder rather than the file, so a save that writes a
 * new file and renames it over the old one (as many editors do) is seen too.
 */
export class FileFollower {
  /**
   * @param {string} path the file's full path
   * @param {(state: { version: string|null, exists: boolean }) => void} onChange
   */
  constructor(path, onChange) {
    this.path = path;
    this.name = basename(path);
    this.onChange = onChange;
    this.state = { version: null, exists: false };
    this.watcher = null;
    this.timer = null;
    this.reading = null;
  }

  /** Reads the file once and starts watching it. */
  async start() {
    this.state = await this.read();
    this.watcher = watch(dirname(this.path), { persistent: false }, (event, filename) => {
      // some platforms give no file name: the event may be ours
      if (!filename || filename === this.name) {
        this.schedule();
      }
    });
    this.watcher.on('error', () => this.schedule());
  }

  stop() {
    clearTimeout(this.timer);
    this.watcher?.close();
    this.watcher = null;
  }

  schedule() {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.check(), SETTLE_MS);
  }

  /** Reads the file and reports a change of content or existence. */
  async check() {
    if (this.reading) {
      // read again once the read in flight is done, so the last write is seen
      this.reading.then(() => this.schedule());

      return;
    }

    this.reading = this.read();

    try {
      const next = await this.reading;

      if (!this.watcher) {
        return;
      }

      if (next.version !== this.state.version || next.exists !== this.state.exists) {
        this.state = next;
        this.onChange(next);
      }
    } finally {
      this.reading = null;
    }
  }

  async read() {
    try {
      return { version: versionOf(await readFile(this.path)), exists: true };
    } catch {
      return { version: null, exists: false };
    }
  }
}
