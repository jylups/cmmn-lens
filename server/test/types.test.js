import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { resolveModelFile } from '../src/paths.js';
import { MODEL_TYPES, describeAccepted, modelType, rootNamespace, typeByContent, typeByName, typeLabels } from '../src/types/index.js';
import { ViewServer } from '../src/views.js';

const CMMN_NS = 'http://www.omg.org/spec/CMMN/20151109/MODEL';
const CLAIM = join(import.meta.dirname, 'fixtures', 'claim.cmmn');

/** A second model type that exists only in the tests, to show one plugs in by itself. */
const sketch = {
  id: 'sketch',
  label: 'Sketch',
  extensions: ['.sketch', '.sketch.xml'],
  namespaces: ['urn:sketch'],
  parse: async xml => ({ xml }),
  validate: async () => ({ isValid: true, errorCount: 0, warningCount: 0, problems: [] }),
  describeSelection: async (xml, ids) => ids.map(id => ({ id, type: 'sketch:Shape' })),
  diff: async (before, after) => ({ isSame: before === after }),
  isEmpty: changes => changes.isSame,
  describeChanges: () => '- changed the sketch',
  resolveDrawnIds: async (xml, ids) => ({ drawn: ids, unknown: [], undrawn: [] })
};

describe('model types', () => {
  test('CMMN is the model type every function of the server goes through', () => {
    const cmmn = modelType('cmmn');

    assert.deepEqual(MODEL_TYPES.map(type => type.id), ['cmmn']);
    assert.equal(cmmn.label, 'CMMN');
    assert.deepEqual(cmmn.namespaces, [CMMN_NS]);

    for (const name of ['parse', 'validate', 'describeSelection', 'diff', 'isEmpty', 'describeChanges', 'resolveDrawnIds']) {
      assert.equal(typeof cmmn[name], 'function', name);
    }

    assert.equal(modelType('bpmn'), null);
  });

  test('a file name gives its type, the longest ending winning', () => {
    const types = [...MODEL_TYPES, sketch];

    assert.equal(typeByName('claim.cmmn').id, 'cmmn');
    assert.equal(typeByName('CLAIM.CMMN').id, 'cmmn');
    assert.equal(typeByName('claim.xml'), null);
    assert.equal(typeByName('claim.bpmn'), null);
    assert.equal(typeByName('a.sketch.xml', types).id, 'sketch');
    assert.equal(typeByName('a.xml', types), null);
  });

  test('an XML root element gives its namespace, prefixed or not', () => {
    assert.equal(rootNamespace(`<definitions xmlns="${CMMN_NS}" id="d"/>`), CMMN_NS);
    assert.equal(rootNamespace(`<?xml version="1.0"?>\n<!-- a comment <x xmlns="urn:no"> -->\n<cmmn:definitions\n  xmlns:cmmn='${CMMN_NS}' xmlns="urn:other">`), CMMN_NS);
    assert.equal(rootNamespace(`\uFEFF<!DOCTYPE definitions>\n<definitions xmlns:flowable="urn:f" xmlns="${CMMN_NS}">`), CMMN_NS);
    assert.equal(rootNamespace('<definitions id="d">'), null);
    assert.equal(rootNamespace('<cmmn:definitions xmlns="urn:x">'), null);
    assert.equal(rootNamespace('not xml at all'), null);
    assert.equal(rootNamespace(''), null);
  });

  test('XML content gives its type by the root namespace', async () => {
    assert.equal(typeByContent(await readFile(CLAIM, 'utf8')).id, 'cmmn');
    assert.equal(typeByContent('<definitions xmlns="urn:sketch"/>'), null);
    assert.equal(typeByContent('<definitions xmlns="urn:sketch"/>', [...MODEL_TYPES, sketch]).id, 'sketch');
  });

  test('messages and tool descriptions name the model types', () => {
    assert.equal(describeAccepted(), 'CMMN (.cmmn, or .xml with a CMMN root element)');
    assert.equal(typeLabels(), 'CMMN');
    assert.equal(typeLabels([...MODEL_TYPES, sketch]), 'CMMN or Sketch');
    assert.equal(typeLabels([...MODEL_TYPES, sketch, { ...sketch, label: 'Third' }]), 'CMMN, Sketch or Third');
  });

  test('a file resolves to its path and type: by name, or an .xml file by its root element', async () => {
    const folder = await realpath(await mkdtemp(join(tmpdir(), 'cmmn-lens-')));

    try {
      const claim = await readFile(CLAIM, 'utf8');

      await writeFile(join(folder, 'claim.cmmn'), claim);
      await writeFile(join(folder, 'claim.xml'), claim);
      await writeFile(join(folder, 'process.xml'), '<definitions xmlns="http://www.omg.org/spec/BPMN/20100524/MODEL"/>');
      await writeFile(join(folder, 'process.bpmn'), '<definitions xmlns="http://www.omg.org/spec/BPMN/20100524/MODEL"/>');
      await writeFile(join(folder, 'drawing.sketch.xml'), '<drawing/>');

      const byName = await resolveModelFile(folder, 'claim.cmmn');
      const byContent = await resolveModelFile(folder, 'claim.xml');

      assert.equal(byName.path, join(folder, 'claim.cmmn'));
      assert.equal(byName.type.id, 'cmmn');
      assert.equal(byContent.type.id, 'cmmn');

      await assert.rejects(resolveModelFile(folder, 'process.xml'), /process\.xml is not a CMMN file: its root element has no namespace the tools know/);
      await assert.rejects(resolveModelFile(folder, 'process.bpmn'), /process\.bpmn is not a CMMN file: the tools open CMMN \(\.cmmn, or \.xml with a CMMN root element\) files/);

      const withSketch = [...MODEL_TYPES, sketch];

      assert.equal((await resolveModelFile(folder, 'drawing.sketch.xml', withSketch)).type.id, 'sketch');
      await assert.rejects(resolveModelFile(folder, 'process.bpmn', withSketch), /is not a CMMN or Sketch file/);
    } finally {
      await rm(folder, { recursive: true, force: true });
    }
  });

  test('a view keeps its file\'s type and answers through it', async () => {
    const views = new ViewServer({ baseDir: import.meta.dirname });

    try {
      const view = await views.open(CLAIM);

      assert.equal(view.type, 'cmmn');

      const highlight = await views.highlight(CLAIM, ['Task_review']);

      assert.ok(highlight.drawn.length, 'the task is marked through its plan item');
    } finally {
      await views.close();
    }
  });
});
