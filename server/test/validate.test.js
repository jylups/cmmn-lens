import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { validateFile, validateXml } from '../src/validate.js';

const FIXTURES = join(import.meta.dirname, 'fixtures');
const CLAIM = await readFile(join(FIXTURES, 'claim.cmmn'), 'utf8');

/** The claim fixture with each [from, to] replacement applied once. */
function claimWith(...replacements) {
  return replacements.reduce((xml, [from, to]) => {
    assert.ok(xml.includes(from), `the fixture contains ${from}`);

    return xml.replace(from, to);
  }, CLAIM);
}

function lineOf(xml, text) {
  return xml.slice(0, xml.indexOf(text)).split('\n').length;
}

describe('validateXml', () => {
  test('finds no problems in a correct model', async () => {
    assert.deepEqual(await validateXml(CLAIM), { isValid: true, errorCount: 0, warningCount: 0, problems: [] });
  });

  test('finds no errors in the flowable-cmmn-moddle fixtures', async () => {
    const folder = join(FIXTURES, 'flowable-cmmn-moddle');
    const files = (await readdir(folder)).filter(file => file.endsWith('.cmmn'));

    assert.ok(files.length >= 4);

    for (const file of files) {
      const result = await validateFile(join(folder, file));

      assert.equal(result.errorCount, 0, `${file}: ${JSON.stringify(result.problems)}`);
    }
  });

  test('reports a broken reference with the element that holds it', async () => {
    const xml = claimWith(['definitionRef="Task_approve"', 'definitionRef="Task_gone"']);
    const result = await validateXml(xml);

    assert.equal(result.isValid, false);
    assert.deepEqual(result.problems, [{
      level: 'error',
      message: 'unresolved reference <Task_gone>',
      elementId: 'PI_approve',
      property: 'cmmn:definitionRef',
      value: 'Task_gone',
      line: lineOf(xml, 'id="PI_approve"'),
      column: 7
    }]);
  });

  test('reports a diagram shape that points at a missing element', async () => {
    const xml = claimWith(['cmmnElementRef="PI_handled"', 'cmmnElementRef="PI_gone"']);
    const { problems } = await validateXml(xml);

    // the shape's reference is broken, and the plan item it drew has no shape now
    assert.deepEqual(problems.map(problem => [problem.level, problem.elementId]), [
      ['warning', 'PI_handled'],
      ['error', 'DI_PI_handled']
    ]);
    assert.match(problems[0].message, /PlanItem PI_handled \("Claim handled"\) has no shape in the diagram/);
  });

  test('reports a duplicate id with its line', async () => {
    const xml = claimWith(['<cmmn:milestone id="Milestone_handled"', '<cmmn:milestone id="Task_review"']);
    const duplicate = (await validateXml(xml)).problems.find(problem => /duplicate ID/.test(problem.message));

    assert.equal(duplicate.level, 'error');
    assert.equal(duplicate.elementId, 'Task_review');
    assert.equal(duplicate.line, lineOf(xml, '<cmmn:milestone id="Task_review"'));
  });

  test('reports XML that does not parse, with its line and column', async () => {
    const xml = CLAIM.slice(0, CLAIM.indexOf('</cmmn:standardEvent>') + 5);
    const result = await validateXml(xml);

    assert.equal(result.isValid, false);
    assert.equal(result.problems.length, 1);
    assert.match(result.problems[0].message, /unclosed tag/);
    assert.equal(result.problems[0].line, xml.split('\n').length);
    assert.ok(result.problems[0].column > 1);
  });

  test('warns about an attribute nobody reads', async () => {
    const xml = claimWith(['flowable:candidateGroups="managers"', 'flowable:candidateGrups="managers"']);
    const result = await validateXml(xml);

    assert.equal(result.isValid, true);
    assert.deepEqual(result.problems, [{
      level: 'warning',
      message: 'unknown attribute <flowable:candidateGrups>',
      elementId: 'Task_approve',
      property: 'flowable:candidateGrups',
      value: 'managers',
      line: lineOf(xml, 'id="Task_approve"'),
      column: 7
    }]);
  });

  test('names the nearest element with an id for a problem on one without', async () => {
    const xml = claimWith([
      '<dc:Bounds x="150" y="150" width="100" height="80"/>\n        <cmmndi:CMMNLabel/>',
      '<dc:Bounds x="150" y="150" width="100" height="80"/>\n        <cmmndi:CMMNLabel flowable:tilt="1"/>'
    ]);
    const [problem] = (await validateXml(xml)).problems;

    assert.equal(problem.elementId, 'DI_PI_review');
    assert.equal(problem.message, 'unknown attribute <flowable:tilt> (on its cmmndi:CMMNLabel)');
  });

  test('warns once when the file has no diagram at all', async () => {
    const xml = CLAIM.replace(/<cmmndi:CMMNDI>[\s\S]*<\/cmmndi:CMMNDI>\n/, '');
    const result = await validateXml(xml);

    assert.equal(result.isValid, true);
    assert.equal(result.problems.length, 1);
    assert.match(result.problems[0].message, /no diagram \(CMMNDI\)/);
  });
});
