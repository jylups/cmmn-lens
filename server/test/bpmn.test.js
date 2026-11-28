import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { copyFile, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import bpmn from '../src/types/bpmn/index.js';
import { versionOf } from '../src/follow.js';
import { ViewServer } from '../src/views.js';

const FIXTURE = join(import.meta.dirname, 'fixtures', 'holiday.bpmn20.xml');
const HOLIDAY = await readFile(FIXTURE, 'utf8');

describe('BPMN validation', () => {
  test('a Flowable process with a full diagram has no problems', async () => {
    assert.deepEqual(await bpmn.validate(HOLIDAY), { isValid: true, errorCount: 0, warningCount: 0, problems: [] });
  });

  test('reports a reference to nothing as an error, on its element and line', async () => {
    const result = await bpmn.validate(HOLIDAY.replace('targetRef="Task_book"', 'targetRef="Task_missing"'));
    const problem = result.problems.find(item => item.level === 'error');

    assert.equal(result.isValid, false);
    assert.equal(problem.elementId, 'Flow_approved');
    assert.equal(problem.line, 22);
    assert.match(problem.message, /unresolved reference <Task_missing>/);
  });

  test('warns about a flow element with no shape, and a file with no diagram', async () => {
    const noShape = await bpmn.validate(HOLIDAY.replace(/<bpmndi:BPMNShape id="Task_book_di"[\s\S]*?<\/bpmndi:BPMNShape>/, ''));

    assert.equal(noShape.isValid, true);
    assert.deepEqual(noShape.problems.map(problem => [problem.elementId, problem.message]), [
      ['Task_book', 'ServiceTask Task_book ("Book the days") has no shape in the diagram, so the viewer doesn\'t show it.']
    ]);

    const noDiagram = await bpmn.validate(HOLIDAY.replace(/<bpmndi:BPMNDiagram[\s\S]*<\/bpmndi:BPMNDiagram>/, ''));

    assert.equal(noDiagram.problems.length, 1);
    assert.match(noDiagram.problems[0].message, /no diagram \(BPMNDI\)/);
  });

  test('reports XML that does not parse, and duplicate ids', async () => {
    const broken = await bpmn.validate(HOLIDAY.replace('<endEvent id="End_approved" name="Booked"/>', '<endEvent id="End_approved" name="Booked">'));

    assert.equal(broken.isValid, false);
    assert.ok(broken.problems[0].line, 'the parse error has a line');

    const duplicate = await bpmn.validate(HOLIDAY.replace('id="End_rejected" name="Not booked"', 'id="End_approved" name="Not booked"'));

    assert.equal(duplicate.isValid, false);
    assert.ok(duplicate.problems.some(problem => problem.elementId === 'End_approved'));
  });

  test('reads the Activiti namespace as Flowable', async () => {
    const activiti = HOLIDAY.replace('xmlns:flowable="http://flowable.org/bpmn"', 'xmlns:activiti="http://activiti.org/bpmn"').replaceAll('flowable:', 'activiti:');
    const [task] = await bpmn.describeSelection(activiti, ['Task_approve']);

    assert.deepEqual((await bpmn.validate(activiti)).problems, []);
    assert.equal(task.attributes['flowable:formKey'], 'approve-holiday');
  });
});

describe('BPMN selection', () => {
  test('describes a user task with its Flowable attributes, listeners and flows', async () => {
    const [task] = await bpmn.describeSelection(HOLIDAY, ['Task_approve']);

    assert.deepEqual(task, {
      id: 'Task_approve',
      type: 'bpmn:UserTask',
      name: 'Approve or reject',
      attributes: {
        'flowable:candidateGroups': 'managers',
        'flowable:formKey': 'approve-holiday',
        'flowable:dueDate': 'P3D'
      },
      extensionElements: ['flowable:TaskListener'],
      line: 15,
      column: 5,
      incoming: [{ id: 'Flow_toApprove', from: { id: 'Start_request', name: 'Request received' } }],
      outgoing: [{ id: 'Flow_toDecision', to: { id: 'Gateway_decision', name: 'Approved?' } }],
      container: { id: 'holidayRequest', name: 'Holiday request' }
    });
  });

  test('describes a gateway\'s conditions and default, a flow\'s ends, and an event\'s definitions', async () => {
    const [gateway, flow, boundary, missing] = await bpmn.describeSelection(HOLIDAY, ['Gateway_decision', 'Flow_rejected', 'Boundary_cancel', 'Gone']);

    assert.deepEqual(gateway.outgoing, [
      { id: 'Flow_approved', to: { id: 'Task_book', name: 'Book the days' }, condition: '${approved}' },
      { id: 'Flow_rejected', to: { id: 'End_rejected', name: 'Not booked' }, isDefault: true }
    ]);
    assert.deepEqual([flow.from, flow.to, flow.isDefault], [{ id: 'Gateway_decision', name: 'Approved?' }, { id: 'End_rejected', name: 'Not booked' }, true]);
    assert.equal(boundary.attributes['bpmn:attachedToRef'], 'Task_approve');
    assert.deepEqual(boundary.eventDefinitions, [{ type: 'bpmn:MessageEventDefinition', attributes: { 'bpmn:messageRef': 'Message_cancel' } }]);
    assert.deepEqual(missing, { id: 'Gone', isMissing: true });
  });

  test('gives the process its documentation', async () => {
    const [process] = await bpmn.describeSelection(HOLIDAY, ['holidayRequest']);

    assert.equal(process.documentation, 'An employee asks for days off and a manager decides.');
  });
});

describe('BPMN changes and highlight', () => {
  test('lists renamed elements, changed conditions, rewired flows and moved shapes', async () => {
    const changed = HOLIDAY
      .replace('Book the days', 'Book the holiday')
      .replace('${approved}', '${approved == true}')
      .replace('sourceRef="Boundary_cancel" targetRef="End_rejected"', 'sourceRef="Boundary_cancel" targetRef="End_approved"')
      .replace('x="450" y="120"', 'x="460" y="120"');

    assert.equal(bpmn.describeChanges(await bpmn.diff(HOLIDAY, changed)), [
      '- changed sequence flow Flow_approved "yes" in Holiday request: content: "${approved}" → "${approved == true}"',
      '- changed service task Task_book "Book the holiday" in Holiday request: name: "Book the days" → "Book the holiday"',
      '- changed sequence flow Flow_cancelled in Holiday request: bpmn:targetRef: "End_rejected" → "End_approved"',
      '- moved or resized 1 shape in the diagram'
    ].join('\n'));
    assert.equal(bpmn.isEmpty(await bpmn.diff(HOLIDAY, HOLIDAY)), true);
  });

  test('resolves ids to drawn elements: shapes, diagram elements, definitions and the messages events use', async () => {
    assert.deepEqual(await bpmn.resolveDrawnIds(HOLIDAY, ['Task_book', 'Task_approve_di', 'Definition_cancel', 'Message_cancel', 'holidayRequest', 'Nope']), {
      drawn: ['Task_book', 'Task_approve', 'Boundary_cancel'],
      unknown: ['Nope'],
      undrawn: ['holidayRequest']
    });
  });
});

describe('a BPMN view', () => {
  let folder;
  let views;
  let view;

  before(async () => {
    folder = await mkdtemp(join(tmpdir(), 'cmmn-lens-'));
    await copyFile(FIXTURE, join(folder, 'holiday.bpmn20.xml'));
    views = new ViewServer({ baseDir: folder });
    view = await views.open('holiday.bpmn20.xml');
  });

  after(async () => {
    await views.close();
    await rm(folder, { recursive: true, force: true });
  });

  test('opens as BPMN and its page loads the BPMN viewer, not the CMMN one', async () => {
    const html = await (await fetch(view.url)).text();
    const config = JSON.parse(/<script id="cmmn-lens-config" type="application\/json">(.*?)<\/script>/.exec(html)[1]);

    assert.equal(view.type, 'bpmn');
    assert.equal(config.type, 'bpmn');
    assert.equal(config.viewer, 'FlowableBpmnJS');
    assert.equal(config.callbacks, false);
    assert.equal(config.editor.global, 'BpmnLensEditor');
    assert.match(html, /<script src="\/assets\/bpmn\/flowable-bpmn-navigated-viewer\.js"><\/script>/);
    assert.doesNotMatch(html, /cmmn-navigated-viewer|cmmn-embedded/);

    for (const path of ['/assets/bpmn/flowable-bpmn-navigated-viewer.js', '/assets/bpmn/bpmn-js.css', '/assets/build/bpmn/editor.js', '/assets/bpmn/properties-panel.css']) {
      assert.equal((await fetch(new URL(path, view.url))).status, 200, path);
    }
  });

  test('describes the selection and highlights through the BPMN type', async () => {
    const selectionUrl = new URL(view.url);

    selectionUrl.pathname += '/selection';

    await fetch(selectionUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ids: ['Flow_approved'] }) });

    const selection = await views.selectionDetails('holiday.bpmn20.xml');

    assert.equal(selection.elements[0].condition, '${approved}');
    assert.deepEqual((await views.highlight('holiday.bpmn20.xml', ['Message_cancel'])).drawn, ['Boundary_cancel']);
  });

  test('keeps what a save from the page changed, as BPMN changes', async () => {
    const saveUrl = new URL(view.url);

    saveUrl.pathname += '/save';

    const response = await fetch(saveUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ xml: HOLIDAY.replace('Not booked', 'Declined'), baseVersion: versionOf(HOLIDAY) })
    });

    assert.equal(response.status, 200);

    const [change] = await views.takeUserChanges('holiday.bpmn20.xml');

    assert.equal(change.text, '- changed end event End_rejected "Declined" in Holiday request: name: "Not booked" → "Declined"');
  });
});
