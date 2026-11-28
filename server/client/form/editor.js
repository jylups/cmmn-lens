// The form editor bundle (scripts/build.mjs builds it into public/build/form/editor.js):
// the form-js editor with its properties panel. The page loads it when the
// user switches to edit mode.

import { FormEditor } from '@bpmn-io/form-js-editor';

window.FormLensEditor = {
  Modeler: FormEditor,
  modules: [],
  options: ({ properties }) => ({
    propertiesPanel: { parent: properties }
  })
};
