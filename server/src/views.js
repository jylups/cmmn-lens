import { createServer } from 'node:http';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { readFile, realpath, stat } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { basename, dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

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

/** The file types a view can be opened for. */
export const VIEWABLE_EXTENSIONS = ['.cmmn', '.xml'];

const VIEW_PATH = /^\/view\/([0-9a-f]+)(\/diagram)?$/;

/**
 * Serves one viewer page per opened file on localhost. The web server starts
 * on the first `open` and listens on a random port of 127.0.0.1. Every page
 * and diagram request needs the server's random token, and a Host header that
 * names the server, so other sites in the browser can't read the files.
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
  }

  /**
   * Opens a view of a file, or returns the view already open for it.
   *
   * @param {string} path absolute, or relative to `baseDir`
   * @returns {Promise<{ url: string, path: string, isReused: boolean }>}
   */
  async open(path) {
    const absolute = resolve(this.baseDir, path);
    const extension = extname(absolute).toLowerCase();

    if (!VIEWABLE_EXTENSIONS.includes(extension)) {
      throw new Error(`${path} is not a CMMN file: the viewer opens ${VIEWABLE_EXTENSIONS.join(' and ')} files.`);
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

    const realPath = await realpath(absolute);

    await this.start();

    let view = this.viewsByPath.get(realPath);
    const isReused = Boolean(view);

    if (!view) {
      view = { id: randomBytes(6).toString('hex'), path: realPath, name: basename(realPath) };
      this.viewsByPath.set(realPath, view);
      this.viewsById.set(view.id, view);
    }

    return { url: this.viewUrl(view), path: realPath, isReused };
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
  }

  /** Stops the web server and forgets the views. */
  async close() {
    const server = this.server;

    this.server = null;
    this.port = null;
    this.viewsByPath.clear();
    this.viewsById.clear();

    if (!server) {
      return;
    }

    server.closeAllConnections();

    await new Promise(resolveClose => server.close(() => resolveClose()));
  }

  async handle(request, response) {
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return send(response, 405, 'Method not allowed', { Allow: 'GET, HEAD' });
    }

    const host = request.headers.host;

    if (host !== `127.0.0.1:${this.port}` && host !== `localhost:${this.port}`) {
      return send(response, 403, 'Forbidden');
    }

    const url = new URL(request.url, this.origin());
    const asset = ASSETS.get(url.pathname);

    if (asset) {
      const body = await readFile(asset);

      return send(response, 200, body, {
        'Content-Type': CONTENT_TYPES[extname(asset)],
        'Cache-Control': 'no-cache'
      });
    }

    const match = VIEW_PATH.exec(url.pathname);
    const view = match && this.viewsById.get(match[1]);

    if (!view) {
      return send(response, 404, 'Not found');
    }

    if (!this.isToken(url.searchParams.get('t'))) {
      return send(response, 403, 'Forbidden');
    }

    if (match[2]) {
      let xml;

      try {
        xml = await readFile(view.path);
      } catch {
        return send(response, 404, `${view.name} can't be read.`);
      }

      return send(response, 200, xml, {
        'Content-Type': 'application/xml; charset=utf-8',
        'Cache-Control': 'no-store'
      });
    }

    const page = renderPage({
      name: view.name,
      path: view.path,
      diagramUrl: `/view/${view.id}/diagram?t=${this.token}`
    });

    return send(response, 200, page, {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store'
    });
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
