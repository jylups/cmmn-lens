import { parseCmmn } from './moddle.js';
import { attributesOf, typeOf } from './selection.js';

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
 * @returns {Promise<ModelChanges>}
 */
export async function diffModels(beforeXml, afterXml) {
  const [before, after] = await Promise.all([parseCmmn(beforeXml), parseCmmn(afterXml)]);
  const beforeModel = modelElements(before.elementsById);
  const afterModel = modelElements(after.elementsById);
  const changes = { added: [], removed: [], changed: [], shapesMoved: 0 };

  for (const [id, element] of afterModel) {
    const old = beforeModel.get(id);

    if (!old) {
      changes.added.push(ref(element));
      continue;
    }

    const differences = compare(old, element);

    if (Object.keys(differences).length) {
      changes.changed.push({ ...ref(element), changes: differences });
    }
  }

  for (const [id, element] of beforeModel) {
    if (!afterModel.has(id)) {
      changes.removed.push(ref(element));
    }
  }

  changes.shapesMoved = countMovedShapes(before.elementsById, after.elementsById);

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
function modelElements(elementsById) {
  const elements = new Map();

  for (const [id, element] of Object.entries(elementsById)) {
    if (!isDiagram(element)) {
      elements.set(id, element);
    }
  }

  return elements;
}

function isDiagram(element) {
  return /^(cmmndi|di|dc):/.test(element.$type);
}

function stageOf(element) {
  let parent = element.$parent;

  while (parent && !parent.$instanceOf?.('cmmn:Stage')) {
    parent = parent.$parent;
  }

  return parent ? parent.name ?? parent.id : undefined;
}

function ref(element) {
  const result = { id: element.id, type: typeOf(element) };

  if (element.name) {
    result.name = element.name;
  }

  const stage = stageOf(element);

  if (stage) {
    result.stage = stage;
  }

  return result;
}

function compare(old, element) {
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

  if (stageOf(old) !== stageOf(element)) {
    differences.stage = [stageOf(old), stageOf(element)];
  }

  const before = attributesOf(old);
  const after = attributesOf(element);

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

  for (const key of ['body', 'text']) {
    if (typeof element[key] === 'string') {
      parts.push(element[key].trim());
    }
  }

  for (const key of ['condition', 'ifPart']) {
    const nested = element[key];

    if (nested && typeof nested === 'object') {
      parts.push(textBodies(nested));
    }
  }

  return parts.filter(Boolean).join(' | ');
}

/** Diagram shapes and edges whose bounds or waypoints differ between the versions. */
function countMovedShapes(beforeById, afterById) {
  let count = 0;

  for (const [id, element] of Object.entries(afterById)) {
    if (!/^cmmndi:CMMN(Shape|Edge)$/.test(element.$type)) {
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
