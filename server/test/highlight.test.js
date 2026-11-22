import { afterEach, beforeEach, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { copyFile, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { versionOf } from '../src/follow.js';
import { resolveDrawnIds } from '../src/highlight.js';
import { formatHighlight } from '../src/mcp.js';
import { ViewServer } from '../src/views.js';
import { eventsUrl, openEvents } from './helpers/events.js';

const FIXTURE = join(import.meta.dirname, 'fixtures', 'claim.cmmn');
const CLAIM = await readFile(FIXTURE, 'utf8');

describe('resolveDrawnIds', () => {
  test('marks drawn elements as themselves, once each', async () => {
    assert.deepEqual(await resolveDrawnIds(CLAIM, ['PI_review', 'OnPart_approved', 'CasePlanModel_claim', 'PI_review']), {
      drawn: ['PI_review', 'OnPart_approved', 'CasePlanModel_claim'],
      unknown: [],
      undrawn: []
    });
  });

  test('marks a task through its plan item and a sentry through its criterion', async () => {
    assert.deepEqual((await resolveDrawnIds(CLAIM, ['Task_approve', 'Sentry_reviewed'])).drawn, ['PI_approve', 'Entry_approve']);
  });

  test('marks a diagram shape as the element it draws', async () => {
    assert.deepEqual((await resolveDrawnIds(CLAIM, ['DI_PI_handled'])).drawn, ['PI_handled']);
  });

  test('reports ids the file does not have, and elements the diagram does not draw', async () => {
    const xml = CLAIM.replace(/<cmmndi:CMMNShape id="DI_PI_approve"[\s\S]*?<\/cmmndi:CMMNShape>/, '');

    assert.deepEqual(await resolveDrawnIds(xml, ['Nope', 'Task_approve', 'PI_review']), {
      drawn: ['PI_review'],
      unknown: ['Nope'],
      undrawn: ['Task_approve']
    });
  });
});

describe('ViewServer.highlight', () => {
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

  test('answers null when no view is open', async () => {
    assert.equal(await views.highlight(undefined, ['PI_review']), null);
  });

  test('sends the marks to the page with the version of the file they apply to', async () => {
    const view = await views.open('claim.cmmn');

    events = await openEvents(eventsUrl(view.url));
    await events.next('state');

    const result = await views.highlight(undefined, ['Task_approve']);

    assert.deepEqual(result.drawn, ['PI_approve']);
    assert.deepEqual(await events.next('highlight'), { ids: ['PI_approve'], version: versionOf(CLAIM) });
  });

  test('sends the current marks to a page that connects later, until the file changes', async () => {
    const view = await views.open('claim.cmmn');

    await views.highlight('claim.cmmn', ['PI_review']);

    events = await openEvents(eventsUrl(view.url));
    assert.deepEqual((await events.next('highlight')).ids, ['PI_review']);
    events.close();

    await writeFile(file, CLAIM.replace('Review the claim', 'Check the claim'));

    events = await openEvents(eventsUrl(view.url));
    await events.next('state');

    // the change is seen after a short settling time
    await new Promise(resolve => setTimeout(resolve, 300));
    events.close();

    events = await openEvents(eventsUrl(view.url));
    await events.next('state');
    await assert.rejects(events.next('highlight', 300), /no highlight event/);
  });

  test('an empty list clears the marks', async () => {
    const view = await views.open('claim.cmmn');

    events = await openEvents(eventsUrl(view.url));
    await views.highlight(undefined, []);

    assert.deepEqual((await events.next('highlight')).ids, []);
  });
});

describe('formatHighlight', () => {
  const base = { path: '/work/claim.cmmn', name: 'claim.cmmn' };

  test('says what was marked and what could not be', () => {
    assert.equal(
      formatHighlight({ ...base, drawn: ['PI_approve'], unknown: ['Nope'], undrawn: ['Task_x'] }, '/work', undefined, ['Task_approve', 'Nope', 'Task_x']),
      'Highlighted PI_approve in claim.cmmn. Not in the file: Nope. Not drawn in the diagram: Task_x.'
    );
  });

  test('says when the marks were cleared or no viewer is open', () => {
    assert.equal(formatHighlight({ ...base, drawn: [], unknown: [], undrawn: [] }, '/work', undefined, []), 'Cleared the highlight in claim.cmmn.');
    assert.equal(formatHighlight(null, '/work', undefined, ['x']), 'No viewer is open. Open one with open_view.');
  });
});
