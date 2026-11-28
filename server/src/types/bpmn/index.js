import { describeChanges, diffModels, isEmpty } from '../../changes.js';
import { locate } from '../../moddle.js';
import { attributesOf as readAttributes } from '../../selection.js';
import { shapeProblems, validateXml } from '../../validate.js';
import { BPMN_NS, containerOf, drawnElements, parseBpmn } from './moddle.js';

/** The elements the viewer draws only when the diagram (BPMNDI) has a shape or edge for them. */
const DRAWN_TYPES = [
  'bpmn:FlowNode',
  'bpmn:SequenceFlow',
  'bpmn:Participant',
  'bpmn:Lane',
  'bpmn:MessageFlow',
  'bpmn:DataObjectReference',
  'bpmn:DataStoreReference',
  'bpmn:TextAnnotation',
  'bpmn:Association',
  'bpmn:Group'
];

/** The attributes set in the file, references included (bpmn-moddle keeps them non-enumerable). */
function attributesOf(element) {
  return readAttributes(element, { hiddenReferences: true });
}

/** The references an event definition makes to a root element: a message, signal, error or escalation. */
const DEFINITION_REFS = ['messageRef', 'signalRef', 'errorRef', 'escalationRef'];

const validation = {
  parse: parseBpmn,
  missingFromDiagram(definitions, elementsById, xml) {
    const { drawn, hasDiagram } = drawnElements(definitions);

    return shapeProblems({
      elementsById,
      drawn,
      drawnTypes: DRAWN_TYPES,
      hasDiagram,
      noDiagram: 'The file has no diagram (BPMNDI), so the viewer shows nothing. Add shapes for the flow elements and edges for the sequence flows.',
      xml
    });
  }
};

const diffing = {
  parse: parseBpmn,
  diagram: /^(bpmndi|di|dc):/,
  shape: /^bpmndi:BPMN(Shape|Edge)$/,
  typeOf: element => element.$type,
  attributesOf,
  containerOf: element => {
    const container = containerOf(element);

    return container ? container.name ?? container.id : undefined;
  },
  containerKeyOf: element => containerOf(element)?.id
};

/**
 * Describes the selected elements of a BPMN file as it is now: id, type, name,
 * attributes (Flowable ones included), extension elements, documentation, the
 * flows in and out of a flow node, a sequence flow's ends and condition, an
 * event's definitions, and the lane and process or sub-process it is in.
 *
 * @param {string} xml
 * @param {string[]} ids
 * @returns {Promise<object[]>}
 */
export async function describeSelection(xml, ids) {
  const { elementsById } = await parseBpmn(xml);
  const all = Object.values(elementsById);
  const context = {
    lanes: all.filter(element => element.$instanceOf('bpmn:Lane')),
    // Flowable files rarely list a node's <incoming> and <outgoing>, so the
    // flows are found by their ends
    flows: all.filter(element => element.$instanceOf('bpmn:SequenceFlow'))
  };

  return ids.map(id => {
    const element = elementsById[id];

    return element ? describe(element, xml, context) : { id, isMissing: true };
  });
}

function describe(element, xml, { lanes, flows }) {
  const details = { ...basics(element), ...locate(xml, element.id) };
  const documentation = (element.documentation ?? []).map(doc => doc.text?.trim()).filter(Boolean).join('\n');

  if (documentation) {
    details.documentation = documentation;
  }

  if (element.$instanceOf('bpmn:FlowNode')) {
    const incoming = flows.filter(flow => flow.targetRef === element).map(flow => ({ id: flow.id, ...named('from', flow.sourceRef) }));
    const outgoing = flows.filter(flow => flow.sourceRef === element).map(flow => ({
      id: flow.id,
      ...named('to', flow.targetRef),
      ...condition(flow),
      ...(element.default === flow ? { isDefault: true } : {})
    }));

    if (incoming.length) {
      details.incoming = incoming;
    }

    if (outgoing.length) {
      details.outgoing = outgoing;
    }

    const lane = lanes.find(candidate => (candidate.flowNodeRef ?? []).includes(element));

    if (lane) {
      details.lane = lane.name ? { id: lane.id, name: lane.name } : { id: lane.id };
    }
  }

  if (element.$instanceOf('bpmn:SequenceFlow')) {
    Object.assign(details, named('from', element.sourceRef), named('to', element.targetRef), condition(element));

    if (element.sourceRef?.default === element) {
      details.isDefault = true;
    }
  }

  const definitions = (element.eventDefinitions ?? []).map(definition => {
    const result = { type: definition.$type };
    const attributes = attributesOf(definition);

    if (Object.keys(attributes).length) {
      result.attributes = attributes;
    }

    for (const key of ['timeDate', 'timeDuration', 'timeCycle', 'condition']) {
      const body = definition[key]?.body?.trim();

      if (body) {
        result[key] = body;
      }
    }

    return result;
  });

  if (definitions.length) {
    details.eventDefinitions = definitions;
  }

  const container = containerOf(element);

  if (container) {
    details.container = container;
  }

  return details;
}

function basics(element) {
  const details = { id: element.id, type: element.$type };

  if (element.name) {
    details.name = element.name;
  }

  const attributes = attributesOf(element);

  if (Object.keys(attributes).length) {
    details.attributes = attributes;
  }

  const extensions = element.extensionElements?.values?.map(value => value.$type) ?? [];

  if (extensions.length) {
    details.extensionElements = extensions;
  }

  return details;
}

/** `{ from: { id, name } }`, for a flow's end. */
function named(key, element) {
  if (!element?.id) {
    return {};
  }

  return { [key]: element.name ? { id: element.id, name: element.name } : { id: element.id } };
}

function condition(flow) {
  const body = flow.conditionExpression?.body?.trim();

  return body ? { condition: body } : {};
}

/**
 * Maps ids to the elements the viewer draws: an element with a shape or edge
 * is itself; a diagram shape or edge is the element it draws; a process is
 * drawn as the pools (participants) that show it; an event definition as its
 * event; a message, signal, error or escalation as the events that refer to it.
 *
 * @param {string} xml
 * @param {string[]} ids
 * @returns {Promise<import('../index.js').HighlightIds>}
 */
export async function resolveDrawnIds(xml, ids) {
  const { rootElement, elementsById } = await parseBpmn(xml);
  const { drawn, diagramElements } = drawnElements(rootElement);
  const elements = Object.values(elementsById);
  const result = { drawn: [], unknown: [], undrawn: [] };

  const add = element => {
    if (element.id && !result.drawn.includes(element.id)) {
      result.drawn.push(element.id);
    }
  };

  for (const id of ids) {
    const element = diagramElements.get(id) ?? elementsById[id];

    if (!element) {
      result.unknown.push(id);
      continue;
    }

    if (drawn.has(element)) {
      add(element);
      continue;
    }

    let users;

    if (element.$instanceOf('bpmn:Process')) {
      users = elements.filter(other => other.$instanceOf('bpmn:Participant') && other.processRef === element);
    } else if (element.$instanceOf('bpmn:EventDefinition')) {
      users = element.$parent ? [element.$parent] : [];
    } else {
      users = elements.filter(other =>
        (other.eventDefinitions ?? []).some(definition => DEFINITION_REFS.some(key => definition[key] === element))
      );
    }

    users = users.filter(user => drawn.has(user));

    if (users.length) {
      users.forEach(add);
    } else {
      result.undrawn.push(id);
    }
  }

  return result;
}

/**
 * BPMN process models (Flowable deploys `.bpmn20.xml` and `.bpmn` files), read
 * with the Flowable descriptor as the viewer reads them.
 *
 * @type {import('../index.js').ModelType}
 */
export default {
  id: 'bpmn',
  label: 'BPMN',
  extensions: ['.bpmn', '.bpmn20.xml'],
  namespaces: [BPMN_NS],
  parse: parseBpmn,
  validate: xml => validateXml(xml, validation),
  describeSelection,
  diff: (beforeXml, afterXml) => diffModels(beforeXml, afterXml, diffing),
  isEmpty,
  describeChanges,
  resolveDrawnIds,
  page: {
    styles: [
      '/assets/bpmn/diagram-js.css',
      '/assets/bpmn/bpmn-js.css',
      '/assets/bpmn/bpmn-embedded.css',
      '/assets/bpmn/flowable-bpmn-js.css'
    ],
    scripts: ['/assets/bpmn/flowable-bpmn-navigated-viewer.js'],
    viewer: 'FlowableBpmnJS',
    callbacks: false,
    // the Flowable descriptor is built into flowable-bpmn-js
    moddleExtensions: {},
    editor: {
      script: '/assets/build/bpmn/editor.js',
      styles: ['/assets/bpmn/properties-panel.css', '/assets/bpmn/bpmn-js-bpmnlint.css', '/assets/bpmn/flowable-bpmn-js-touch.css'],
      global: 'BpmnLensEditor'
    }
  },
  assets: {
    '/assets/bpmn/flowable-bpmn-navigated-viewer.js': 'vendor/bpmn/flowable-bpmn-navigated-viewer.js',
    '/assets/bpmn/diagram-js.css': 'vendor/bpmn/diagram-js.css',
    '/assets/bpmn/bpmn-js.css': 'vendor/bpmn/bpmn-js.css',
    '/assets/bpmn/bpmn-embedded.css': 'vendor/bpmn/bpmn-embedded.css',
    '/assets/bpmn/flowable-bpmn-js.css': 'vendor/bpmn/flowable-bpmn-js.css',
    '/assets/bpmn/flowable-bpmn-js-touch.css': 'vendor/bpmn/flowable-bpmn-js-touch.css',
    '/assets/bpmn/properties-panel.css': 'vendor/bpmn/properties-panel.css',
    '/assets/bpmn/bpmn-js-bpmnlint.css': 'vendor/bpmn/bpmn-js-bpmnlint.css',
    '/assets/build/bpmn/editor.js': 'build/bpmn/editor.js'
  }
};
