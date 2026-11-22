import assert from 'node:assert/strict';

/** How long a test waits for an event by default: a file change must reach the page within this (issue #3). */
export const DEADLINE_MS = 1000;

/**
 * Reads a server-sent event stream. `next(type)` resolves with the data of
 * the next event of that type (events of other types are skipped), or
 * rejects when none comes in time or the stream ends.
 *
 * @param {string|URL} url
 */
export async function openEvents(url) {
  const controller = new AbortController();
  const response = await fetch(url, { signal: controller.signal });

  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type'), /^text\/event-stream/);

  const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
  const queue = [];
  const waiters = [];
  let buffer = '';
  let isEnded = false;

  function deliver() {
    for (const waiter of [...waiters]) {
      const index = queue.findIndex(event => event.type === waiter.type);

      if (index >= 0) {
        const [event] = queue.splice(index, 1);

        waiters.splice(waiters.indexOf(waiter), 1);
        waiter.resolve(event.data);
      } else if (isEnded) {
        waiters.splice(waiters.indexOf(waiter), 1);
        waiter.reject(new Error('the stream ended'));
      }
    }
  }

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

          const type = /^event: (.*)$/m.exec(block);
          const data = /^data: (.*)$/m.exec(block);

          if (type && data) {
            queue.push({ type: type[1], data: JSON.parse(data[1]) });
            deliver();
          }
        }
      }
    } catch {
      // aborted
    }

    isEnded = true;
    deliver();
  })();

  return {
    next(type = 'state', timeoutMs = DEADLINE_MS) {
      return new Promise((resolve, reject) => {
        const waiter = {
          type,
          resolve: data => {
            clearTimeout(timer);
            resolve(data);
          },
          reject: error => {
            clearTimeout(timer);
            reject(error);
          }
        };
        const timer = setTimeout(() => {
          const index = waiters.indexOf(waiter);

          if (index >= 0) {
            waiters.splice(index, 1);
          }

          reject(new Error(`no ${type} event within ${timeoutMs} ms`));
        }, timeoutMs);

        waiters.push(waiter);
        deliver();
      });
    },
    close() {
      controller.abort();
    }
  };
}

/** The event stream URL of a view URL. */
export function eventsUrl(viewUrl) {
  const url = new URL(viewUrl);

  url.pathname += '/events';

  return url.href;
}
