import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { chmod, copyFile, mkdtemp, readdir, readFile, rm, stat, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { versionOf } from '../src/follow.js';
import { ViewServer } from '../src/views.js';

const FIXTURE = join(import.meta.dirname, 'fixtures', 'claim.cmmn');
const CLAIM = await readFile(FIXTURE, 'utf8');

describe('saving from the page', () => {
  let folder;
  let file;
  let views;
  let view;

  before(async () => {
    folder = await mkdtemp(join(tmpdir(), 'cmmn-lens-'));
    file = join(folder, 'claim.cmmn');
    await copyFile(FIXTURE, file);
    await chmod(file, 0o640);
    views = new ViewServer({ baseDir: folder });
    view = await views.open('claim.cmmn');
  });

  after(async () => {
    await views.close();
    await rm(folder, { recursive: true });
  });

  function saveUrl(token = views.token) {
    const url = new URL(view.url);

    url.pathname += '/save';
    url.searchParams.set('t', token);

    return url;
  }

  function post(body, { token, type = 'application/json' } = {}) {
    return fetch(saveUrl(token), { method: 'POST', headers: { 'Content-Type': type }, body });
  }

  test('the page has the edit buttons and knows where the editor and the save are', async () => {
    const html = await (await fetch(view.url)).text();
    const config = JSON.parse(/<script id="cmmn-lens-config" type="application\/json">(.*?)<\/script>/.exec(html)[1]);

    assert.match(html, /<button type="button" id="edit" hidden>Edit<\/button>/);
    assert.match(config.saveUrl, /^\/view\/[0-9a-f]+\/save\?t=/);
    assert.equal(config.editorScriptUrl, '/assets/build/editor.js');
    assert.deepEqual(config.editorStyleUrls, ['/assets/build/properties-panel.css', '/assets/cmmn-js-flowable-tools.css']);
  });

  test('writes the model, keeps the file\'s permissions, and answers its version', async () => {
    const xml = CLAIM.replace('Approve the claim', 'Sign off the claim');
    const response = await post(JSON.stringify({ xml, baseVersion: versionOf(CLAIM) }));

    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { version: versionOf(xml) });
    assert.equal(await readFile(file, 'utf8'), xml);
    assert.equal((await stat(file)).mode & 0o777, 0o640);
    assert.deepEqual(await readdir(folder), ['claim.cmmn'], 'no temporary file is left');
  });

  test('refuses a save without the token, of the wrong kind, or without a model', async () => {
    const before = await readFile(file, 'utf8');

    assert.equal((await post('{"xml":"<x/>"}', { token: '0'.repeat(48) })).status, 403);
    assert.equal((await post('{"xml":"<x/>"}', { type: 'text/plain' })).status, 415);
    assert.equal((await post('not json')).status, 400);
    assert.equal((await post('{"xml":"  "}')).status, 400);
    assert.equal((await post('{"xml":"<x/>"}')).status, 400, 'without baseVersion');
    assert.equal((await post(JSON.stringify({ xml: 'x'.repeat(11 * 1024 * 1024) }))).status, 413);
    assert.equal((await fetch(saveUrl())).status, 405);
    assert.equal(await readFile(file, 'utf8'), before);
  });

  test('refuses a save made on an older version, and writes nothing (the agent wrote first)', async () => {
    const base = await readFile(file, 'utf8');
    const agents = base.replace('Review the claim', 'Check the claim');

    await writeFile(file, agents);

    const users = base.replace('Claim handled', 'Claim closed');
    const response = await post(JSON.stringify({ xml: users, baseVersion: versionOf(base) }));

    assert.equal(response.status, 409);
    assert.deepEqual(await response.json(), { version: versionOf(agents) });
    assert.equal(await readFile(file, 'utf8'), agents, 'the agent\'s change is kept');
  });

  test('writes over a newer version once the user chose to keep their edits', async () => {
    const onDisk = await readFile(file, 'utf8');
    const users = onDisk.replace('Handle a claim', 'Handle a claim quickly');
    const response = await post(JSON.stringify({ xml: users, baseVersion: versionOf(onDisk) }));

    assert.equal(response.status, 200);
    assert.equal(await readFile(file, 'utf8'), users);
  });

  test('a later change by the agent is not refused: the page reloads it (the user saved first)', async () => {
    const saved = await readFile(file, 'utf8');
    const agents = saved.replace('Handle a claim quickly', 'Handle a claim');

    await writeFile(file, agents);

    // the page, with no unsaved edits, reloads; a save from the old version is refused
    const stale = await post(JSON.stringify({ xml: saved, baseVersion: versionOf(saved) }));

    assert.equal(stale.status, 409);
    assert.equal(await readFile(file, 'utf8'), agents);
  });

  test('puts back a file that was deleted', async () => {
    const xml = await readFile(file, 'utf8');

    await unlink(file);

    const response = await post(JSON.stringify({ xml, baseVersion: versionOf(xml) }));

    assert.equal(response.status, 200);
    assert.equal(await readFile(file, 'utf8'), xml);
  });
});

test('the editor files are served once built, and say how to build them otherwise', async () => {
  const views = new ViewServer();
  const folder = await mkdtemp(join(tmpdir(), 'cmmn-lens-'));

  try {
    await copyFile(FIXTURE, join(folder, 'claim.cmmn'));

    const view = await views.open(join(folder, 'claim.cmmn'));
    const response = await fetch(new URL('/assets/build/editor.js', view.url));

    if (response.status === 404) {
      assert.match(await response.text(), /run npm run build/);
    } else {
      assert.equal(response.status, 200);
      assert.match(response.headers.get('content-type'), /^text\/javascript/);
    }
  } finally {
    await views.close();
    await rm(folder, { recursive: true });
  }
});
