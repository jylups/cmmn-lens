// The editor bundle (scripts/build.mjs builds it into public/build/editor.js):
// the cmmn-js Modeler and the Flowable properties panel, which are CommonJS
// and have no browser bundle of their own. The page loads it when the user
// switches to edit mode.

import Modeler from '@jylups/cmmn-js/lib/Modeler';
import propertiesPanelModule from 'cmmn-js-properties-panel-flowable';
import flowablePropertiesProviderModule from 'cmmn-js-properties-panel-flowable/lib/provider/flowable';

window.CmmnLensEditor = {
  Modeler,
  modules: [ propertiesPanelModule, flowablePropertiesProviderModule ]
};
