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
  resolveDrawnIds,
  page: {
    styles: ['/assets/diagram-js.css', '/assets/cmmn-embedded.css', '/assets/cmmn-js-flowable.css', '/assets/cmmn-js-touch.css'],
    scripts: ['/assets/cmmn-navigated-viewer.js'],
    viewer: 'CmmnJS',
    callbacks: true,
    moddleExtensions: { flowable: '/assets/flowable.json' },
    editor: {
      script: '/assets/build/cmmn/editor.js',
      styles: ['/assets/build/cmmn/properties-panel.css', '/assets/cmmn-js-flowable-tools.css'],
      global: 'CmmnLensEditor'
    }
  },
  assets: {
    '/assets/cmmn-navigated-viewer.js': 'vendor/cmmn-navigated-viewer.js',
    '/assets/diagram-js.css': 'vendor/diagram-js.css',
    '/assets/cmmn-embedded.css': 'vendor/cmmn-embedded.css',
    '/assets/cmmn-js-flowable.css': 'vendor/cmmn-js-flowable.css',
    '/assets/cmmn-js-touch.css': 'vendor/cmmn-js-touch.css',
    '/assets/cmmn-js-flowable-tools.css': 'vendor/cmmn-js-flowable-tools.css',
    '/assets/flowable.json': 'vendor/flowable.json',
    '/assets/build/cmmn/editor.js': 'build/cmmn/editor.js',
    '/assets/build/cmmn/properties-panel.css': 'build/cmmn/properties-panel.css'
  }
};
