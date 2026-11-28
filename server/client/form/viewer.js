// The form viewer bundle (scripts/build.mjs builds it into public/build/form/viewer.js):
// the form-js viewer, which has no browser bundle of its own. The page renders
// the form with no data.

import { Form, FormRenderContext } from '@bpmn-io/form-js-viewer';

// Each field's wrapper gets the field's id as `data-id`, as the form-js editor
// gives it, so the page can tell which field a click is on and mark fields the
// agent highlights. The viewer renders with the context's default value
// (preact keeps it as `__`, `_defaultValue` before minification).
const defaults = FormRenderContext.__ || FormRenderContext._defaultValue;

if (defaults && defaults.Element) {
  const Element = defaults.Element;

  defaults.Element = props => {
    const vnode = Element(props);

    if (vnode && vnode.props && props.field && props.field.id) {
      vnode.props['data-id'] = props.field.id;
    }

    return vnode;
  };
}

window.FormLensViewer = Form;
