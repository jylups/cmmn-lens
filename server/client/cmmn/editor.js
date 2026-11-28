// The CMMN editor bundle (scripts/build.mjs builds it into public/build/cmmn/editor.js):
// the cmmn-js Modeler, the Flowable properties panel, the touch module and
// the context pad tools, which are CommonJS and have no browser bundle of their own. The page loads it when the user
// switches to edit mode.

import Modeler from '@jylups/cmmn-js/lib/Modeler';
import propertiesPanelModule from 'cmmn-js-properties-panel-flowable';
import flowablePropertiesProviderModule from 'cmmn-js-properties-panel-flowable/lib/provider/flowable';
// touch gestures and larger touch targets; it turns itself on only where
// (pointer: coarse) matches, so a mouse is unchanged
import touchModule from '@jylups/cmmn-js/lib/features/touch';
// Flowable Design's context pad tools: Copy, Cut and Paste, the tools beside
// the shape, corner resizing, the palette toggle and help
import contextPadClipboardModule from '@jylups/cmmn-js/lib/features/context-pad-clipboard';
import contextPadToolsModule from '@jylups/cmmn-js/lib/features/context-pad-tools';
import planItemResizeModule from '@jylups/cmmn-js/lib/features/plan-item-resize';
import paletteToggleModule from '@jylups/cmmn-js/lib/features/palette-toggle';
import contextPadHelpModule from '@jylups/cmmn-js/lib/features/context-pad-help';

window.CmmnLensEditor = {
  Modeler,
  // the page's elements the editor needs: the canvas and the panel's place
  options: ({ canvas, properties }) => ({
    propertiesPanel: { parent: properties },
    // keep the context pad within the canvas, left of the properties panel
    contextPadPosition: {
      visibleRight: () => canvas.getBoundingClientRect().right
    }
  }),
  modules: [
    propertiesPanelModule,
    flowablePropertiesProviderModule,
    touchModule,
    contextPadClipboardModule,
    contextPadToolsModule,
    planItemResizeModule,
    paletteToggleModule,
    contextPadHelpModule
  ]
};
