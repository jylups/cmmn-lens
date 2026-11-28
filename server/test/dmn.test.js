import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { copyFile, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import dmn from '../src/types/dmn/index.js';
import { versionOf } from '../src/follow.js';
import { ViewServer } from '../src/views.js';

const FIXTURE = join(import.meta.dirname, 'fixtures', 'discount.dmn');
const DISCOUNT = await readFile(FIXTURE, 'utf8');

/** A small DMN 1.2 file, as older Flowable versions and tools write them. */
const DMN_12 = `<?xml version="1.0" encoding="UTF-8"?>
<definitions xmlns="http://www.omg.org/spec/DMN/20180521/MODEL/" id="definitions_old" name="Old" namespace="http://www.flowable.org/dmn">
  <decision id="Decision_old" name="Old decision">
    <decisionTable id="Table_old">
      <input id="Input_age" label="Age">
        <inputExpression id="Expression_age" typeRef="number"><text>age</text></inputExpression>
      </input>
      <output id="Output_adult" name="adult" typeRef="boolean"/>
      <rule id="Rule_adult">
        <inputEntry id="Entry_age"><text>&gt;= 18</text></inputEntry>
        <outputEntry id="Entry_adult"><text>true</text></outputEntry>
      </rule>
    </decisionTable>
  </decision>
</definitions>
`;

describe('DMN validation', () => {
  test('a Flowable DMN file with its diagram has no problems; Flowable and Design extensions are kept without warnings', async () => {
    assert.deepEqual(await dmn.validate(DISCOUNT), { isValid: true, errorCount: 0, warningCount: 0, problems: [] });
  });

  test('warns about a decision with no shape, and a file with no diagram', async () => {
    const noShape = await dmn.validate(DISCOUNT.replace(/<dmndi:DMNShape id="Shape_message"[\s\S]*?<\/dmndi:DMNShape>/, ''));

    assert.deepEqual(noShape.problems.map(problem => problem.elementId), ['Decision_message']);

    const noDiagram = await dmn.validate(DMN_12);

    assert.equal(noDiagram.isValid, true);
    assert.match(noDiagram.problems[0].message, /no decision requirements diagram \(DMNDI\)/);
  });

  test('reports XML that does not parse and duplicate ids', async () => {
    const broken = await dmn.validate(DISCOUNT.replace('</decisionTable>', ''));
    const duplicate = await dmn.validate(DISCOUNT.replace('id="Rule_large"', 'id="Rule_gold"'));

    assert.equal(broken.isValid, false);
    assert.equal(duplicate.isValid, false);
    assert.ok(duplicate.problems.some(problem => problem.elementId === 'Rule_gold'));
  });

  test('reads DMN 1.2 by migrating it to DMN 1.3, as Flowable and dmn-js read it', async () => {
    const [rule] = await dmn.describeSelection(DMN_12, ['Rule_adult']);

    assert.deepEqual(rule.when, [{ input: 'Age', test: '>= 18' }]);
    assert.deepEqual(rule.then, [{ output: 'adult', value: 'true' }]);
  });
});

describe('DMN selection', () => {
  test('describes a decision with its table, requirements and Flowable attribute', async () => {
    const [decision] = await dmn.describeSelection(DISCOUNT, ['Decision_discount']);

    assert.deepEqual(decision, {
      id: 'Decision_discount',
      type: 'dmn:Decision',
      name: 'Discount',
      attributes: { 'flowable:forceDMN11': 'true' },
      line: 15,
      column: 3,
      decisionTable: {
        id: 'Table_discount',
        hitPolicy: 'FIRST',
        inputs: [
          { id: 'Input_type', label: 'Customer type', expression: 'customerType', typeRef: 'string' },
          { id: 'Input_total', label: 'Order total', expression: 'orderTotal', typeRef: 'number' }
        ],
        outputs: [{ id: 'Output_discount', label: 'Discount', name: 'discount', typeRef: 'number' }],
        ruleCount: 3
      },
      requires: [{ inputData: 'InputData_customer' }],
      requiredBy: [{ id: 'Decision_message', name: 'Discount message' }]
    });
  });

  test('describes a rule with its entries under their inputs and outputs', async () => {
    const [rule] = await dmn.describeSelection(DISCOUNT, ['Rule_gold']);

    assert.equal(rule.number, 1);
    assert.equal(rule.description, 'Gold customers always get 10%');
    assert.deepEqual(rule.when, [{ input: 'Customer type', test: '== "gold"' }, { input: 'Order total', test: '-' }]);
    assert.deepEqual(rule.then, [{ output: 'Discount', value: '0.10' }]);
    assert.deepEqual(rule.decision, { id: 'Decision_discount', name: 'Discount' });
  });

  test('describes input data, a table input, a literal expression decision and a missing id', async () => {
    const [input, clause, message, missing] = await dmn.describeSelection(DISCOUNT, ['InputData_customer', 'Input_total', 'Decision_message', 'Gone']);

    assert.equal(input.typeRef, 'string');
    assert.deepEqual(input.requiredBy, [{ id: 'Decision_discount', name: 'Discount' }]);
    assert.deepEqual([clause.label, clause.expression, clause.typeRef], ['Order total', 'orderTotal', 'number']);
    assert.equal(message.literalExpression.text, 'discount > 0 ? \'You get a discount\' : \'No discount\'');
    assert.deepEqual(message.requires, [{ decision: 'Decision_discount' }]);
    assert.deepEqual(missing, { id: 'Gone', isMissing: true });
  });
});

describe('DMN changes and highlight', () => {
  test('lists a changed rule entry by its rule, and a renamed decision without moving what is in it', async () => {
    const changed = DISCOUNT
      .replace('&gt;= 1000', '&gt;= 500')
      .replace('name="Discount message"', 'name="Message"')
      .replace('x="420" y="170"', 'x="430" y="170"');

    assert.equal(dmn.describeChanges(await dmn.diff(DISCOUNT, changed)), [
      '- changed unary tests Entry_large_total in Discount, rule 2: content: ">= 1000" → ">= 500"',
      '- changed decision Decision_message "Message": name: "Discount message" → "Message"',
      '- moved or resized 1 shape in the diagram'
    ].join('\n'));
  });

  test('resolves diagram ids, and a table\'s parts to themselves and their decision', async () => {
    assert.deepEqual(await dmn.resolveDrawnIds(DISCOUNT, ['Shape_customer', 'Rule_large', 'Entry_gold_type', 'Input_total', 'Variable_customer', 'Nope']), {
      drawn: ['InputData_customer', 'Rule_large', 'Decision_discount', 'Rule_gold', 'Input_total'],
      unknown: ['Nope'],
      undrawn: ['Variable_customer']
    });
  });
});

describe('a DMN view', () => {
  let folder;
  let views;
  let view;

  before(async () => {
    folder = await mkdtemp(join(tmpdir(), 'cmmn-lens-'));
    await copyFile(FIXTURE, join(folder, 'discount.dmn'));
    views = new ViewServer({ baseDir: folder });
    view = await views.open('discount.dmn');
  });

  after(async () => {
    await views.close();
    await rm(folder, { recursive: true, force: true });
  });

  test('opens as DMN and its page loads the dmn-js viewer', async () => {
    const html = await (await fetch(view.url)).text();
    const config = JSON.parse(/<script id="cmmn-lens-config" type="application\/json">(.*?)<\/script>/.exec(html)[1]);

    assert.equal(view.type, 'dmn');
    assert.deepEqual([config.type, config.viewer, config.callbacks, config.editor.global], ['dmn', 'DmnJS', false, 'DmnLensEditor']);
    assert.match(html, /<script src="\/assets\/dmn\/dmn-navigated-viewer\.js"><\/script>/);

    for (const path of ['/assets/dmn/dmn-navigated-viewer.js', '/assets/dmn/dmn-js-decision-table.css', '/assets/build/dmn/editor.js', '/assets/dmn/properties-panel.css']) {
      assert.equal((await fetch(new URL(path, view.url))).status, 200, path);
    }
  });

  test('keeps what a save from the page changed, as DMN changes', async () => {
    const saveUrl = new URL(view.url);

    saveUrl.pathname += '/save';

    const response = await fetch(saveUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ xml: DISCOUNT.replace('<text>0.05</text>', '<text>0.07</text>'), baseVersion: versionOf(DISCOUNT) })
    });

    assert.equal(response.status, 200);

    const [change] = await views.takeUserChanges('discount.dmn');

    assert.equal(change.text, '- changed literal expression Entry_large_discount in Discount, rule 2: content: "0.05" → "0.07"');
  });
});
