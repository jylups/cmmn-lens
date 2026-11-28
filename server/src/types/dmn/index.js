import { describeChanges, diffModels, isEmpty } from '../../changes.js';
import { locate } from '../../moddle.js';
import { attributesOf as readAttributes } from '../../selection.js';
import { shapeProblems, validateXml } from '../../validate.js';
import { DMN_NAMESPACES, decisionOf, drawnElements, hrefId, parseDmn } from './moddle.js';

/** The elements the decision requirements diagram draws only when DMNDI has a shape for them. */
const DRAWN_TYPES = ['dmn:Decision', 'dmn:InputData', 'dmn:BusinessKnowledgeModel', 'dmn:KnowledgeSource', 'dmn:TextAnnotation'];

/** Elements shown in a decision's own view (its table or literal expression) rather than in the diagram. */
const DECISION_PARTS = ['dmn:DecisionTable', 'dmn:LiteralExpression', 'dmn:InputClause', 'dmn:OutputClause', 'dmn:DecisionRule', 'dmn:UnaryTests'];

function attributesOf(element) {
  return readAttributes(element, { hiddenReferences: true });
}

function text(element) {
  return element?.text?.trim() || undefined;
}

function named(element) {
  return element.name ? { id: element.id, name: element.name } : { id: element.id };
}

const validation = {
  parse: parseDmn,
  missingFromDiagram(definitions, elementsById, xml) {
    const { drawn, hasDiagram } = drawnElements(definitions);

    return shapeProblems({
      elementsById,
      drawn,
      drawnTypes: DRAWN_TYPES,
      hasDiagram,
      noDiagram: 'The file has no decision requirements diagram (DMNDI), so the viewer opens the first decision\'s table instead. Add shapes for the decisions and input data to see the diagram.',
      xml
    });
  }
};

const diffing = {
  parse: parseDmn,
  diagram: /^(dmndi|di|dc):/,
  shape: /^dmndi:DMN(Shape|Edge)$/,
  typeOf: element => element.$type,
  attributesOf,
  // an entry is "in Discount, rule 2"; other parts of a decision "in Discount"
  containerOf: element => {
    const decision = decisionOf(element);
    const rule = ruleOf(element);

    if (!decision) {
      return undefined;
    }

    const name = decision.name ?? decision.id;

    return rule ? `${name}, rule ${(rule.$parent?.rule ?? []).indexOf(rule) + 1}` : name;
  },
  containerKeyOf: element => ruleOf(element)?.id ?? decisionOf(element)?.id
};

/** The rule an entry belongs to. */
function ruleOf(element) {
  return element.$parent?.$instanceOf?.('dmn:DecisionRule') ? element.$parent : null;
}

/**
 * Describes the selected elements of a DMN file as it is now: a decision with
 * its logic (a table's hit policy, inputs, outputs and rule count, or a
 * literal expression), what it requires and what requires it; input data and
 * its variable; a table's input or output; a rule with its entries under the
 * inputs and outputs they belong to.
 *
 * @param {string} xml
 * @param {string[]} ids
 * @returns {Promise<object[]>}
 */
export async function describeSelection(xml, ids) {
  const { elementsById } = await parseDmn(xml);
  const decisions = Object.values(elementsById).filter(element => element.$instanceOf('dmn:Decision'));

  return ids.map(id => {
    const element = elementsById[id];

    return element ? describe(element, xml, { elementsById, decisions }) : { id, isMissing: true };
  });
}

function describe(element, xml, context) {
  const details = { id: element.id, type: element.$type, ...(element.name ? { name: element.name } : {}) };
  const attributes = attributesOf(element);

  for (const key of ['dmn:hitPolicy', 'dmn:aggregation', 'dmn:typeRef', 'dmn:label']) {
    delete attributes[key];
  }

  if (Object.keys(attributes).length) {
    details.attributes = attributes;
  }

  Object.assign(details, locate(xml, element.id));

  const description = text({ text: element.description });

  if (description) {
    details.description = description;
  }

  if (element.$instanceOf('dmn:Decision')) {
    Object.assign(details, describeDecision(element, context));
  } else if (element.$instanceOf('dmn:InputData')) {
    if (element.variable?.typeRef) {
      details.typeRef = element.variable.typeRef;
    }

    details.requiredBy = requiredBy(element, context.decisions);
  } else if (element.$instanceOf('dmn:DecisionTable')) {
    Object.assign(details, describeTable(element));
  } else if (element.$instanceOf('dmn:InputClause')) {
    Object.assign(details, describeInput(element));
  } else if (element.$instanceOf('dmn:OutputClause')) {
    Object.assign(details, describeOutput(element));
  } else if (element.$instanceOf('dmn:DecisionRule')) {
    Object.assign(details, describeRule(element));
  } else if (element.$instanceOf('dmn:LiteralExpression') || element.$instanceOf('dmn:UnaryTests')) {
    const body = text(element);

    if (body) {
      details.text = body;
    }
  } else if (element.$instanceOf('dmn:TextAnnotation')) {
    details.text = text(element);
  }

  const decision = decisionOf(element);

  if (decision) {
    details.decision = named(decision);
  }

  if (!details.requiredBy?.length) {
    delete details.requiredBy;
  }

  return details;
}

function describeDecision(decision, { decisions }) {
  const details = {};
  const logic = decision.decisionLogic;

  if (logic?.$instanceOf('dmn:DecisionTable')) {
    details.decisionTable = { id: logic.id, ...describeTable(logic) };
  } else if (logic?.$instanceOf('dmn:LiteralExpression')) {
    details.literalExpression = { id: logic.id, ...(logic.typeRef ? { typeRef: logic.typeRef } : {}), text: text(logic) };
  } else if (logic) {
    details.logic = logic.$type;
  }

  const requires = [];

  for (const requirement of decision.informationRequirement ?? []) {
    const decisionId = hrefId(requirement.requiredDecision);
    const inputId = hrefId(requirement.requiredInput);

    if (decisionId) {
      requires.push({ decision: decisionId });
    }

    if (inputId) {
      requires.push({ inputData: inputId });
    }
  }

  for (const requirement of decision.knowledgeRequirement ?? []) {
    const id = hrefId(requirement.requiredKnowledge);

    if (id) {
      requires.push({ businessKnowledgeModel: id });
    }
  }

  if (requires.length) {
    details.requires = requires;
  }

  details.requiredBy = requiredBy(decision, decisions);

  return details;
}

/** The decisions that require an element (a decision or input data) through an information requirement. */
function requiredBy(element, decisions) {
  return decisions
    .filter(other => (other.informationRequirement ?? []).some(requirement =>
      hrefId(requirement.requiredDecision) === element.id || hrefId(requirement.requiredInput) === element.id
    ))
    .map(named);
}

function describeTable(table) {
  const details = { hitPolicy: table.hitPolicy ?? 'UNIQUE' };

  if (table.aggregation) {
    details.aggregation = table.aggregation;
  }

  details.inputs = (table.input ?? []).map(input => ({ id: input.id, ...describeInput(input) }));
  details.outputs = (table.output ?? []).map(output => ({ id: output.id, ...describeOutput(output) }));
  details.ruleCount = (table.rule ?? []).length;

  return details;
}

function describeInput(input) {
  const details = {};

  if (input.label) {
    details.label = input.label;
  }

  const expression = text(input.inputExpression);

  if (expression) {
    details.expression = expression;
  }

  if (input.inputExpression?.typeRef) {
    details.typeRef = input.inputExpression.typeRef;
  }

  const values = text(input.inputValues);

  if (values) {
    details.allowedValues = values;
  }

  return details;
}

function describeOutput(output) {
  const details = {};

  for (const key of ['label', 'name', 'typeRef']) {
    if (output[key]) {
      details[key] = output[key];
    }
  }

  const values = text(output.outputValues);

  if (values) {
    details.allowedValues = values;
  }

  return details;
}

/** A rule's number in its table and its entries, each under the input or output it belongs to. */
function describeRule(rule) {
  const table = rule.$parent;
  const inputs = table?.input ?? [];
  const outputs = table?.output ?? [];
  const label = (clause, index, fallback) => clause?.label || clause?.name || text(clause?.inputExpression) || `${fallback} ${index + 1}`;

  return {
    number: (table?.rule ?? []).indexOf(rule) + 1,
    when: (rule.inputEntry ?? []).map((entry, index) => ({ input: label(inputs[index], index, 'input'), test: text(entry) ?? '-' })),
    then: (rule.outputEntry ?? []).map((entry, index) => ({ output: label(outputs[index], index, 'output'), value: text(entry) ?? '' }))
  };
}

/**
 * Maps ids to the elements the viewer draws. In the decision requirements
 * diagram: decisions, input data, knowledge models and sources, and
 * annotations with a shape, requirements and associations with an edge, and
 * diagram shapes and edges as the element they draw. A decision's table, its
 * inputs, outputs, rules and entries, or its literal expression, are drawn in
 * the decision's own view: they resolve to themselves and to the decision, so
 * the page marks whichever is on screen.
 *
 * @param {string} xml
 * @param {string[]} ids
 * @returns {Promise<import('../index.js').HighlightIds>}
 */
export async function resolveDrawnIds(xml, ids) {
  const { rootElement, elementsById } = await parseDmn(xml);
  const { drawn, diagramElements } = drawnElements(rootElement);
  const result = { drawn: [], unknown: [], undrawn: [] };

  const add = element => {
    if (element?.id && !result.drawn.includes(element.id)) {
      result.drawn.push(element.id);
    }
  };

  for (const id of ids) {
    const element = diagramElements.get(id) ?? elementsById[id];

    if (!element) {
      result.unknown.push(id);
    } else if (drawn.has(element)) {
      add(element);
    } else if (DECISION_PARTS.some(type => element.$instanceOf(type)) && decisionOf(element)) {
      // an entry is marked through its rule, the row the table draws
      add(element.$instanceOf('dmn:UnaryTests') || element.$instanceOf('dmn:LiteralExpression') && element.$parent?.$instanceOf('dmn:DecisionRule') ? element.$parent : element);
      add(decisionOf(element));
    } else if (element.$instanceOf('dmn:Decision')) {
      // a decision without a shape still has its own view
      add(element);
    } else {
      result.undrawn.push(id);
    }
  }

  return result;
}

/**
 * DMN decision models: the decision requirements diagram, decision tables and
 * literal expressions, read as Flowable reads them (DMN 1.1 and 1.2 migrated
 * to 1.3).
 *
 * @type {import('../index.js').ModelType}
 */
export default {
  id: 'dmn',
  label: 'DMN',
  extensions: ['.dmn'],
  namespaces: DMN_NAMESPACES,
  parse: parseDmn,
  validate: xml => validateXml(xml, validation),
  describeSelection,
  diff: (beforeXml, afterXml) => diffModels(beforeXml, afterXml, diffing),
  isEmpty,
  describeChanges,
  resolveDrawnIds,
  page: {
    styles: [
      '/assets/dmn/diagram-js.css',
      '/assets/dmn/dmn-js-shared.css',
      '/assets/dmn/dmn-js-drd.css',
      '/assets/dmn/dmn-js-decision-table.css',
      '/assets/dmn/dmn-js-literal-expression.css',
      '/assets/dmn/dmn-js-boxed-expression.css',
      '/assets/dmn/dmn-embedded.css'
    ],
    scripts: ['/assets/dmn/dmn-navigated-viewer.js'],
    viewer: 'DmnJS',
    callbacks: false,
    moddleExtensions: {},
    editor: {
      script: '/assets/build/dmn/editor.js',
      styles: [
        '/assets/dmn/dmn-js-decision-table-controls.css',
        '/assets/dmn/dmn-js-boxed-expression-controls.css',
        '/assets/dmn/properties-panel.css'
      ],
      global: 'DmnLensEditor'
    }
  },
  assets: {
    '/assets/dmn/dmn-navigated-viewer.js': 'vendor/dmn/dmn-navigated-viewer.js',
    '/assets/dmn/diagram-js.css': 'vendor/dmn/diagram-js.css',
    '/assets/dmn/dmn-js-shared.css': 'vendor/dmn/dmn-js-shared.css',
    '/assets/dmn/dmn-js-drd.css': 'vendor/dmn/dmn-js-drd.css',
    '/assets/dmn/dmn-js-decision-table.css': 'vendor/dmn/dmn-js-decision-table.css',
    '/assets/dmn/dmn-js-decision-table-controls.css': 'vendor/dmn/dmn-js-decision-table-controls.css',
    '/assets/dmn/dmn-js-literal-expression.css': 'vendor/dmn/dmn-js-literal-expression.css',
    '/assets/dmn/dmn-js-boxed-expression.css': 'vendor/dmn/dmn-js-boxed-expression.css',
    '/assets/dmn/dmn-js-boxed-expression-controls.css': 'vendor/dmn/dmn-js-boxed-expression-controls.css',
    '/assets/dmn/dmn-embedded.css': 'vendor/dmn/dmn-embedded.css',
    '/assets/build/dmn/editor.js': 'build/dmn/editor.js',
    '/assets/dmn/properties-panel.css': 'vendor/dmn/properties-panel.css'
  }
};
