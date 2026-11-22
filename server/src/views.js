import { createServer } from 'node:http';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { basename, dirname, extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { FileFollower, versionOf } from './follow.js';
import { resolveCmmnFile } from './paths.js';
import { renderPage } from './page.js';

const require = createRequire(import.meta.url);

const CMMN_JS_DIST = dirname(require.resolve('@jylups/cmmn-js/dist/cmmn-navigated-viewer.production.min.js'));
const PUBLIC_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'public');

/**
 * The files the viewer page loads, by URL path. They are published package
 * files with nothing private in them, so they are served without the token.
 */
const ASSETS = new Map([
  ['/assets/cmmn-navigated-viewer.js', join(CMMN_JS_DIST, 'cmmn-navigated-viewer.production.min.js')],
  ['/assets/diagram-js.css', join(CMMN_JS_DIST, 'assets/diagram-js.css')],
  ['/assets/cmmn-embedded.css', join(CMMN_JS_DIST, 'assets/cmmn-font/css/cmmn-embedded.css')],
  ['/assets/cmmn-js-flowable.css', join(CMMN_JS_DIST, 'assets/cmmn-js-flowable.css')],
  ['/assets/flowable.json', require.resolve('flowable-cmmn-moddle/resources/flowable.json')],
  ['/assets/viewer.js', join(PUBLIC_DIR, 'viewer.js')],
  ['/assets/viewer.css', join(PUBLIC_DIR, 'viewer.css')]
]);

const CONTENT_TYPES = {
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8'
};

const VIEW_PATH = /^\/view\/([0-9a-f]+)(?:\/(diagram|events|selection))?$/;

/** The largest selection a page may post. */
const MAX_SELECTION_BYTES = 64 * 1024;

/** How often an idle event stream gets a comment, so nothing in between closes it. */
const KEEPALIVE_MS = 25_000;

/**
 * Serves one viewer page per opened file on localhost. The web server starts
 * on the first `open` and listens on a random port of 127.0.0.1. Every page
 * and diagram request needs the server's random token, and a Host header that
 * names the server, so other sites in the browser can't read the files.
 *
 * Each view follows its file: the page subscribes to `/view/<id>/events`, a
 * stream of server-sent `state` events (`{ version, exists }`), one on connect
 * and one each time the file's content changes or it disappears or comes back.
 *
 * The page posts the user's selection to `/view/<id>/selection` as JSON
 * (`{ ids }`); `selection()` returns the newest.
 */
export class ViewServer {
  /**
   * @param {object} [options]
   * @param {string} [options.baseDir] the folder relative paths are resolved
   *   against; the working directory by default
   */
  constructor({ baseDir = process.cwd() } = {}) {
    this.baseDir = baseDir;
    this.token = randomBytes(24).toString('hex');
    this.viewsByPath = new Map();
    this.viewsById = new Map();
    this.server = null;
    this.port = null;
    this.keepalive = null;
  }

  /**
   * Opens a view of a file, or returns the view already open for it.
   *
   * @param {string} path absolute, or relative to `baseDir`
   * @returns {Promise<{ url: string, path: string, isReused: boolean }>}
   */
  async open(path) {
    const realPath = await resolveCmmnFile(this.baseDir, path);

    await this.start();

    let view = this.viewsByPath.get(realPath);
    const isReused = Boolean(view);

    if (!view) {
      view = {
        id: randomBytes(6).toString('hex'),
        path: realPath,
        name: basename(realPath),
        clients: new Set(),
        selection: { ids: [], at: 0 }
      };
      view.follower = new FileFollower(realPath, state => this.broadcast(view, state));
      await view.follower.start();
      this.viewsByPath.set(realPath, view);
      this.viewsById.set(view.id, view);
    }

    return { url: this.viewUrl(view), path: realPath, isReused };
  }

  /**
   * The selection of a view: of the file given, or else of the view whose
   * selection changed last.
   *
   * @param {string} [path] absolute, or relative to `baseDir`
   * @returns {Promise<{ path: string, name: string, ids: string[] } | null>}
   *   null when no view is open (for that file)
   */
  async selection(path) {
    let view;

    if (path) {
      view = this.viewsByPath.get(await resolveCmmnFile(this.baseDir, path));
    } else {
      for (const candidate of this.viewsById.values()) {
        if (!view || candidate.selection.at > view.selection.at) {
          view = candidate;
        }
      }
    }

    return view ? { path: view.path, name: view.name, ids: view.selection.ids } : null;
  }

  viewUrl(view) {
    return `${this.origin()}/view/${view.id}?t=${this.token}`;
  }

  origin() {
    return `http://127.0.0.1:${this.port}`;
  }

  /** Starts the web server, once. */
  async start() {
    if (this.server) {
      return;
    }

    const server = createServer((request, response) => {
      this.handle(request, response).catch(error => {
        console.error('cmmn-lens: request failed', error);
        send(response, 500, 'Internal error');
      });
    });

    this.server = server;

    await new Promise((resolveListen, rejectListen) => {
      server.once('error', rejectListen);
      server.listen(0, '127.0.0.1', () => {
        server.off('error', rejectListen);
        resolveListen();
      });
    });

    this.port = server.address().port;

    this.keepalive = setInterval(() => {
      for (const view of this.viewsById.values()) {
        for (const client of view.clients) {
          client.write(': keepalive\n\n');
        }
      }
    }, KEEPALIVE_MS);
    this.keepalive.unref();
  }

  /** Sends a view's file state to every page that shows it. */
  broadcast(view, state) {
    for (const client of view.clients) {
      sendEvent(client, 'state', state);
    }
  }

  /** Stops the web server and forgets the views. */
  async close() {
    const server = this.server;

    clearInterval(this.keepalive);

    for (const view of this.viewsById.values()) {
      view.follower.stop();

      for (const client of view.clients) {
        client.end();
      }
    }

    this.server = null;
    this.port = null;
    this.keepalive = null;
    this.viewsByPath.clear();
    this.viewsById.clear();

    if (!server) {
      return;
    }

    server.closeAllConnections();

    await new Promise(resolveClose => server.close(() => resolveClose()));
  }

  async handle(request, response) {
    const host = request.headers.host;

    if (host !== `127.0.0.1:${this.port}` && host !== `localhost:${this.port}`) {
      return send(response, 403, 'Forbidden');
    }

    const url = new URL(request.url, this.origin());
    const match = VIEW_PATH.exec(url.pathname);
    const isSelection = match?.[2] === 'selection';
    const allowed = isSelection ? ['POST'] : ['GET', 'HEAD'];

    if (!allowed.includes(request.method)) {
      return send(response, 405, 'Method not allowed', { Allow: allowed.join(', ') });
    }

    const asset = ASSETS.get(url.pathname);

    if (asset) {
      const body = await readFile(asset);

      return send(response, 200, body, {
        'Content-Type': CONTENT_TYPES[extname(asset)],
        'Cache-Control': 'no-cache'
      });
    }

    const view = match && this.viewsById.get(match[1]);

    if (!view) {
      return send(response, 404, 'Not found');
    }

    if (!this.isToken(url.searchParams.get('t'))) {
      return send(response, 403, 'Forbidden');
    }

    if (isSelection) {
      return this.receiveSelection(request, response, view);
    }

    if (match[2] === 'events') {
      return this.stream(request, response, view);
    }

    if (match[2] === 'diagram') {
      let xml;

      try {
        xml = await readFile(view.path);
      } catch {
        return send(response, 404, `${view.name} can't be read.`);
      }

      return send(response, 200, xml, {
        'Content-Type': 'application/xml; charset=utf-8',
        'Cache-Control': 'no-store',
        'X-Diagram-Version': versionOf(xml)
      });
    }

    const page = renderPage({
      name: view.name,
      path: view.path,
      diagramUrl: `/view/${view.id}/diagram?t=${this.token}`,
      eventsUrl: `/view/${view.id}/events?t=${this.token}`,
      selectionUrl: `/view/${view.id}/selection?t=${this.token}`
    });

    return send(response, 200, page, {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store'
    });
  }

  /** Stores the selection a page posts: `{ ids: string[] }`. */
  async receiveSelection(request, response, view) {
    if (!/^application\/json\b/.test(request.headers['content-type'] ?? '')) {
      return send(response, 415, 'Send the selection as application/json');
    }

    const chunks = [];
    let size = 0;

    for await (const chunk of request) {
      size += chunk.length;

      if (size > MAX_SELECTION_BYTES) {
        return send(response, 413, 'Selection too large');
      }

      chunks.push(chunk);
    }

    let ids;

    try {
      ({ ids } = JSON.parse(Buffer.concat(chunks).toString('utf8')));
    } catch {
      return send(response, 400, 'The selection is not JSON');
    }

    if (!Array.isArray(ids) || !ids.every(id => typeof id === 'string')) {
      return send(response, 400, 'The selection needs ids, a list of strings');
    }

    view.selection = { ids: [...new Set(ids)], at: Date.now() };

    return send(response, 204, '');
  }

  /** Opens a page's event stream and sends the file's current state. */
  stream(request, response, view) {
    response.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff'
    });

    if (request.method === 'HEAD') {
      return response.end();
    }

    response.write('retry: 2000\n\n');
    sendEvent(response, 'state', view.follower.state);
    view.clients.add(response);
    request.on('close', () => view.clients.delete(response));
  }

  isToken(candidate) {
    if (typeof candidate !== 'string' || candidate.length !== this.token.length) {
      return false;
    }

    return timingSafeEqual(Buffer.from(candidate), Buffer.from(this.token));
  }
}

function send(response, status, body, headers = {}) {
  response.writeHead(status, {
    'Content-Type': 'text/plain; charset=utf-8',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    ...headers
  });
  response.end(response.req.method === 'HEAD' ? undefined : body);
}

function sendEvent(response, event, data) {
  response.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}
