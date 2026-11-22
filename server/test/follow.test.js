import { afterEach, beforeEach, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { copyFile, mkdtemp, readFile, rename, rm, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

import { versionOf } from '../src/follow.js';
import { ViewServer } from '../src/views.js';

const FIXTURE = join(import.meta.dirname, 'fixtures', 'claim.cmmn');

/** A file change must reach the page within this time (issue #3). */
const DEADLINE_MS = 1000;

/**
 * Reads a server-sent event stream: `next()` resolves with the next event's
 * data, or rejects when none comes within the time given.
 */
async function openEvents(url) {
  const controller = new AbortController();
  const response = await fetch(url, { signal: controller.signal });

  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type'), /^text\/event-stream/);

  const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
  const queue = [];
  const waiters = [];
  let buffer = '';

  (async () => {
    try {
      for (;;) {
        const { value, done } = await reader.read();

        if (done) {
          break;
        }

        buffer += value;

        let end;

        while ((end = buffer.indexOf('\n\n')) >= 0) {
          const block = buffer.slice(0, end);
          buffer = buffer.slice(end + 2);

          const data = /^data: (.*)$/m.exec(block);

          if (/^event: state$/m.test(block) && data) {
            const event = JSON.parse(data[1]);
            const waiter = waiters.shift();

            waiter ? waiter.resolve(event) : queue.push(event);
          }
        }
      }
    } catch {
      // aborted
    }

    for (const waiter of waiters.splice(0)) {
      waiter.reject(new Error('the stream ended'));
    }
  })();

  return {
    next(timeoutMs = DEADLINE_MS) {
      if (queue.length) {
        return Promise.resolve(queue.shift());
      }

      return new Promise((resolve, reject) => {
        const waiter = {
          resolve: event => {
            clearTimeout(timer);
            resolve(event);
          },
          reject
        };
        const timer = setTimeout(() => {
          waiters.splice(waiters.indexOf(waiter), 1);
          reject(new Error(`no event within ${timeoutMs} ms`));
        }, timeoutMs);

        waiters.push(waiter);
      });
    },
    close() {
      controller.abort();
    }
  };
}

function eventsUrl(viewUrl) {
  const url = new URL(viewUrl);

  url.pathname += '/events';

  return url.href;
}

describe('following a file', () => {
  let folder;
  let file;
  let views;
  let events;

  beforeEach(async () => {
    folder = await mkdtemp(join(tmpdir(), 'cmmn-lens-'));
    file = join(folder, 'claim.cmmn');
    await copyFile(FIXTURE, file);
    views = new ViewServer({ baseDir: folder });
  });

  afterEach(async () => {
    events?.close();
    events = null;
    await views.close();
    await rm(folder, { recursive: true });
  });

  async function follow() {
    const view = await views.open(file);

    events = await openEvents(eventsUrl(view.url));

    return view;
  }

  function renamed(xml) {
    return xml.replace('Review the claim', 'Check the claim');
  }

  test('sends the current state when a page connects', async () => {
    await follow();

    assert.deepEqual(await events.next(), { version: versionOf(await readFile(file)), exists: true });
  });

  test('reports a write in place, as an editing tool makes it', async () => {
    await follow();
    await events.next();

    const xml = renamed(await readFile(file, 'utf8'));
    await writeFile(file, xml);

    assert.deepEqual(await events.next(), { version: versionOf(xml), exists: true });
  });

  test('reports a shell write', async () => {
    await follow();
    await events.next();

    const xml = renamed(await readFile(file, 'utf8'));
    await promisify(execFile)('sh', ['-c', 'cat "$1" > "$2"', 'sh', FIXTURE, file]);
    await promisify(execFile)('sh', ['-c', 'printf "%s" "$1" > "$2"', 'sh', xml, file]);

    // the first write leaves the content as it was; the second changes it
    assert.deepEqual(await events.next(), { version: versionOf(xml), exists: true });
  });

  test('reports a save that renames a new file over the old one', async () => {
    await follow();
    await events.next();

    const xml = renamed(await readFile(file, 'utf8'));
    const temporary = join(folder, '.claim.cmmn.tmp');
    await writeFile(temporary, xml);
    await rename(temporary, file);

    assert.deepEqual(await events.next(), { version: versionOf(xml), exists: true });
  });

  test('stays quiet when a write leaves the content as it was', async () => {
    await follow();
    await events.next();

    await writeFile(file, await readFile(file));

    await assert.rejects(events.next(400), /no event/);
  });

  test('reports a deleted file, and its return', async () => {
    await follow();
    await events.next();

    await unlink(file);
    assert.deepEqual(await events.next(), { version: null, exists: false });

    const xml = renamed(await readFile(FIXTURE, 'utf8'));
    await writeFile(file, xml);
    assert.deepEqual(await events.next(), { version: versionOf(xml), exists: true });
  });

  test('labels the diagram with the version the stream reports', async () => {
    const view = await follow();
    const state = await events.next();

    const url = new URL(view.url);
    url.pathname += '/diagram';

    const response = await fetch(url);

    assert.equal(response.headers.get('x-diagram-version'), state.version);
  });

  test('refuses the stream without the token', async () => {
    const view = await views.open(file);
    const url = new URL(eventsUrl(view.url));

    url.searchParams.delete('t');

    assert.equal((await fetch(url)).status, 403);
  });

  test('ends the stream when the server closes', async () => {
    await follow();
    await events.next();

    await views.close();

    await assert.rejects(events.next(), /stream ended|no event/);
  });
});
