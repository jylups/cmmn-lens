import { parseCmmn } from './moddle.js';
import { attributesOf, typeOf as cmmnTypeOf } from './selection.js';

/**
 * How the diff reads one kind of model.
 *
 * @typedef {object} DiffDialect
 * @property {(xml: string) => Promise<{ elementsById: Record<string, object> }>} parse
 * @property {RegExp} diagram the types of diagram elements, which aren't listed
 * @property {RegExp} shape the types of shapes and edges whose moves are counted
 * @property {(element: object) => string} typeOf the type reported for an element
 * @property {(element: object) => string|undefined} containerOf the name or id
 *   of what an element sits in (in CMMN its stage), reported as `stage`
 * @property {(element: object) => Record<string, unknown>} attributesOf the
 *   attributes compared
 */

/** @type {DiffDialect} */
const CMMN = {
  parse: parseCmmn,
  diagram: /^(cmmndi|di|dc):/,
  shape: /^cmmndi:CMMN(Shape|Edge)$/,
  typeOf: cmmnTypeOf,
  attributesOf,
  containerOf: element => nearest(element, parent => parent.$instanceOf?.('cmmn:Stage'))
};

/**
 * @typedef {object} ElementRef
 * @property {string} id
 * @property {string} type the CMMN type (`cmmn:Stage`); `casePlanModel` for the case plan model
 * @property {string} [name]
 * @property {string} [stage] the name or id of the stage it is in
 */

/**
 * @typedef {object} ModelChanges
 * @property {ElementRef[]} added
 * @property {ElementRef[]} removed
 * @property {Array<ElementRef & { changes: Record<string, [unknown, unknown]> }>} changed
 *   each changed property as [before, after]; `name`, `stage` (moved to
 *   another stage) and attributes, references as the id they point at
 * @property {number} shapesMoved diagram shapes and edges that were moved,
 *   resized or reshaped, without a change to the model
 */

/**
 * The element-level difference between two versions of a model. Diagram
 * elements (shapes, edges, labels) are not listed; their layout changes are
 * counted in `shapesMoved`.
 *
 * @param {string} beforeXml
 * @param {string} afterXml
 * @param {DiffDialect} [dialect] CMMN unless given
 * @returns {Promise<ModelChanges>}
 */
export async function diffModels(beforeXml, afterXml, dialect = CMMN) {
  const [before, after] = await Promise.all([dialect.parse(beforeXml), dialect.parse(afterXml)]);
  const beforeModel = modelElements(before.elementsById, dialect);
  const afterModel = modelElements(after.elementsById, dialect);
  const changes = { added: [], removed: [], changed: [], shapesMoved: 0 };

  for (const [id, element] of afterModel) {
    const old = beforeModel.get(id);

    if (!old) {
      changes.added.push(ref(element, dialect));
      continue;
    }

    const differences = compare(old, element, dialect);

    if (Object.keys(differences).length) {
      changes.changed.push({ ...ref(element, dialect), changes: differences });
    }
  }

  for (const [id, element] of beforeModel) {
    if (!afterModel.has(id)) {
      changes.removed.push(ref(element, dialect));
    }
  }

  changes.shapesMoved = countMovedShapes(before.elementsById, after.elementsById, dialect);

  return changes;
}

/** Whether a diff found nothing. */
export function isEmpty(changes) {
  return !changes.added.length && !changes.removed.length && !changes.changed.length && !changes.shapesMoved;
}

/**
 * The changes as sentences, for the agent: one line each for added, removed
 * and changed elements, and one for layout.
 *
 * @param {ModelChanges} changes
 * @returns {string}
 */
export function describeChanges(changes) {
  const lines = [];
  const label = element => {
    const type = typeLabel(element.type);
    const name = element.name ? ` "${element.name}"` : '';
    const where = element.stage ? ` in ${element.stage}` : '';

    return `${type} ${element.id}${name}${where}`;
  };

  for (const element of changes.added) {
    lines.push(`- added ${label(element)}`);
  }

  for (const element of changes.removed) {
    lines.push(`- removed ${label(element)}`);
  }

  for (const element of changes.changed) {
    const details = Object.entries(element.changes)
      .map(([name, [from, to]]) => `${name}: ${show(from)} → ${show(to)}`)
      .join('; ');

    lines.push(`- changed ${label(element)}: ${details}`);
  }

  if (changes.shapesMoved) {
    lines.push(`- moved or resized ${changes.shapesMoved} shape${changes.shapesMoved === 1 ? '' : 's'} in the diagram`);
  }

  return lines.join('\n');
}

function show(value) {
  return value === undefined ? '(none)' : JSON.stringify(value);
}

/** `cmmn:HumanTask` → "human task"; `casePlanModel` → "case plan model". */
function typeLabel(type) {
  return String(type).replace(/^[a-z]+:/, '').replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase();
}

/** The model's own elements by id: everything with an id outside the diagram. */
function modelElements(elementsById, dialect) {
  const elements = new Map();

  for (const [id, element] of Object.entries(elementsById)) {
    if (!dialect.diagram.test(element.$type)) {
      elements.set(id, element);
    }
  }

  return elements;
}

/** The name or id of the nearest parent that `matches`. */
export function nearest(element, matches) {
  let parent = element.$parent;

  while (parent && !matches(parent)) {
    parent = parent.$parent;
  }

  return parent ? parent.name ?? parent.id : undefined;
}

function ref(element, dialect) {
  const result = { id: element.id, type: dialect.typeOf(element) };

  if (element.name) {
    result.name = element.name;
  }

  const stage = dialect.containerOf(element);

  if (stage) {
    result.stage = stage;
  }

  return result;
}

function compare(old, element, dialect) {
  const differences = {};

  if (old.$type !== element.$type) {
    differences.type = [old.$type, element.$type];
  }

  if (old.name !== element.name) {
    differences.name = [old.name, element.name];
  }

  if (old.standardEvent !== element.standardEvent) {
    differences.event = [old.standardEvent, element.standardEvent];
  }

  const [stageBefore, stageAfter] = [dialect.containerOf(old), dialect.containerOf(element)];

  if (stageBefore !== stageAfter) {
    differences.stage = [stageBefore, stageAfter];
  }

  const before = dialect.attributesOf(old);
  const after = dialect.attributesOf(element);

  for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) {
    if (before[key] !== after[key]) {
      differences[key] = [before[key], after[key]];
    }
  }

  const bodyBefore = textBodies(old);
  const bodyAfter = textBodies(element);

  if (bodyBefore !== bodyAfter) {
    differences.content = [bodyBefore || undefined, bodyAfter || undefined];
  }

  return differences;
}

/** The text the element holds directly: a condition's or an expression's body, documentation. */
function textBodies(element) {
  const parts = [];

  for (const key of ['body', 'text', 'script']) {
    if (typeof element[key] === 'string') {
      parts.push(element[key].trim());
    }
  }

  for (const key of ['condition', 'ifPart', 'conditionExpression', 'completionCondition']) {
    const nested = element[key];

    if (nested && typeof nested === 'object') {
      parts.push(textBodies(nested));
    }
  }

  return parts.filter(Boolean).join(' | ');
}

/** Diagram shapes and edges whose bounds or waypoints differ between the versions. */
function countMovedShapes(beforeById, afterById, dialect) {
  let count = 0;

  for (const [id, element] of Object.entries(afterById)) {
    if (!dialect.shape.test(element.$type)) {
      continue;
    }

    const old = beforeById[id];

    if (old && geometry(old) !== geometry(element)) {
      count++;
    }
  }

  return count;
}

function geometry(element) {
  const bounds = element.bounds;
  const points = (element.waypoint ?? []).map(point => `${point.x},${point.y}`).join(' ');

  return bounds ? `${bounds.x},${bounds.y},${bounds.width},${bounds.height}|${points}` : points;
}
