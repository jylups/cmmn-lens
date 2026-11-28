// The BPMN editor bundle (scripts/build.mjs builds it into public/build/bpmn/editor.js):
// the flowable-bpmn-js Modeler, which has the Flowable descriptor, behaviors,
// properties panel and lint built in, and its touch module. The page loads it
// when the user switches to edit mode.

import { Modeler, TouchModule } from '@jylups/flowable-bpmn-js';

window.BpmnLensEditor = {
  Modeler,
  // touch gestures and larger touch targets; it turns itself on only where
  // (pointer: coarse) matches, so a mouse is unchanged
  modules: [TouchModule],
  options: ({ properties }) => ({
    propertiesPanel: { parent: properties }
  })
};
