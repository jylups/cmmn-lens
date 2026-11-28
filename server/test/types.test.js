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
  test('CMMN, BPMN, DMN and forms are the model types every function of the server goes through', () => {
    assert.deepEqual(MODEL_TYPES.map(type => type.id), ['cmmn', 'bpmn', 'dmn', 'form']);
    assert.equal(modelType('cmmn').label, 'CMMN');
    assert.deepEqual(modelType('cmmn').namespaces, [CMMN_NS]);
    assert.deepEqual(modelType('bpmn').namespaces, ['http://www.omg.org/spec/BPMN/20100524/MODEL']);

    for (const type of MODEL_TYPES) {
      for (const name of ['parse', 'validate', 'describeSelection', 'diff', 'isEmpty', 'describeChanges', 'resolveDrawnIds']) {
        assert.equal(typeof type[name], 'function', `${type.id} ${name}`);
      }

      assert.ok(type.page.scripts.length && type.page.viewer, `${type.id} page`);
      assert.ok(type.page.scripts.every(src => type.assets[src]), `${type.id} serves its viewer scripts`);
    }

    assert.equal(modelType('sketch'), null);
  });

  test('a file name gives its type, the longest ending winning', () => {
    const types = [...MODEL_TYPES, sketch];

    assert.equal(typeByName('claim.cmmn').id, 'cmmn');
    assert.equal(typeByName('CLAIM.CMMN').id, 'cmmn');
    assert.equal(typeByName('claim.xml'), null);
    assert.equal(typeByName('holiday.bpmn').id, 'bpmn');
    assert.equal(typeByName('holiday.BPMN20.xml').id, 'bpmn');
    assert.equal(typeByName('rules.dmn').id, 'dmn');
    assert.equal(typeByName('request.form').id, 'form');
    assert.equal(typeByName('request.json'), null);
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
    assert.equal(typeByContent('<definitions xmlns="http://www.omg.org/spec/BPMN/20100524/MODEL"/>').id, 'bpmn');
    assert.equal(typeByContent('<definitions xmlns="http://www.omg.org/spec/DMN/20151101/dmn.xsd"/>').id, 'dmn');
    assert.equal(typeByContent('<definitions xmlns="urn:sketch"/>'), null);
    assert.equal(typeByContent('<definitions xmlns="urn:sketch"/>', [...MODEL_TYPES, sketch]).id, 'sketch');
  });

  test('messages and tool descriptions name the model types', () => {
    assert.equal(
      describeAccepted(),
      'CMMN (.cmmn, or .xml with a CMMN root element); BPMN (.bpmn, or .bpmn20.xml, or .xml with a BPMN root element); ' +
      'DMN (.dmn, or .xml with a DMN root element); form (.form)'
    );
    assert.equal(typeLabels(), 'CMMN, BPMN, DMN or form');
    assert.equal(typeLabels([modelType('cmmn')]), 'CMMN');
    assert.equal(typeLabels([modelType('cmmn'), modelType('bpmn')]), 'CMMN or BPMN');
  });

  test('a file resolves to its path and type: by name, or an .xml file by its root element', async () => {
    const folder = await realpath(await mkdtemp(join(tmpdir(), 'cmmn-lens-')));

    try {
      const claim = await readFile(CLAIM, 'utf8');

      await writeFile(join(folder, 'claim.cmmn'), claim);
      await writeFile(join(folder, 'claim.xml'), claim);
      await writeFile(join(folder, 'process.xml'), '<definitions xmlns="http://www.omg.org/spec/BPMN/20100524/MODEL"/>');
      await writeFile(join(folder, 'process.bpmn'), '<definitions xmlns="http://www.omg.org/spec/BPMN/20100524/MODEL"/>');
      await writeFile(join(folder, 'rules.xml'), '<definitions xmlns="https://www.omg.org/spec/DMN/20191111/MODEL/"/>');
      await writeFile(join(folder, 'other.xml'), '<form xmlns="urn:some-form"/>');
      await writeFile(join(folder, 'request.json'), '{"components": []}');
      await writeFile(join(folder, 'drawing.sketch.xml'), '<drawing/>');

      const byName = await resolveModelFile(folder, 'claim.cmmn');
      const byContent = await resolveModelFile(folder, 'claim.xml');

      assert.equal(byName.path, join(folder, 'claim.cmmn'));
      assert.equal(byName.type.id, 'cmmn');
      assert.equal(byContent.type.id, 'cmmn');

      assert.equal((await resolveModelFile(folder, 'process.xml')).type.id, 'bpmn');
      assert.equal((await resolveModelFile(folder, 'process.bpmn')).type.id, 'bpmn');
      assert.equal((await resolveModelFile(folder, 'rules.xml')).type.id, 'dmn');
      await assert.rejects(resolveModelFile(folder, 'other.xml'), /other\.xml is not a CMMN, BPMN, DMN or form file: its root element has no namespace the tools know/);
      await assert.rejects(resolveModelFile(folder, 'request.json'), /request\.json is not a CMMN, BPMN, DMN or form file: the tools open CMMN \(\.cmmn, or \.xml with a CMMN root element\); BPMN/);

      const withSketch = [...MODEL_TYPES, sketch];

      assert.equal((await resolveModelFile(folder, 'drawing.sketch.xml', withSketch)).type.id, 'sketch');
      await assert.rejects(resolveModelFile(folder, 'request.json', withSketch), /is not a CMMN, BPMN, DMN, form or Sketch file/);
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
