import { describeChanges, diffModels, isEmpty } from '../changes.js';
import { resolveDrawnIds } from '../highlight.js';
import { createModdle, parseCmmn } from '../moddle.js';
import { describeSelection } from '../selection.js';
import { validateXml } from '../validate.js';

/**
 * CMMN case models, read with the CMMN and Flowable descriptors as the viewer
 * reads them.
 *
 * @type {import('./index.js').ModelType}
 */
export default {
  id: 'cmmn',
  label: 'CMMN',
  extensions: ['.cmmn'],
  namespaces: [createModdle().getPackage('cmmn').uri],
  parse: parseCmmn,
  validate: validateXml,
  describeSelection,
  diff: diffModels,
  isEmpty,
  describeChanges,
  resolveDrawnIds
};
