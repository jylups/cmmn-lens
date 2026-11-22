import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { copyFile, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describeChanges, diffModels, isEmpty } from '../src/changes.js';
import { versionOf } from '../src/follow.js';
import { formatChanges } from '../src/mcp.js';
import { ViewServer } from '../src/views.js';

const FIXTURE = join(import.meta.dirname, 'fixtures', 'claim.cmmn');
const CLAIM = await readFile(FIXTURE, 'utf8');
const HOOK = join(import.meta.dirname, '..', '..', 'plugins', 'cmmn-lens', 'hooks', 'selection-context.mjs');

/** The claim fixture with a stage added to the case plan model, with a shape. */
function withStage(xml) {
  return xml
    .replace('<cmmn:milestone id="Milestone_handled" name="Claim handled"/>',
      '<cmmn:milestone id="Milestone_handled" name="Claim handled"/>\n      <cmmn:planItem id="PI_stage" definitionRef="Stage_review"/>\n      <cmmn:stage id="Stage_review" name="Second review"/>')
    .replace('    </cmmndi:CMMNDiagram>',
      '      <cmmndi:CMMNShape id="DI_PI_stage" cmmnElementRef="PI_stage"><dc:Bounds x="150" y="250" width="200" height="50"/></cmmndi:CMMNShape>\n    </cmmndi:CMMNDiagram>');
}

describe('diffModels', () => {
  test('finds nothing between equal models', async () => {
    assert.ok(isEmpty(await diffModels(CLAIM, CLAIM)));
  });

  test('lists added elements, with their stage', async () => {
    const changes = await diffModels(CLAIM, withStage(CLAIM));

    assert.deepEqual(changes.added, [
      { id: 'PI_stage', type: 'cmmn:PlanItem', stage: 'Handle a claim' },
      { id: 'Stage_review', type: 'cmmn:Stage', name: 'Second review', stage: 'Handle a claim' }
    ]);
    assert.deepEqual(changes.removed, []);
    assert.equal(changes.shapesMoved, 0, 'a new shape is not a moved one');
  });

  test('lists removed elements', async () => {
    const changes = await diffModels(withStage(CLAIM), CLAIM);

    assert.deepEqual(changes.removed.map(element => element.id), ['PI_stage', 'Stage_review']);
  });

  test('lists changed names, attributes and events, before and after', async () => {
    const changed = CLAIM
      .replace('Approve the claim', 'Sign off the claim')
      .replace('flowable:candidateGroups="managers"', 'flowable:candidateGroups="seniors"')
      .replace('<cmmn:standardEvent>complete</cmmn:standardEvent>', '<cmmn:standardEvent>exit</cmmn:standardEvent>');
    const changes = await diffModels(CLAIM, changed);

    assert.deepEqual(changes.changed, [
      { id: 'OnPart_reviewed', type: 'cmmn:PlanItemOnPart', stage: 'Handle a claim', changes: { event: ['complete', 'exit'] } },
      {
        id: 'Task_approve',
        type: 'cmmn:HumanTask',
        name: 'Sign off the claim',
        stage: 'Handle a claim',
        changes: { name: ['Approve the claim', 'Sign off the claim'], 'flowable:candidateGroups': ['managers', 'seniors'] }
      }
    ]);
  });

  test('counts shapes that moved without listing the diagram', async () => {
    const moved = CLAIM.replace('<dc:Bounds x="150" y="150" width="100" height="80"/>', '<dc:Bounds x="170" y="150" width="100" height="80"/>');
    const changes = await diffModels(CLAIM, moved);

    assert.equal(changes.shapesMoved, 1);
    assert.deepEqual([changes.added, changes.removed, changes.changed], [[], [], []]);
  });

  test('describes the changes as lines', async () => {
    const changes = await diffModels(CLAIM, withStage(CLAIM).replace('Approve the claim', 'Sign off the claim'));

    assert.equal(describeChanges(changes), [
      '- added plan item PI_stage in Handle a claim',
      '- added stage Stage_review "Second review" in Handle a claim',
      '- changed human task Task_approve "Sign off the claim" in Handle a claim: name: "Approve the claim" → "Sign off the claim"'
    ].join('\n'));
  });
});

describe('the changes the user saves', () => {
  let folder;
  let registryDir;
  let views;
  let view;

  before(async () => {
    folder = await mkdtemp(join(tmpdir(), 'cmmn-lens-'));
    registryDir = join(folder, 'registry');
    await copyFile(FIXTURE, join(folder, 'claim.cmmn'));
    views = new ViewServer({ baseDir: folder, isRegistered: true, registryDir, projectDir: folder });
    view = await views.open('claim.cmmn');
  });

  after(async () => {
    await views.close();
    await rm(folder, { recursive: true });
  });

  async function save(xml) {
    const url = new URL(view.url);

    url.pathname += '/save';

    const before = await readFile(join(folder, 'claim.cmmn'));
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ xml, baseVersion: versionOf(before) })
    });

    assert.equal(response.status, 200);
  }

  function runHook(env = {}) {
    return new Promise((resolve, reject) => {
      const child = execFile(process.execPath, [HOOK], {
        env: { ...process.env, CMMN_LENS_REGISTRY_DIR: registryDir, CLAUDE_PROJECT_DIR: folder, ...env },
        timeout: 5000
      }, (error, stdout) => (error ? reject(error) : resolve(stdout)));

      child.stdin.end(JSON.stringify({ cwd: folder, prompt: 'what did I change?' }));
    });
  }

  test('get_changes says which stage the user added, once', async () => {
    await save(withStage(CLAIM));

    const [change] = await views.takeUserChanges();

    assert.match(change.text, /^- added plan item PI_stage in Handle a claim\n- added stage Stage_review "Second review"/);
    assert.match(formatChanges([change], views.baseDir), /^The user saved changes to claim\.cmmn in the viewer at /);
    assert.deepEqual(await views.takeUserChanges(), [], 'each change is returned once');
    assert.equal(formatChanges([], views.baseDir), 'The user has saved no changes in the viewer since you last looked.');
  });

  test('a save that changes nothing is not reported', async () => {
    await save(await readFile(join(folder, 'claim.cmmn'), 'utf8'));

    assert.deepEqual(await views.takeUserChanges(), []);
  });

  test('the prompt hook reports the change, once, even with the selection option off', async () => {
    await save(CLAIM);

    const output = JSON.parse(await runHook({ CLAUDE_PLUGIN_OPTION_SELECTION_CONTEXT: 'false' }));

    assert.match(output.hookSpecificOutput.additionalContext,
      /^The user changed claim\.cmmn in the cmmn-lens viewer and saved it \(read the file again before editing it\):\n- removed plan item PI_stage/);
    assert.equal(await runHook({ CLAUDE_PLUGIN_OPTION_SELECTION_CONTEXT: 'false' }), '');
  });

  test('the changes endpoint needs the token', async () => {
    assert.equal((await fetch(new URL(`/changes?t=${'0'.repeat(48)}`, view.url))).status, 403);
  });
});
