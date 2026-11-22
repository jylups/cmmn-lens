import { parseCmmn } from './moddle.js';

/**
 * Maps ids an agent wants to point at to the ids of elements the viewer
 * draws: an element with a shape or edge is itself; a task, stage, milestone
 * or other plan item definition is drawn as the plan items that use it; a
 * sentry as the criteria that use it; a diagram shape or edge as the element
 * it draws.
 *
 * @param {string} xml
 * @param {string[]} ids
 * @returns {Promise<{ drawn: string[], unknown: string[], undrawn: string[] }>}
 *   `drawn`: the ids to mark, once each; `unknown`: ids the file doesn't have;
 *   `undrawn`: ids of elements the diagram doesn't show
 */
export async function resolveDrawnIds(xml, ids) {
  const { rootElement, elementsById } = await parseCmmn(xml);
  const drawn = new Set();
  const diagramElements = new Map();

  for (const diagram of rootElement.CMMNDI?.diagrams ?? []) {
    for (const element of diagram.diagramElements ?? []) {
      if (element.cmmnElementRef) {
        drawn.add(element.cmmnElementRef);
        diagramElements.set(element.id, element.cmmnElementRef);
      }
    }
  }

  const elements = Object.values(elementsById);
  const result = { drawn: [], unknown: [], undrawn: [] };

  const add = element => {
    if (element.id && !result.drawn.includes(element.id)) {
      result.drawn.push(element.id);
    }
  };

  for (const id of ids) {
    const fromDiagram = diagramElements.get(id);
    const element = fromDiagram ?? elementsById[id];

    if (!element) {
      result.unknown.push(id);
      continue;
    }

    if (drawn.has(element)) {
      add(element);
      continue;
    }

    let users = [];

    if (element.$instanceOf('cmmn:PlanItemDefinition')) {
      users = elements.filter(other =>
        (other.$instanceOf('cmmn:PlanItem') || other.$instanceOf('cmmn:DiscretionaryItem')) && other.definitionRef === element
      );
    } else if (element.$instanceOf('cmmn:Sentry')) {
      users = elements.filter(other => other.$instanceOf('cmmn:Criterion') && other.sentryRef === element);
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
