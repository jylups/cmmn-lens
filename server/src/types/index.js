import cmmn from './cmmn.js';

/**
 * @typedef {object} ValidationResult
 * @property {boolean} isValid whether the file has no errors (it may still have warnings)
 * @property {number} errorCount
 * @property {number} warningCount
 * @property {import('../validate.js').Problem[]} problems
 */

/**
 * @typedef {object} HighlightIds
 * @property {string[]} drawn the ids to mark, once each
 * @property {string[]} unknown ids the file doesn't have
 * @property {string[]} undrawn ids of elements the diagram doesn't show
 */

/**
 * What the server needs from a kind of model file. Everything that depends on
 * the kind of model is here, so a new kind is one module added to
 * MODEL_TYPES.
 *
 * @typedef {object} ModelType
 * @property {string} id short and lower case, `cmmn`; the page and the tools report it
 * @property {string} label how messages name it, `CMMN`
 * @property {string[]} extensions file name endings that make a file this type,
 *   lower case, with the dot: `.cmmn`, `.bpmn20.xml`
 * @property {string[]} namespaces the root element namespaces that make an
 *   `.xml` file this type
 * @property {(xml: string) => Promise<object>} parse reads the model; rejects when it doesn't parse
 * @property {(xml: string) => Promise<ValidationResult>} validate
 * @property {(xml: string, ids: string[]) => Promise<object[]>} describeSelection
 *   one description per id, `{ id, isMissing: true }` for an id the file doesn't have
 * @property {(beforeXml: string, afterXml: string) => Promise<object>} diff
 *   what changed between two versions
 * @property {(changes: object) => boolean} isEmpty whether a diff found nothing
 * @property {(changes: object) => string} describeChanges a diff as lines of text for the agent
 * @property {(xml: string, ids: string[]) => Promise<HighlightIds>} resolveDrawnIds
 *   maps ids the agent points at to the ids the viewer draws
 * @property {PageSetup} page what the viewer page loads for this type
 * @property {Record<string, string>} assets the files the page loads, by their
 *   URL path (`/assets/…`), each a path under public/
 */

/**
 * What the viewer page loads for a model type. The page's following,
 * selection, highlight, properties, save and conflict handling are shared;
 * this is the part that differs.
 *
 * @typedef {object} PageSetup
 * @property {string[]} styles stylesheets of the viewer, loaded with the page
 * @property {string[]} scripts scripts of the viewer, loaded with the page
 * @property {string} viewer the global the viewer scripts define: a viewer
 *   class built on diagram-js, with importXML, saveXML and get(service)
 * @property {boolean} callbacks importXML and saveXML take callbacks (cmmn-js);
 *   false when they return promises (bpmn-js, dmn-js)
 * @property {Record<string, string>} moddleExtensions descriptors the page
 *   fetches and passes to the viewer, by name
 * @property {{ script: string, styles: string[], global: string }} [editor]
 *   the editor bundle, loaded on Edit: its global is `{ Modeler, modules,
 *   options?({ canvas, properties }) }`; without it the page has no Edit button
 */

/** @type {ModelType[]} */
export const MODEL_TYPES = [cmmn];

/** The model type with an id, if there is one. */
export function modelType(id) {
  return MODEL_TYPES.find(type => type.id === id) ?? null;
}

/**
 * The model type a file name says, by its ending; null when the name doesn't
 * say (an `.xml` file, which needs its root element looked at, or another file).
 *
 * @param {string} name
 * @param {ModelType[]} [types]
 */
export function typeByName(name, types = MODEL_TYPES) {
  const lower = name.toLowerCase();
  let found = null;

  // the longest ending wins, so `.bpmn20.xml` is BPMN rather than plain XML
  for (const type of types) {
    for (const extension of type.extensions) {
      if (lower.endsWith(extension) && (!found || extension.length > found.extension.length)) {
        found = { type, extension };
      }
    }
  }

  return found?.type ?? null;
}

/**
 * The model type of XML by its root element's namespace; null when no type
 * claims it.
 *
 * @param {string} xml the file, or its start
 * @param {ModelType[]} [types]
 */
export function typeByContent(xml, types = MODEL_TYPES) {
  const namespace = rootNamespace(xml);

  return namespace ? types.find(type => type.namespaces.includes(namespace)) ?? null : null;
}

/**
 * The namespace of the root element of XML, `<definitions xmlns="…">` or
 * `<cmmn:definitions xmlns:cmmn="…">`; null when there is none to find.
 *
 * @param {string} xml the document, or enough of its start to hold the root tag
 * @returns {string|null}
 */
export function rootNamespace(xml) {
  const body = xml
    .replace(/^\uFEFF/, '')
    .replace(/<\?[\s\S]*?\?>/g, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<!DOCTYPE[^>[]*(\[[\s\S]*?\])?\s*>/i, '');
  const tag = /<(?:([A-Za-z_][\w.-]*):)?[A-Za-z_][\w.-]*((?:\s+[^\s=>/]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*\/?>/.exec(body);

  if (!tag) {
    return null;
  }

  const [, prefix, attributes] = tag;
  const name = prefix ? `xmlns:${prefix}` : 'xmlns';

  for (const match of attributes.matchAll(/([^\s=]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) {
    if (match[1] === name) {
      return match[2] ?? match[3];
    }
  }

  return null;
}

/**
 * The files the tools open, for messages and tool descriptions:
 * `CMMN (.cmmn, or .xml with a CMMN root element)`.
 *
 * @param {ModelType[]} [types]
 */
export function describeAccepted(types = MODEL_TYPES) {
  return types.map(type => {
    const endings = [...type.extensions];

    if (type.namespaces.length) {
      endings.push(`.xml with a ${type.label} root element`);
    }

    return `${type.label} (${endings.join(', or ')})`;
  }).join('; ');
}

/** `CMMN`, `CMMN or BPMN`, `CMMN, BPMN or DMN`. */
export function typeLabels(types = MODEL_TYPES) {
  const labels = types.map(type => type.label);

  return labels.length > 1 ? `${labels.slice(0, -1).join(', ')} or ${labels.at(-1)}` : labels[0];
}
