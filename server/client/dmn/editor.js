// The DMN editor bundle (scripts/build.mjs builds it into public/build/dmn/editor.js):
// the dmn-js Modeler, with the DMN properties panel in the decision
// requirements diagram. The page loads it when the user switches to edit mode.

import Modeler from 'dmn-js/lib/Modeler';
import { DmnPropertiesPanelModule, DmnPropertiesProviderModule } from 'dmn-js-properties-panel';

window.DmnLensEditor = {
  Modeler,
  modules: [],
  // dmn-js takes options per view: the panel belongs to the diagram view
  options: ({ properties }) => ({
    common: { keyboard: { bind: true } },
    drd: {
      propertiesPanel: { parent: properties },
      additionalModules: [DmnPropertiesPanelModule, DmnPropertiesProviderModule]
    }
  })
};
