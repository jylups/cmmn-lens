import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { copyFile, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describeSelection } from '../src/selection.js';
import { ViewServer } from '../src/views.js';

const FIXTURES = join(import.meta.dirname, 'fixtures');
const CLAIM_PATH = join(FIXTURES, 'claim.cmmn');
const CLAIM = await readFile(CLAIM_PATH, 'utf8');

describe('describeSelection', () => {
  test('describes a plan item through its task, criteria and stage', async () => {
    const [item] = await describeSelection(CLAIM, ['PI_approve']);

    assert.deepEqual(item, {
      id: 'PI_approve',
      type: 'cmmn:PlanItem',
      line: 13,
      column: 7,
      definition: {
        id: 'Task_approve',
        type: 'cmmn:HumanTask',
        name: 'Approve the claim',
        attributes: { 'flowable:candidateGroups': 'managers' }
      },
      entryCriteria: [{
        id: 'Entry_approve',
        sentry: {
          id: 'Sentry_reviewed',
          onParts: [{ source: 'PI_review', sourceName: 'Review the claim', event: 'complete' }]
        }
      }],
      stage: { id: 'CasePlanModel_claim', name: 'Handle a claim' }
    });
  });

  test('describes a criterion with the item it belongs to and its sentry', async () => {
    const [criterion] = await describeSelection(CLAIM, ['Entry_handled']);

    assert.equal(criterion.type, 'cmmn:EntryCriterion');
    assert.deepEqual(criterion.planItem, { id: 'PI_handled', name: 'Claim handled' });
    assert.deepEqual(criterion.sentry.onParts, [{ source: 'PI_approve', sourceName: 'Approve the claim', event: 'complete' }]);
  });

  test('describes an on part by its source and event', async () => {
    const [onPart] = await describeSelection(CLAIM, ['OnPart_reviewed']);

    assert.equal(onPart.type, 'cmmn:PlanItemOnPart');
    assert.equal(onPart.source, 'PI_review');
    assert.equal(onPart.event, 'complete');
  });

  test('names the case plan model as such, with its attributes', async () => {
    const [model] = await describeSelection(CLAIM, ['CasePlanModel_claim']);

    assert.equal(model.type, 'casePlanModel');
    assert.equal(model.name, 'Handle a claim');
    assert.deepEqual(model.attributes, { 'flowable:formKey': 'claimForm' });
    assert.equal(model.stage, undefined);
  });

  test('marks an id the file no longer has', async () => {
    assert.deepEqual(await describeSelection(CLAIM, ['PI_gone']), [{ id: 'PI_gone', isMissing: true }]);
  });

  test('rejects XML that does not parse', async () => {
    await assert.rejects(describeSelection(CLAIM.slice(0, 500), ['PI_approve']));
  });
});

describe('posting the selection', () => {
  let folder;
  let views;
  let view;

  before(async () => {
    folder = await mkdtemp(join(tmpdir(), 'cmmn-lens-'));
    await copyFile(CLAIM_PATH, join(folder, 'claim.cmmn'));
    await copyFile(CLAIM_PATH, join(folder, 'other.cmmn'));
    views = new ViewServer({ baseDir: folder });
    view = await views.open('claim.cmmn');
  });

  after(async () => {
    await views.close();
    await rm(folder, { recursive: true });
  });

  function selectionUrl(viewUrl, token) {
    const url = new URL(viewUrl);

    url.pathname += '/selection';

    if (token !== undefined) {
      url.searchParams.set('t', token);
    }

    return url;
  }

  function post(url, body, type = 'application/json') {
    return fetch(url, { method: 'POST', headers: { 'Content-Type': type }, body });
  }

  test('starts with nothing selected', async () => {
    assert.deepEqual(await views.selection(), { path: view.path, name: 'claim.cmmn', ids: [], at: 0 });
  });

  test('stores the ids a page posts, once each', async () => {
    const response = await post(selectionUrl(view.url), JSON.stringify({ ids: ['PI_approve', 'PI_approve', 'Entry_handled'] }));

    assert.equal(response.status, 204);
    assert.deepEqual((await views.selection('claim.cmmn')).ids, ['PI_approve', 'Entry_handled']);
  });

  test('refuses a post without the token, or of the wrong kind', async () => {
    assert.equal((await post(selectionUrl(view.url, '0'.repeat(48)), '{"ids":[]}')).status, 403);
    assert.equal((await post(selectionUrl(view.url), '{"ids":[]}', 'text/plain')).status, 415);
    assert.equal((await post(selectionUrl(view.url), 'not json')).status, 400);
    assert.equal((await post(selectionUrl(view.url), '{"ids":[1]}')).status, 400);
    assert.equal((await post(selectionUrl(view.url), JSON.stringify({ ids: ['x'.repeat(70 * 1024)] }))).status, 413);
    assert.equal((await fetch(selectionUrl(view.url))).status, 405);

    assert.deepEqual((await views.selection('claim.cmmn')).ids, ['PI_approve', 'Entry_handled']);
  });

  test('without a path, reads the view whose selection changed last', async () => {
    const other = await views.open('other.cmmn');

    await post(selectionUrl(other.url), JSON.stringify({ ids: ['PI_review'] }));
    assert.equal((await views.selection()).name, 'other.cmmn');

    await post(selectionUrl(view.url), JSON.stringify({ ids: [] }));
    const latest = await views.selection();

    assert.equal(latest.name, 'claim.cmmn');
    assert.deepEqual(latest.ids, []);
    assert.ok(latest.at > 0);
  });

  test('answers null for a file with no view', async () => {
    const empty = new ViewServer({ baseDir: folder });

    assert.equal(await empty.selection(), null);
    assert.equal(await views.selection(CLAIM_PATH), null);
  });
});
