import { locate, parseCmmn } from './moddle.js';

/**
 * @typedef {object} ElementDetails
 * @property {string} id
 * @property {string} [type] the CMMN type, `cmmn:PlanItem` say; the case plan
 *   model is `casePlanModel`
 * @property {string} [name]
 * @property {Record<string, string|number|boolean>} [attributes] the attributes set
 *   in the file, other than id and name, references as the id they point at
 * @property {string[]} [extensionElements] the types of the extension elements
 * @property {object} [definition] for a plan item or discretionary item: the
 *   task, stage, milestone or other item it is an instance of
 * @property {object[]} [entryCriteria] with each criterion's sentry
 * @property {object[]} [exitCriteria]
 * @property {object} [sentry] for a criterion
 * @property {{ id: string, name?: string }} [planItem] for a criterion: the item it belongs to
 * @property {{ id: string, name?: string }} [stage] the stage or case plan model it is in
 * @property {number} [line]
 * @property {boolean} [isMissing] the file no longer has an element with this id
 */

/**
 * Describes the selected elements from the file as it is now.
 *
 * @param {string} xml
 * @param {string[]} ids the selected elements' ids
 * @returns {Promise<ElementDetails[]>}
 */
export async function describeSelection(xml, ids) {
  const { elementsById } = await parseCmmn(xml);

  return ids.map(id => {
    const element = elementsById[id];

    return element ? describe(element, xml) : { id, isMissing: true };
  });
}

function describe(element, xml) {
  const details = {
    ...basics(element),
    ...locate(xml, element.id)
  };

  if (element.$instanceOf('cmmn:PlanItem') || element.$instanceOf('cmmn:DiscretionaryItem')) {
    const definition = element.definitionRef;

    if (definition) {
      details.definition = basics(definition);
    }

    addCriteria(details, element);
  }

  if (element.$instanceOf('cmmn:Criterion')) {
    const item = element.$parent;

    if (item?.id) {
      const name = item.name ?? item.definitionRef?.name;

      details.planItem = name ? { id: item.id, name } : { id: item.id };
    }

    if (element.sentryRef) {
      details.sentry = describeSentry(element.sentryRef);
    }
  }

  if (element.$instanceOf('cmmn:OnPart')) {
    Object.assign(details, describeOnPart(element));
  }

  const stage = parentStage(element);

  if (stage) {
    details.stage = stage;
  }

  return details;
}

/** The id, type, name, attributes and extension elements of an element. */
function basics(element) {
  const details = { id: element.id, type: typeOf(element) };

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

export function typeOf(element) {
  return element.$parent?.$instanceOf?.('cmmn:Case') && element.$instanceOf('cmmn:Stage') ? 'casePlanModel' : element.$type;
}

/** The attributes set in the file: the element's own values, and unknown attributes. */
export function attributesOf(element) {
  const attributes = {};

  for (const key of Object.keys(element)) {
    const property = element.$descriptor.propertiesByName[key];

    if (!property?.isAttr || key === 'id' || key === 'name') {
      continue;
    }

    const value = element[key];

    if (property.isReference) {
      if (value?.id) {
        attributes[property.ns.name] = value.id;
      }
    } else if (['string', 'number', 'boolean'].includes(typeof value)) {
      attributes[property.ns.name] = value;
    }
  }

  for (const [name, value] of Object.entries(element.$attrs ?? {})) {
    if (!name.startsWith('xmlns')) {
      attributes[name] = value;
    }
  }

  return attributes;
}

function addCriteria(details, item) {
  for (const key of ['entryCriteria', 'exitCriteria']) {
    const criteria = item[key] ?? [];

    if (criteria.length) {
      details[key] = criteria.map(criterion => ({
        id: criterion.id,
        ...(criterion.sentryRef ? { sentry: describeSentry(criterion.sentryRef) } : {})
      }));
    }
  }
}

/** A sentry's on parts and if part, in terms of plan item ids and events. */
function describeSentry(sentry) {
  const details = { id: sentry.id };

  if (sentry.name) {
    details.name = sentry.name;
  }

  const onParts = (sentry.onParts ?? []).map(describeOnPart);

  if (onParts.length) {
    details.onParts = onParts;
  }

  const condition = sentry.ifPart?.condition?.body;

  if (condition) {
    details.ifPart = condition.trim();
  }

  return details;
}

function describeOnPart(onPart) {
  const details = {};

  if (onPart.sourceRef?.id) {
    details.source = onPart.sourceRef.id;

    const name = onPart.sourceRef.name ?? onPart.sourceRef.definitionRef?.name;

    if (name) {
      details.sourceName = name;
    }
  }

  if (onPart.standardEvent) {
    details.event = onPart.standardEvent;
  }

  return details;
}

/** The stage or case plan model an element sits in. */
function parentStage(element) {
  let parent = element.$parent;

  while (parent && !parent.$instanceOf?.('cmmn:Stage')) {
    parent = parent.$parent;
  }

  if (!parent) {
    return null;
  }

  return parent.name ? { id: parent.id, name: parent.name } : { id: parent.id };
}
