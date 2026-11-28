import { DmnModdle } from 'dmn-moddle';
import { migrateDiagram } from '@bpmn-io/dmn-migrate';

import { rootNamespace } from '../namespace.js';

/** The DMN model namespaces Flowable reads: DMN 1.3, 1.2 and 1.1. */
export const DMN_13_NS = 'https://www.omg.org/spec/DMN/20191111/MODEL/';
export const DMN_NAMESPACES = [DMN_13_NS, 'http://www.omg.org/spec/DMN/20180521/MODEL/', 'http://www.omg.org/spec/DMN/20151101/dmn.xsd'];

/**
 * Parses DMN XML as the viewer reads it. DMN 1.1 and 1.2 are migrated to
 * DMN 1.3 first, as dmn-js does on import. Attributes and extension elements
 * in Flowable's namespaces are kept untyped (docs/dmn-flowable-extensions.md).
 * Rejects when the XML doesn't parse.
 *
 * @param {string} xml
 * @returns {Promise<{ rootElement: object, elementsById: Record<string, object>, warnings: object[], isMigrated: boolean }>}
 */
export async function parseDmn(xml) {
  const namespace = rootNamespace(xml);
  const isMigrated = Boolean(namespace) && namespace !== DMN_13_NS && DMN_NAMESPACES.includes(namespace);
  const source = isMigrated ? await migrateDiagram(xml) : xml;
  const result = await new DmnModdle().fromXML(source, 'dmn:Definitions');

  return { ...result, isMigrated };
}

/** The id an href (`#Decision_1`) points at. */
export function hrefId(reference) {
  const href = reference?.href;

  return typeof href === 'string' && href.startsWith('#') ? href.slice(1) : undefined;
}

/**
 * The elements that have a shape or edge in the decision requirements
 * diagram, and the diagram elements by id with the element each draws.
 *
 * @param {object} definitions
 */
export function drawnElements(definitions) {
  const drawn = new Set();
  const diagramElements = new Map();
  const diagrams = definitions.dmnDI?.diagrams ?? [];

  for (const diagram of diagrams) {
    for (const element of diagram.diagramElements ?? []) {
      if (element.dmnElementRef) {
        drawn.add(element.dmnElementRef);
        diagramElements.set(element.id, element.dmnElementRef);
      }
    }
  }

  return { drawn, diagramElements, hasDiagram: diagrams.length > 0 };
}

/** The decision an element belongs to (a table, its inputs, outputs, rules and entries), if any. */
export function decisionOf(element) {
  let parent = element.$parent;

  while (parent && !parent.$instanceOf?.('dmn:Decision')) {
    parent = parent.$parent;
  }

  return parent ?? null;
}
