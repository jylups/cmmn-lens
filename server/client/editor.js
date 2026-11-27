// The editor bundle (scripts/build.mjs builds it into public/build/editor.js):
// the cmmn-js Modeler, the Flowable properties panel and the touch module,
// which are CommonJS and have no browser bundle of their own. The page loads it when the user
// switches to edit mode.

import Modeler from '@jylups/cmmn-js/lib/Modeler';
import propertiesPanelModule from 'cmmn-js-properties-panel-flowable';
import flowablePropertiesProviderModule from 'cmmn-js-properties-panel-flowable/lib/provider/flowable';
// touch gestures and larger touch targets; it turns itself on only where
// (pointer: coarse) matches, so a mouse is unchanged
import touchModule from '@jylups/cmmn-js/lib/features/touch';

window.CmmnLensEditor = {
  Modeler,
  modules: [ propertiesPanelModule, flowablePropertiesProviderModule, touchModule ]
};
