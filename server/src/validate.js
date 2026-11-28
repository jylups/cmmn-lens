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
 * How validation reads one kind of model: `parse` reads the XML (rejecting
 * when it doesn't parse); `missingFromDiagram` lists the elements the viewer
 * would draw that have no shape.
 *
 * @typedef {object} ValidationDialect
 * @property {(xml: string) => Promise<{ rootElement: object, elementsById: Record<string, object>, warnings: object[] }>} parse
 * @property {(rootElement: object, elementsById: Record<string, object>, xml: string) => Problem[]} missingFromDiagram
 */

/** @type {ValidationDialect} */
const CMMN = { parse: parseCmmn, missingFromDiagram };

/**
 * Checks model XML the way the viewer reads it: CMMN with the CMMN and
 * Flowable descriptors, unless another dialect is given.
 *
 * @param {string} xml
 * @param {ValidationDialect} [dialect]
 * @returns {Promise<{ isValid: boolean, errorCount: number, warningCount: number, problems: Problem[] }>}
 */
export async function validateXml(xml, dialect = CMMN) {
  const problems = [];
  let result;

  try {
    result = await dialect.parse(xml);
  } catch (error) {
    problems.push({ level: 'error', ...parseFailure(error.message) });

    return summarize(problems);
  }

  for (const warning of result.warnings) {
    problems.push(fromWarning(warning, xml));
  }

  problems.push(...dialect.missingFromDiagram(result.rootElement, result.elementsById, xml));

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

  return shapeProblems({
    elementsById,
    drawn,
    drawnTypes: DRAWN_TYPES,
    hasDiagram: diagrams.length > 0,
    noDiagram: 'The file has no diagram (CMMNDI), so the viewer shows nothing. Add shapes for the case plan model and its plan items.',
    xml
  });
}

/**
 * Warnings for the elements of the drawn types that have no shape, or one
 * warning when the file has no diagram at all.
 *
 * @param {object} options
 * @param {Record<string, object>} options.elementsById
 * @param {Set<object>} options.drawn the elements that have a shape
 * @param {string[]} options.drawnTypes
 * @param {boolean} options.hasDiagram
 * @param {string} options.noDiagram the warning when there is no diagram
 * @param {string} options.xml
 * @returns {Problem[]}
 */
export function shapeProblems({ elementsById, drawn, drawnTypes, hasDiagram, noDiagram, xml }) {
  const missing = Object.values(elementsById).filter(element =>
    drawnTypes.some(type => element.$instanceOf(type)) && !drawn.has(element)
  );

  if (!missing.length) {
    return [];
  }

  if (!hasDiagram) {
    return [{ level: 'warning', message: noDiagram }];
  }

  return missing.map(element => ({
    level: 'warning',
    message: `${describe(element)} has no shape in the diagram, so the viewer doesn't show it.`,
    elementId: element.id,
    ...locate(xml, element.id)
  }));
}

function describe(element) {
  const type = element.$type.replace(/^[a-z]+:/, '');
  const name = element.name ?? element.definitionRef?.name;

  return name ? `${type} ${element.id} ("${name}")` : `${type} ${element.id}`;
}
