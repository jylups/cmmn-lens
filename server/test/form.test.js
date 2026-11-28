import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { copyFile, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import form from '../src/types/form/index.js';
import { versionOf } from '../src/follow.js';
import { ViewServer } from '../src/views.js';

const FIXTURE = join(import.meta.dirname, 'fixtures', 'request.form');
const REQUEST = await readFile(FIXTURE, 'utf8');

describe('form validation', () => {
  test('a form-js schema with unique ids and keys has no problems', async () => {
    assert.deepEqual(await form.validate(REQUEST), { isValid: true, errorCount: 0, warningCount: 0, problems: [] });
  });

  test('reports two fields bound to the same key, counting a group\'s path', async () => {
    const result = await form.validate(REQUEST.replace('"key": "to"', '"key": "from"'));

    assert.equal(result.isValid, false);
    assert.deepEqual(result.problems.map(problem => [problem.elementId, problem.value, problem.line]), [['Field_to', 'dates.from', 49]]);
    assert.match(result.problems[0].message, /uses the key "dates\.from", which datetime Field_from \("From"\) uses too/);

    // the same key inside and outside the group is two different values
    assert.equal((await form.validate(REQUEST.replace('"key": "note"', '"key": "from"'))).isValid, true);
  });

  test('reports duplicate ids, a keyed field without a key, and warns about unknown types', async () => {
    const result = await form.validate(REQUEST
      .replace('"id": "Field_to"', '"id": "Field_from"')
      .replace('"key": "leaveType",', '')
      .replace('"type": "textarea"', '"type": "richtext"'));

    assert.deepEqual(result.problems.map(problem => [problem.level, problem.elementId]), [
      ['error', 'Field_type'],
      ['error', 'Field_from'],
      ['warning', 'Field_note']
    ]);
  });

  test('reports JSON that does not parse, with its line, and JSON that is not a form', async () => {
    const broken = await form.validate(REQUEST.replace('"label": "Dates",', '"label": "Dates"'));
    const notForm = await form.validate('{ "type": "default" }');

    assert.equal(broken.isValid, false);
    assert.equal(broken.problems[0].line, 31);
    assert.match(notForm.problems[0].message, /no "components" list/);
  });
});

describe('form selection', () => {
  test('describes a field with its full key, settings and group', async () => {
    const [from] = await form.describeSelection(REQUEST, ['Field_from']);

    assert.deepEqual(from, {
      id: 'Field_from',
      type: 'datetime',
      name: 'From',
      key: 'dates.from',
      properties: { subtype: 'date', dateLabel: 'From', validate: { required: true } },
      line: 39,
      column: 11,
      container: { id: 'Group_dates', name: 'Dates' }
    });
  });

  test('describes a group with its children, a conditional field, the form and a missing id', async () => {
    const [group, note, schema, missing] = await form.describeSelection(REQUEST, ['Group_dates', 'Field_note', 'Form_leave', 'Gone']);

    assert.deepEqual(group.components.map(child => child.id), ['Field_from', 'Field_to']);
    assert.deepEqual(note.properties.conditional, { hide: '=leaveType != "sick"' });
    assert.deepEqual([schema.type, schema.schemaVersion, schema.componentCount], ['form', 19, 8]);
    assert.deepEqual(missing, { id: 'Gone', isMissing: true });
  });
});

describe('form changes and highlight', () => {
  test('lists changed settings by field, a move to another group, and layout moves', async () => {
    const changed = REQUEST
      .replace('"Employee name"', '"Full name"')
      .replace('"maxLength": 80', '"maxLength": 120')
      .replace('"columns": 8', '"columns": 6');

    assert.equal(form.describeChanges(await form.diff(REQUEST, changed)), [
      '- changed textfield Field_name "Full name": label: "Employee name" → "Full name"; validate: {"required":true,"maxLength":80} → {"required":true,"maxLength":120}',
      '- moved 1 field in the form\'s layout (order, row or width)'
    ].join('\n'));
    assert.equal(form.isEmpty(await form.diff(REQUEST, REQUEST)), true);
  });

  test('resolves component ids and keys to the fields that show them', async () => {
    assert.deepEqual(await form.resolveDrawnIds(REQUEST, ['Field_note', 'dates.to', 'employeeName', 'Form_leave', 'nope']), {
      drawn: ['Field_note', 'Field_to', 'Field_name'],
      unknown: ['nope'],
      undrawn: ['Form_leave']
    });
  });
});

describe('a form view', () => {
  let folder;
  let views;
  let view;

  before(async () => {
    folder = await mkdtemp(join(tmpdir(), 'cmmn-lens-'));
    await copyFile(FIXTURE, join(folder, 'request.form'));
    views = new ViewServer({ baseDir: folder });
    view = await views.open('request.form');
  });

  after(async () => {
    await views.close();
    await rm(folder, { recursive: true, force: true });
  });

  test('opens as a form, read-only, and serves the file as JSON', async () => {
    const html = await (await fetch(view.url)).text();
    const config = JSON.parse(/<script id="cmmn-lens-config" type="application\/json">(.*?)<\/script>/.exec(html)[1]);
    const diagram = await fetch(new URL(config.diagramUrl, view.url));

    assert.equal(view.type, 'form');
    assert.deepEqual([config.format, config.viewer, config.editor.global], ['json', 'FormLensViewer', 'FormLensEditor']);
    assert.deepEqual(config.viewerOptions, { properties: { readOnly: true } });
    assert.match(diagram.headers.get('content-type'), /^application\/json/);

    for (const path of ['/assets/build/form/viewer.js', '/assets/build/form/editor.js', '/assets/form/form-js.css', '/assets/form/properties-panel.css']) {
      assert.equal((await fetch(new URL(path, view.url))).status, 200, path);
    }
  });

  test('keeps what a save from the page changed, as form changes', async () => {
    const saveUrl = new URL(view.url);

    saveUrl.pathname += '/save';

    const response = await fetch(saveUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ xml: REQUEST.replace('"Submit"', '"Send request"'), baseVersion: versionOf(REQUEST) })
    });

    assert.equal(response.status, 200);

    const [change] = await views.takeUserChanges('request.form');

    assert.equal(change.text, '- changed button Button_submit "Send request": label: "Submit" → "Send request"');
  });
});
