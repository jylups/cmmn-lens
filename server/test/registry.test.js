import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile, spawnSync } from 'node:child_process';
import { copyFile, mkdtemp, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { findServers, register, unregister } from '../src/registry.js';
import { ViewServer } from '../src/views.js';

const FIXTURES = join(import.meta.dirname, 'fixtures');
const HOOK = join(import.meta.dirname, '..', '..', 'plugins', 'cmmn-lens', 'hooks', 'selection-context.mjs');

/** The id of a process that has ended. */
function endedPid() {
  return spawnSync(process.execPath, ['-e', '0']).pid;
}

describe('the registry', () => {
  let dir;

  before(async () => {
    dir = await mkdtemp(join(tmpdir(), 'cmmn-lens-registry-'));
  });

  after(() => rm(dir, { recursive: true }));

  test('lists the running servers of a project, readable by the user only', async () => {
    const entry = { pid: process.pid, port: 1234, token: 'abc', projectDir: '/work/a' };

    await register(entry, dir);

    assert.deepEqual(await findServers('/work/a', dir), [entry]);
    assert.deepEqual(await findServers('/work/b', dir), []);
    assert.equal((await stat(join(dir, `${process.pid}.json`))).mode & 0o777, 0o600);

    await unregister(process.pid, dir);
    assert.deepEqual(await findServers('/work/a', dir), []);
  });

  test('drops the entries of servers that have stopped', async () => {
    const pid = endedPid();

    await register({ pid, port: 1, token: 'x', projectDir: '/work/a' }, dir);
    await writeFile(join(dir, 'broken.json'), '{');

    assert.deepEqual(await findServers('/work/a', dir), []);
    assert.ok(!(await readdir(dir)).includes(`${pid}.json`));
  });

  test('answers no servers when the folder does not exist', async () => {
    assert.deepEqual(await findServers('/work/a', join(dir, 'missing')), []);
  });
});

describe('the selection endpoint and the prompt hook', () => {
  let folder;
  let registryDir;
  let views;
  let view;

  before(async () => {
    folder = await mkdtemp(join(tmpdir(), 'cmmn-lens-'));
    registryDir = join(folder, 'registry');
    await copyFile(join(FIXTURES, 'claim.cmmn'), join(folder, 'claim.cmmn'));
    views = new ViewServer({ baseDir: folder, isRegistered: true, registryDir, projectDir: folder });
    view = await views.open('claim.cmmn');
  });

  after(async () => {
    await views.close();
    await rm(folder, { recursive: true });
  });

  function url(path, token = views.token) {
    return `${new URL(view.url).origin}${path}?t=${token}`;
  }

  async function select(ids) {
    const target = new URL(view.url);

    target.pathname += '/selection';

    const response = await fetch(target, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids })
    });

    assert.equal(response.status, 204);
  }

  /** Runs the hook as the agent would, and returns what it printed. */
  function runHook(env = {}, input = { cwd: folder, prompt: 'what does this do?' }) {
    return new Promise((resolve, reject) => {
      const child = execFile(process.execPath, [HOOK], {
        env: { ...process.env, CMMN_LENS_REGISTRY_DIR: registryDir, CLAUDE_PROJECT_DIR: folder, ...env },
        timeout: 5000
      }, (error, stdout) => (error ? reject(error) : resolve(stdout)));

      child.stdin.end(JSON.stringify(input));
    });
  }

  test('registers the web server while it runs', async () => {
    const [entry] = await findServers(folder, registryDir);

    assert.equal(entry.pid, process.pid);
    assert.equal(entry.port, new URL(view.url).port * 1);
    assert.equal(entry.token, views.token);
  });

  test('describes the selection to callers with the token', async () => {
    await select(['PI_approve']);

    const response = await fetch(url('/selection'));
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.deepEqual(body.ids, ['PI_approve']);
    assert.equal(body.elements[0].definition.name, 'Approve the claim');
    assert.equal((await fetch(url('/selection', '0'.repeat(48)))).status, 403);
    assert.equal((await fetch(url('/selection'), { method: 'POST' })).status, 405);
  });

  test('the hook adds the selection to the prompt\'s context', async () => {
    await select(['PI_approve']);

    const output = JSON.parse(await runHook());

    assert.equal(output.hookSpecificOutput.hookEventName, 'UserPromptSubmit');
    assert.match(output.hookSpecificOutput.additionalContext,
      /^The user has selected in the cmmn-lens viewer of claim\.cmmn: PI_approve \("Approve the claim"\)\./);
    assert.match(output.hookSpecificOutput.additionalContext, /"flowable:candidateGroups":"managers"/);
  });

  test('the hook adds nothing when the option is off', async () => {
    await select(['PI_approve']);

    assert.equal(await runHook({ CLAUDE_PLUGIN_OPTION_SELECTION_CONTEXT: 'false' }), '');
  });

  test('the hook adds nothing when nothing is selected', async () => {
    await select([]);

    assert.equal(await runHook(), '');
  });

  test('the hook adds nothing for another project', async () => {
    await select(['PI_approve']);

    assert.equal(await runHook({ CLAUDE_PROJECT_DIR: join(folder, 'elsewhere') }), '');
  });

  test('closing the server removes its entry', async () => {
    const other = new ViewServer({ baseDir: folder, isRegistered: true, registryDir: join(folder, 'registry-2'), projectDir: folder });

    await other.open('claim.cmmn');
    assert.equal((await findServers(folder, join(folder, 'registry-2'))).length, 1);

    await other.close();
    assert.equal((await findServers(folder, join(folder, 'registry-2'))).length, 0);
  });
});
