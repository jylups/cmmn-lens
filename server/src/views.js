import { createServer } from 'node:http';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { chmod, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { basename, dirname, extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { FileFollower, versionOf } from './follow.js';
import { resolveDrawnIds } from './highlight.js';
import { resolveCmmnFile } from './paths.js';
import { register, unregister } from './registry.js';
import { describeSelection } from './selection.js';
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
  ['/assets/properties.js', join(PUBLIC_DIR, 'properties.js')],
  ['/assets/viewer.js', join(PUBLIC_DIR, 'viewer.js')],
  ['/assets/viewer.css', join(PUBLIC_DIR, 'viewer.css')],
  // built by `npm run build` (scripts/build.mjs); loaded in edit mode
  ['/assets/build/editor.js', join(PUBLIC_DIR, 'build', 'editor.js')],
  ['/assets/build/properties-panel.css', join(PUBLIC_DIR, 'build', 'properties-panel.css')]
]);

const CONTENT_TYPES = {
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8'
};

const VIEW_PATH = /^\/view\/([0-9a-f]+)(?:\/(diagram|events|selection|describe|save))?$/;

/** The largest model the page may save. */
const MAX_SAVE_BYTES = 10 * 1024 * 1024;

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
 * (`{ ids }`); `selection()` returns the newest, and `GET /selection`
 * describes it for the plugin's hooks, which find the server through the
 * registry (registry.js) when `isRegistered` is set.
 *
 * `highlight()` marks elements in a view: the stream sends a `highlight` event
 * (`{ ids, version }`), which applies to that version of the file; the page
 * clears it when a newer version arrives.
 */
export class ViewServer {
  /**
   * @param {object} [options]
   * @param {string} [options.baseDir] the folder relative paths are resolved
   *   against; the working directory by default
   * @param {boolean} [options.isRegistered] whether to list the running web
   *   server in the registry, for the plugin's hooks
   * @param {string} [options.registryDir] the registry folder, for tests
   * @param {string} [options.projectDir] the project, recorded in the
   *   registry; `baseDir` by default
   */
  constructor({ baseDir = process.cwd(), isRegistered = false, registryDir, projectDir = baseDir } = {}) {
    this.baseDir = baseDir;
    this.isRegistered = isRegistered;
    this.registryDir = registryDir;
    this.projectDir = projectDir;
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
        selection: { ids: [], at: 0 },
        highlight: null,
        touched: 0
      };
      view.follower = new FileFollower(realPath, state => this.broadcast(view, state));
      await view.follower.start();
      this.viewsByPath.set(realPath, view);
      this.viewsById.set(view.id, view);
    }

    view.touched = Date.now();

    return { url: this.viewUrl(view), path: realPath, isReused };
  }

  /**
   * The view of a file, or else the view last opened or selected in.
   *
   * @param {string} [path]
   */
  async pickView(path) {
    if (path) {
      return this.viewsByPath.get(await resolveCmmnFile(this.baseDir, path)) ?? null;
    }

    let view = null;

    for (const candidate of this.viewsById.values()) {
      if (!view || candidate.touched > view.touched) {
        view = candidate;
      }
    }

    return view;
  }

  /**
   * Marks elements in a view and scrolls to them, until the file changes
   * again. Ids of elements the diagram doesn't draw (a task, a sentry) mark
   * the shapes that stand for them; an empty list clears the marks.
   *
   * @param {string|undefined} path the file, or the view last used
   * @param {string[]} ids
   * @returns {Promise<null | { path: string, name: string, drawn: string[], unknown: string[], undrawn: string[] }>}
   *   null when no view is open (for that file)
   */
  async highlight(path, ids) {
    const view = await this.pickView(path);

    if (!view) {
      return null;
    }

    const xml = await readFile(view.path, 'utf8');
    const resolved = ids.length ? await resolveDrawnIds(xml, ids) : { drawn: [], unknown: [], undrawn: [] };

    view.highlight = { ids: resolved.drawn, version: versionOf(xml) };

    for (const client of view.clients) {
      sendEvent(client, 'highlight', view.highlight);
    }

    return { path: view.path, name: view.name, ...resolved };
  }

  /**
   * The selection of a view: of the file given, or else of the view whose
   * selection changed last.
   *
   * @param {string} [path] absolute, or relative to `baseDir`
   * @returns {Promise<{ path: string, name: string, ids: string[], at: number } | null>}
   *   `at` is when the selection last changed (0: never)
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

    return view ? { path: view.path, name: view.name, ids: view.selection.ids, at: view.selection.at } : null;
  }

  /**
   * The selection, with each selected element described from the file as it
   * is now (selection.js).
   *
   * @param {string} [path]
   * @returns {Promise<null | { path: string, name: string, ids: string[], elements?: object[], error?: string }>}
   *   `error` when the file can't be read as CMMN right now
   */
  async selectionDetails(path) {
    const selection = await this.selection(path);

    if (!selection?.ids.length) {
      return selection;
    }

    try {
      return { ...selection, elements: await describeSelection(await readFile(selection.path, 'utf8'), selection.ids) };
    } catch (error) {
      return { ...selection, error: error.message.split('\n')[0] };
    }
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

    if (this.isRegistered) {
      await register({
        pid: process.pid,
        port: this.port,
        token: this.token,
        projectDir: this.projectDir
      }, this.registryDir);
    }
  }

  /** Sends a view's file state to every page that shows it. */
  broadcast(view, state) {
    // a highlight lasts until the next change of the file
    if (view.highlight && view.highlight.version !== state.version) {
      view.highlight = null;
    }

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

    if (this.isRegistered) {
      await unregister(process.pid, this.registryDir);
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

    if (url.pathname === '/selection') {
      if (request.method !== 'GET') {
        return send(response, 405, 'Method not allowed', { Allow: 'GET' });
      }

      if (!this.isToken(url.searchParams.get('t'))) {
        return send(response, 403, 'Forbidden');
      }

      return send(response, 200, JSON.stringify(await this.selectionDetails()), {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store'
      });
    }

    const match = VIEW_PATH.exec(url.pathname);
    const isSelection = match?.[2] === 'selection';
    const isSave = match?.[2] === 'save';
    const allowed = isSelection || isSave ? ['POST'] : ['GET', 'HEAD'];

    if (!allowed.includes(request.method)) {
      return send(response, 405, 'Method not allowed', { Allow: allowed.join(', ') });
    }

    const asset = ASSETS.get(url.pathname);

    if (asset) {
      let body;

      try {
        body = await readFile(asset);
      } catch {
        return send(response, 404, `${url.pathname} isn't built: run npm run build`);
      }

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

    if (isSave) {
      return this.save(request, response, view);
    }

    if (match[2] === 'describe') {
      return this.describe(response, view, url.searchParams.get('ids'));
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
      selectionUrl: `/view/${view.id}/selection?t=${this.token}`,
      describeUrl: `/view/${view.id}/describe?t=${this.token}`,
      saveUrl: `/view/${view.id}/save?t=${this.token}`
    });

    return send(response, 200, page, {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store'
    });
  }

  /**
   * Writes the model the page saves (`{ xml }`) to the view's file, and
   * answers `{ version }`, the saved content's version. The file is replaced
   * in one step (a new file renamed over it), keeping its permissions.
   */
  async save(request, response, view) {
    const body = await readJson(request, response, MAX_SAVE_BYTES);

    if (body === undefined) {
      return;
    }

    if (typeof body?.xml !== 'string' || !body.xml.trim()) {
      return send(response, 400, 'The save needs xml, the model as a string');
    }

    const temporary = `${view.path}.cmmn-lens-${randomBytes(4).toString('hex')}.tmp`;

    try {
      const { mode } = await stat(view.path).catch(() => ({ mode: 0o644 }));

      await writeFile(temporary, body.xml, 'utf8');
      await chmod(temporary, mode & 0o7777);
      await rename(temporary, view.path);
    } catch (error) {
      await rm(temporary, { force: true });

      return send(response, 500, `Couldn't save ${view.name}: ${error.message}`);
    }

    return send(response, 200, JSON.stringify({ version: versionOf(body.xml) }), {
      'Content-Type': 'application/json; charset=utf-8'
    });
  }

  /** Stores the selection a page posts: `{ ids: string[] }`. */
  async receiveSelection(request, response, view) {
    const body = await readJson(request, response, MAX_SELECTION_BYTES);

    if (body === undefined) {
      return;
    }

    const ids = body?.ids;

    if (!Array.isArray(ids) || !ids.every(id => typeof id === 'string')) {
      return send(response, 400, 'The selection needs ids, a list of strings');
    }

    view.selection = { ids: [...new Set(ids)], at: Date.now() };
    view.touched = view.selection.at;

    return send(response, 204, '');
  }

  /**
   * Describes elements of a view's file for the page's properties panel:
   * `?ids=a,b` (ids are XML names, which have no commas). Answers
   * `{ elements }`, or `{ error }` when the file can't be read as CMMN.
   */
  async describe(response, view, idsParam) {
    const ids = (idsParam ?? '').split(',').filter(Boolean).slice(0, 100);
    let body;

    try {
      body = { elements: await describeSelection(await readFile(view.path, 'utf8'), ids) };
    } catch (error) {
      body = { error: error.message.split('\n')[0] };
    }

    return send(response, 200, JSON.stringify(body), {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store'
    });
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

    // a page that loads again restores the selection the server holds
    sendEvent(response, 'selection', { ids: view.selection.ids });

    if (view.highlight) {
      sendEvent(response, 'highlight', view.highlight);
    }

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

/**
 * Reads a JSON request body of at most `limit` bytes. Answers the request
 * itself (415, 413, 400) and resolves undefined when the body won't do.
 */
async function readJson(request, response, limit) {
  if (!/^application\/json\b/.test(request.headers['content-type'] ?? '')) {
    send(response, 415, 'Send application/json');

    return undefined;
  }

  const chunks = [];
  let size = 0;

  for await (const chunk of request) {
    size += chunk.length;

    if (size > limit) {
      send(response, 413, 'Too large');

      return undefined;
    }

    chunks.push(chunk);
  }

  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    send(response, 400, 'Not JSON');

    return undefined;
  }
}
