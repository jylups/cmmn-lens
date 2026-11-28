import { BpmnModdle } from 'bpmn-moddle';
import flowable, { migrateActivitiXML, registerUnknownFlowableElements } from '@jylups/flowable-bpmn-moddle';

/** The BPMN 2.0 model namespace, which a BPMN file's root element is in. */
export const BPMN_NS = 'http://www.omg.org/spec/BPMN/20100524/MODEL';

/**
 * Parses BPMN XML as the viewer reads it: with the Flowable descriptor, the
 * Activiti namespace read as Flowable, and Flowable elements the descriptor
 * doesn't define kept. Rejects when the XML doesn't parse.
 *
 * @param {string} xml
 * @returns {Promise<{ rootElement: object, elementsById: Record<string, object>, warnings: object[] }>}
 */
export function parseBpmn(xml) {
  const moddle = new BpmnModdle({ flowable });
  // only xmlns declarations change, so lines and ids stay where they are
  const migrated = migrateActivitiXML(xml);

  registerUnknownFlowableElements(moddle, migrated);

  return moddle.fromXML(migrated, 'bpmn:Definitions');
}

/**
 * The elements that have a shape or edge in a diagram, and the diagram
 * elements by id with the element each draws.
 *
 * @param {object} definitions
 * @returns {{ drawn: Set<object>, diagramElements: Map<string, object>, hasDiagram: boolean }}
 */
export function drawnElements(definitions) {
  const drawn = new Set();
  const diagramElements = new Map();
  const diagrams = definitions.diagrams ?? [];

  for (const diagram of diagrams) {
    for (const element of diagram.plane?.planeElement ?? []) {
      if (element.bpmnElement) {
        drawn.add(element.bpmnElement);
        diagramElements.set(element.id, element.bpmnElement);
      }
    }
  }

  return { drawn, diagramElements, hasDiagram: diagrams.length > 0 };
}

/** The process, sub-process or lane an element sits in, as `{ id, name? }`. */
export function containerOf(element) {
  let parent = element.$parent;

  while (parent && !parent.$instanceOf?.('bpmn:SubProcess') && !parent.$instanceOf?.('bpmn:Process')) {
    parent = parent.$parent;
  }

  if (!parent?.id) {
    return null;
  }

  return parent.name ? { id: parent.id, name: parent.name } : { id: parent.id };
}
