import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { request } from 'node:http';
import { mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { ViewServer } from '../src/views.js';

const FIXTURES = join(import.meta.dirname, 'fixtures');
const CLAIM = join(FIXTURES, 'claim.cmmn');

/** A GET with a chosen Host header, which fetch() doesn't allow. */
function getWithHost(url, host) {
  return new Promise((resolve, reject) => {
    const req = request(url, { headers: { host } }, response => {
      response.resume();
      response.on('end', () => resolve(response.statusCode));
    });
    req.on('error', reject);
    req.end();
  });
}

describe('ViewServer', () => {
  let views;

  before(() => {
    views = new ViewServer({ baseDir: FIXTURES });
  });

  after(() => views.close());

  test('opens a view by relative path and serves its page', async () => {
    const view = await views.open('claim.cmmn');

    assert.equal(view.path, await realpath(CLAIM));
    assert.equal(view.isReused, false);
    assert.match(view.url, /^http:\/\/127\.0\.0\.1:\d+\/view\/[0-9a-f]+\?t=[0-9a-f]{48}$/);

    const response = await fetch(view.url);
    const html = await response.text();

    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-type'), /^text\/html/);
    assert.match(html, /<title>claim\.cmmn · cmmn-lens<\/title>/);
    assert.match(html, /\/assets\/cmmn-navigated-viewer\.js/);
  });

  test('serves the file through the diagram URL in the page', async () => {
    const view = await views.open(CLAIM);
    const html = await (await fetch(view.url)).text();
    const config = JSON.parse(/<script id="cmmn-lens-config" type="application\/json">(.*?)<\/script>/.exec(html)[1]);

    const response = await fetch(new URL(config.diagramUrl, view.url));

    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-type'), /^application\/xml/);
    assert.equal(await response.text(), await readFile(CLAIM, 'utf8'));
  });

  test('returns the same view for the same file', async () => {
    const first = await views.open(CLAIM);
    const second = await views.open('./claim.cmmn');

    assert.equal(second.url, first.url);
    assert.equal(second.isReused, true);
  });

  test('returns the same view for a link to the file', async () => {
    const folder = await mkdtemp(join(tmpdir(), 'cmmn-lens-'));

    try {
      const link = join(folder, 'link.cmmn');
      await symlink(CLAIM, link);

      assert.equal((await views.open(link)).url, (await views.open(CLAIM)).url);
    } finally {
      await rm(folder, { recursive: true });
    }
  });

  test('refuses requests without the token or with a wrong one', async () => {
    const view = await views.open(CLAIM);
    const url = new URL(view.url);

    url.searchParams.delete('t');
    assert.equal((await fetch(url)).status, 403);

    url.searchParams.set('t', '0'.repeat(48));
    assert.equal((await fetch(url)).status, 403);

    url.pathname += '/diagram';
    assert.equal((await fetch(url)).status, 403);
  });

  test('refuses a Host header that names another site', async () => {
    const view = await views.open(CLAIM);

    assert.equal(await getWithHost(view.url, 'evil.example:80'), 403);
    assert.equal(await getWithHost(view.url, new URL(view.url).host), 200);
  });

  test('serves the viewer assets with their content types', async () => {
    const view = await views.open(CLAIM);
    const origin = new URL(view.url).origin;

    for (const [path, type] of [
      ['/assets/cmmn-navigated-viewer.js', /^text\/javascript/],
      ['/assets/viewer.js', /^text\/javascript/],
      ['/assets/diagram-js.css', /^text\/css/],
      ['/assets/flowable.json', /^application\/json/]
    ]) {
      const response = await fetch(origin + path);

      assert.equal(response.status, 200, path);
      assert.match(response.headers.get('content-type'), type, path);
    }
  });

  test('answers 404 for unknown paths and 405 for other methods', async () => {
    const view = await views.open(CLAIM);
    const origin = new URL(view.url).origin;

    assert.equal((await fetch(`${origin}/view/abc123?t=${views.token}`)).status, 404);
    assert.equal((await fetch(`${origin}/etc/passwd`)).status, 404);
    assert.equal((await fetch(view.url, { method: 'POST' })).status, 405);
  });

  test('refuses files that are not CMMN, missing or folders', async () => {
    const folder = await mkdtemp(join(tmpdir(), 'cmmn-lens-'));

    try {
      await writeFile(join(folder, 'notes.txt'), 'not a model');

      await assert.rejects(views.open(join(folder, 'notes.txt')), /is not a CMMN file/);
      await assert.rejects(views.open(join(folder, 'missing.cmmn')), /doesn't exist/);

      const folderNamedCmmn = join(folder, 'models.cmmn');
      await mkdir(folderNamedCmmn);
      await assert.rejects(views.open(folderNamedCmmn), /is not a file/);
    } finally {
      await rm(folder, { recursive: true });
    }
  });
});

test('close stops the web server', async () => {
  const views = new ViewServer({ baseDir: FIXTURES });
  const view = await views.open(CLAIM);

  assert.equal((await fetch(view.url)).status, 200);

  await views.close();

  await assert.rejects(fetch(view.url));
});
