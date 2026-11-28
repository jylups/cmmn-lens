import { describeChanges, isEmpty } from '../../changes.js';

/**
 * The component types of form-js 1.x (the version the case management forms
 * use), and whether each binds a value by its `key`. Containers (`group`,
 * `dynamiclist`) can add a `path` to the keys inside them.
 */
const COMPONENT_TYPES = {
  textfield: { keyed: true },
  textarea: { keyed: true },
  number: { keyed: true },
  datetime: { keyed: true },
  expression: { keyed: true },
  filepicker: { keyed: true },
  checkbox: { keyed: true },
  checklist: { keyed: true },
  radio: { keyed: true },
  select: { keyed: true },
  taglist: { keyed: true },
  text: {},
  html: {},
  image: {},
  table: {},
  documentPreview: {},
  spacer: {},
  separator: {},
  iframe: {},
  button: {},
  group: { container: true },
  dynamiclist: { container: true }
};

/** Properties shown in a description or compared by the diff, apart from the ones read on their own. */
const SKIPPED = new Set(['id', 'type', 'components', 'layout']);

/**
 * Parses a form-js schema (JSON). Rejects with the line and column when the
 * JSON doesn't parse, and when it isn't a form (no `components` list).
 *
 * @param {string} text
 * @returns {Promise<{ rootElement: object, elementsById: Record<string, object>, warnings: object[] }>}
 */
export async function parseForm(text) {
  let schema;

  try {
    schema = JSON.parse(text);
  } catch (error) {
    throw new JsonError(error.message, text);
  }

  if (!schema || typeof schema !== 'object' || !Array.isArray(schema.components)) {
    throw new Error('not a form-js schema: it has no "components" list');
  }

  const elementsById = {};
  const duplicates = [];

  walk(schema, null, component => {
    if (typeof component.id === 'string') {
      if (elementsById[component.id]) {
        duplicates.push(component);
      } else {
        elementsById[component.id] = component;
      }
    }
  });

  return { rootElement: schema, elementsById, warnings: [], duplicates };
}

/** A JSON parse error with the line and column it happened at. */
class JsonError extends Error {
  constructor(message, text) {
    super(message);

    const lineColumn = /line (\d+) column (\d+)/.exec(message);
    const position = /position (\d+)/.exec(message);

    if (lineColumn) {
      this.line = Number(lineColumn[1]);
      this.column = Number(lineColumn[2]);
    } else if (position) {
      const before = text.slice(0, Number(position[1]));

      this.line = before.split('\n').length;
      this.column = before.length - before.lastIndexOf('\n');
    }
  }
}

/**
 * Calls `visit(component, parent)` for the schema and every component in it,
 * depth first, and gives each its parent (`$parent`, not enumerable).
 */
function walk(component, parent, visit) {
  Object.defineProperty(component, '$parent', { value: parent, enumerable: false, configurable: true });
  visit(component, parent);

  for (const child of Array.isArray(component.components) ? component.components : []) {
    if (child && typeof child === 'object') {
      walk(child, component, visit);
    }
  }
}

/** The line and column of `"id": "<id>"` in the JSON text. */
function locate(text, id) {
  const escaped = JSON.stringify(id).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = new RegExp(`"id"\\s*:\\s*${escaped}`).exec(text);

  if (!match) {
    return {};
  }

  const before = text.slice(0, match.index);

  return { line: before.split('\n').length, column: before.length - before.lastIndexOf('\n') };
}

/** The keys a component's value is stored under, with the paths of the containers around it: `address.street`. */
function fullKey(component) {
  const parts = [component.key];
  let parent = component.$parent;

  while (parent) {
    if (parent.path && COMPONENT_TYPES[parent.type]?.container) {
      parts.unshift(parent.path);
    }

    parent = parent.$parent;
  }

  return parts.join('.');
}

function labelOf(component) {
  return component.label || component.text?.split('\n')[0]?.replace(/^#+\s*/, '').slice(0, 60) || undefined;
}

/**
 * Checks a form-js schema: JSON that doesn't parse, duplicate ids, two fields
 * bound to the same key (with their containers' paths), a keyed field with no
 * key, and component types form-js doesn't know.
 *
 * @param {string} text
 */
export async function validateForm(text) {
  const problems = [];
  let parsed;

  try {
    parsed = await parseForm(text);
  } catch (error) {
    problems.push({ level: 'error', message: error.message, ...(error.line ? { line: error.line, column: error.column } : {}) });

    return summarize(problems);
  }

  for (const component of parsed.duplicates) {
    problems.push({ level: 'error', message: `duplicate ID <${component.id}>`, elementId: component.id, ...locate(text, component.id) });
  }

  const keys = new Map();

  walk(parsed.rootElement, null, (component, parent) => {
    if (!parent) {
      return;
    }

    const where = component.id ? { elementId: component.id, ...locate(text, component.id) } : {};
    const known = COMPONENT_TYPES[component.type];

    if (!component.id) {
      problems.push({ level: 'warning', message: `a ${component.type ?? 'component'} has no id`, ...where });
    }

    if (!known) {
      problems.push({
        level: 'warning',
        message: `${describe(component)} has the type "${component.type}", which form-js doesn't know, so the form shows nothing for it (unless the app registers it)`,
        property: 'type',
        value: String(component.type),
        ...where
      });

      return;
    }

    if (known.keyed && !component.key) {
      problems.push({ level: 'error', message: `${describe(component)} has no key, so its value is stored nowhere`, property: 'key', ...where });
    }

    if (known.keyed && component.key) {
      const key = fullKey(component);
      const first = keys.get(key);

      if (first) {
        problems.push({
          level: 'error',
          message: `${describe(component)} uses the key "${key}", which ${describe(first)} uses too, so they overwrite each other's value`,
          property: 'key',
          value: key,
          ...where
        });
      } else {
        keys.set(key, component);
      }
    }
  });

  problems.sort((a, b) => (a.line ?? Infinity) - (b.line ?? Infinity));

  return summarize(problems);
}

function describe(component) {
  const label = labelOf(component);

  return label ? `${component.type} ${component.id} ("${label}")` : `${component.type} ${component.id}`;
}

function summarize(problems) {
  const errorCount = problems.filter(problem => problem.level === 'error').length;

  return { isValid: errorCount === 0, errorCount, warningCount: problems.length - errorCount, problems };
}

/**
 * Describes the selected components of a form as it is now: type, key (with
 * its containers' paths), label, the other properties set (validation,
 * conditions, options, default value, expressions), and the group it is in.
 * The form's own id describes the form: its schema version, exporter and
 * number of components.
 *
 * @param {string} text
 * @param {string[]} ids
 */
export async function describeSelection(text, ids) {
  const { rootElement, elementsById } = await parseForm(text);

  return ids.map(id => {
    const component = elementsById[id];

    if (!component) {
      return { id, isMissing: true };
    }

    if (component === rootElement) {
      let count = 0;

      walk(rootElement, null, (_, parent) => { count += parent ? 1 : 0; });

      return {
        id,
        type: 'form',
        ...(rootElement.schemaVersion !== undefined ? { schemaVersion: rootElement.schemaVersion } : {}),
        ...(rootElement.exporter ? { exporter: `${rootElement.exporter.name ?? ''} ${rootElement.exporter.version ?? ''}`.trim() } : {}),
        componentCount: count,
        ...locate(text, id)
      };
    }

    const details = { id, type: component.type };
    const label = labelOf(component);

    if (label) {
      details.name = label;
    }

    if (component.key) {
      details.key = fullKey(component);
    }

    const properties = {};

    for (const [name, value] of Object.entries(component)) {
      if (!SKIPPED.has(name) && name !== 'key' && name !== 'label' && value !== undefined) {
        properties[name] = value;
      }
    }

    if (Object.keys(properties).length) {
      details.properties = properties;
    }

    if (component.components?.length) {
      details.components = component.components.map(child => ({ id: child.id, type: child.type, ...(labelOf(child) ? { name: labelOf(child) } : {}) }));
    }

    Object.assign(details, locate(text, id));

    const parent = component.$parent;

    if (parent && parent !== rootElement) {
      details.container = labelOf(parent) ? { id: parent.id, name: labelOf(parent) } : { id: parent.id };
    }

    return details;
  });
}

/**
 * The difference between two versions of a form, in the shape the other
 * model types use: components added, removed and changed (each property that
 * changed, and `stage` when it moved to another group), and how many moved
 * within the layout (another row, width or position).
 *
 * @param {string} beforeText
 * @param {string} afterText
 */
export async function diffForms(beforeText, afterText) {
  const [before, after] = await Promise.all([parseForm(beforeText), parseForm(afterText)]);
  const changes = { added: [], removed: [], changed: [], shapesMoved: 0 };

  const ref = component => {
    const result = { id: component.id, type: component.$parent ? component.type : 'form' };
    const label = labelOf(component);
    const parent = component.$parent;

    if (label) {
      result.name = label;
    }

    if (parent?.$parent) {
      result.stage = labelOf(parent) ?? parent.id;
    }

    return result;
  };

  for (const [id, component] of Object.entries(after.elementsById)) {
    const old = before.elementsById[id];

    if (!old) {
      changes.added.push(ref(component));
      continue;
    }

    const differences = {};

    for (const name of new Set([...Object.keys(old), ...Object.keys(component)])) {
      if (SKIPPED.has(name) && name !== 'type') {
        continue;
      }

      const [a, b] = [JSON.stringify(old[name]), JSON.stringify(component[name])];

      if (a !== b) {
        differences[name] = [old[name], component[name]];
      }
    }

    if (old.$parent?.id !== component.$parent?.id) {
      differences.stage = [old.$parent ? labelOf(old.$parent) ?? old.$parent.id : undefined, component.$parent ? labelOf(component.$parent) ?? component.$parent.id : undefined];
    } else if (old.$parent && (JSON.stringify(old.layout) !== JSON.stringify(component.layout) ||
      old.$parent.components.indexOf(old) !== component.$parent.components.indexOf(component))) {
      changes.shapesMoved++;
    }

    if (Object.keys(differences).length) {
      changes.changed.push({ ...ref(component), changes: differences });
    }
  }

  for (const [id, component] of Object.entries(before.elementsById)) {
    if (!after.elementsById[id]) {
      changes.removed.push(ref(component));
    }
  }

  return changes;
}

/** The form changes as lines, with layout moves counted as fields rather than shapes. */
function describeFormChanges(changes) {
  return describeChanges(changes).replace(
    /^- moved or resized (\d+) shapes? in the diagram$/m,
    (_, count) => `- moved ${count} field${count === '1' ? '' : 's'} in the form's layout (order, row or width)`
  );
}

/**
 * Maps ids to the components the form shows: a component's id is itself, and
 * a key (`email`, or `address.street` with a group's path) is the component
 * bound to it.
 *
 * @param {string} text
 * @param {string[]} ids
 */
export async function resolveDrawnIds(text, ids) {
  const { rootElement, elementsById } = await parseForm(text);
  const byKey = new Map();
  const result = { drawn: [], unknown: [], undrawn: [] };

  walk(rootElement, null, component => {
    if (component.key && component.id && !byKey.has(fullKey(component))) {
      byKey.set(fullKey(component), component);
    }
  });

  for (const id of ids) {
    const component = elementsById[id] ?? byKey.get(id);

    if (!component) {
      result.unknown.push(id);
    } else if (component === rootElement) {
      result.undrawn.push(id);
    } else if (!result.drawn.includes(component.id)) {
      result.drawn.push(component.id);
    }
  }

  return result;
}

/**
 * Forms: form-js schemas (`.form`, JSON), as the case management apps render
 * them with form-js 1.x.
 *
 * @type {import('../index.js').ModelType}
 */
export default {
  id: 'form',
  label: 'form',
  extensions: ['.form'],
  namespaces: [],
  parse: parseForm,
  validate: validateForm,
  describeSelection,
  diff: diffForms,
  isEmpty,
  describeChanges: describeFormChanges,
  resolveDrawnIds,
  page: {
    format: 'json',
    styles: ['/assets/form/form-js.css'],
    scripts: ['/assets/build/form/viewer.js'],
    viewer: 'FormLensViewer',
    // the view shows the form, not a form to fill in: fields don't take input
    viewerOptions: { properties: { readOnly: true } },
    callbacks: false,
    moddleExtensions: {},
    editor: {
      script: '/assets/build/form/editor.js',
      styles: ['/assets/form/form-js-editor.css', '/assets/form/properties-panel.css'],
      global: 'FormLensEditor'
    }
  },
  assets: {
    '/assets/form/form-js.css': 'vendor/form/form-js.css',
    '/assets/form/form-js-editor.css': 'vendor/form/form-js-editor.css',
    '/assets/form/properties-panel.css': 'vendor/form/properties-panel.css',
    '/assets/build/form/viewer.js': 'build/form/viewer.js',
    '/assets/build/form/editor.js': 'build/form/editor.js'
  }
};
