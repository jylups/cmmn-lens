import { readFile } from 'node:fs/promises';

import { locate, parseCmmn } from './moddle.js';

/**
 * The elements the viewer draws only when the diagram (CMMNDI) has a shape
 * for them.
 */
const DRAWN_TYPES = [
  'cmmn:CasePlanModel',
  'cmmn:PlanItem',
  'cmmn:DiscretionaryItem',
  'cmmn:EntryCriterion',
  'cmmn:ExitCriterion'
];

/**
 * @typedef {object} Problem
 * @property {'error'|'warning'} level an error makes the model wrong (it
 *   doesn't parse, or a reference points at nothing); a warning is something
 *   to check (an attribute nobody reads, an element the viewer can't show)
 * @property {string} message
 * @property {string} [elementId] the element the problem is on
 * @property {string} [property] the attribute, for a reference or attribute problem
 * @property {string} [value] the attribute's value
 * @property {number} [line] 1-based, where known
 * @property {number} [column] 1-based, where known
 */

/**
 * Checks CMMN XML the way the viewer reads it: with the CMMN and Flowable
 * descriptors.
 *
 * @param {string} xml
 * @returns {Promise<{ isValid: boolean, errorCount: number, warningCount: number, problems: Problem[] }>}
 */
export async function validateXml(xml) {
  const problems = [];
  let result;

  try {
    result = await parseCmmn(xml);
  } catch (error) {
    problems.push({ level: 'error', ...parseFailure(error.message) });

    return summarize(problems);
  }

  for (const warning of result.warnings) {
    problems.push(fromWarning(warning, xml));
  }

  problems.push(...missingFromDiagram(result.rootElement, result.elementsById, xml));

  problems.sort((a, b) => (a.line ?? Infinity) - (b.line ?? Infinity));

  return summarize(problems);
}

/**
 * Checks a CMMN file.
 *
 * @param {string} path
 */
export async function validateFile(path) {
  return validateXml(await readFile(path, 'utf8'));
}

function summarize(problems) {
  const errorCount = problems.filter(problem => problem.level === 'error').length;

  return { isValid: errorCount === 0, errorCount, warningCount: problems.length - errorCount, problems };
}

/**
 * Splits a parser message (`unparsable content <x> detected\n\tline: 25\n\t
 * column: 38\n\tnested error: unclosed tag`) into its parts.
 */
function parseFailure(text) {
  const line = /\bline: (\d+)/.exec(text);
  const column = /\bcolumn: (\d+)/.exec(text);
  const nested = /nested error: (.*)/.exec(text);
  const context = text.split('\n')[0].trim();
  const problem = { message: nested ? `${nested[1].trim()} (${context})` : context };

  if (line) {
    problem.line = Number(line[1]) + 1;
  }

  if (column) {
    problem.column = Number(column[1]) + 1;
  }

  const duplicate = nested && /^duplicate ID <(.*)>$/.exec(nested[1].trim());

  if (duplicate) {
    problem.elementId = duplicate[1];
  }

  return problem;
}

function fromWarning(warning, xml) {
  if (/^unparsable content/.test(warning.message)) {
    return { level: 'error', ...parseFailure(warning.message) };
  }

  const problem = {
    level: /^unresolved reference/.test(warning.message) ? 'error' : 'warning',
    message: warning.message
  };

  // an element without an id (a label, a standard event) is named by the
  // nearest element around it that has one
  let element = warning.element;

  while (element && !element.id) {
    element = element.$parent;
  }

  if (element) {
    problem.elementId = element.id;
    Object.assign(problem, locate(xml, element.id));

    if (element !== warning.element) {
      problem.message += ` (on its ${warning.element.$type})`;
    }
  }

  if (warning.property) {
    problem.property = warning.property;
  }

  if (warning.value !== undefined) {
    problem.value = String(warning.value);
  }

  return problem;
}

/** The elements the viewer would draw that have no shape in the diagram. */
function missingFromDiagram(definitions, elementsById, xml) {
  const diagrams = definitions.CMMNDI?.diagrams ?? [];
  const drawn = new Set();

  for (const diagram of diagrams) {
    for (const element of diagram.diagramElements ?? []) {
      const ref = element.cmmnElementRef;

      if (ref) {
        drawn.add(ref);
      }
    }
  }

  const missing = Object.values(elementsById).filter(element =>
    DRAWN_TYPES.some(type => element.$instanceOf(type)) && !drawn.has(element)
  );

  if (!missing.length) {
    return [];
  }

  if (!diagrams.length) {
    return [{
      level: 'warning',
      message: 'The file has no diagram (CMMNDI), so the viewer shows nothing. Add shapes for the case plan model and its plan items.'
    }];
  }

  return missing.map(element => ({
    level: 'warning',
    message: `${describe(element)} has no shape in the diagram, so the viewer doesn't show it.`,
    elementId: element.id,
    ...locate(xml, element.id)
  }));
}

function describe(element) {
  const type = element.$type.replace(/^cmmn:/, '');
  const name = element.name ?? element.definitionRef?.name;

  return name ? `${type} ${element.id} ("${name}")` : `${type} ${element.id}`;
}
