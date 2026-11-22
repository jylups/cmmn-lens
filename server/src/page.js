/**
 * The viewer page for one file. The page reads its settings from a JSON block
 * and loads the diagram itself (public/viewer.js).
 *
 * @param {object} options
 * @param {string} options.name the file name, shown as the title
 * @param {string} options.path the full path, shown on hover
 * @param {string} options.diagramUrl where the page fetches the file's XML
 * @param {string} options.eventsUrl the stream that says when the file changes
 * @param {string} options.selectionUrl where the page posts the user's selection
 * @param {string} options.describeUrl where the page gets the selected elements' properties
 * @param {string} options.saveUrl where the page saves the model in edit mode
 * @returns {string}
 */
export function renderPage({ name, path, diagramUrl, eventsUrl, selectionUrl, describeUrl, saveUrl }) {
  const config = jsonForScript({
    name,
    diagramUrl,
    eventsUrl,
    selectionUrl,
    describeUrl,
    saveUrl,
    flowableUrl: '/assets/flowable.json',
    editorScriptUrl: '/assets/build/editor.js',
    editorStyleUrl: '/assets/build/properties-panel.css'
  });

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="referrer" content="no-referrer">
  <title>${escapeHtml(name)} · cmmn-lens</title>
  <link rel="stylesheet" href="/assets/diagram-js.css">
  <link rel="stylesheet" href="/assets/cmmn-embedded.css">
  <link rel="stylesheet" href="/assets/cmmn-js-flowable.css">
  <link rel="stylesheet" href="/assets/viewer.css">
</head>
<body>
  <header class="bar">
    <span class="file" title="${escapeHtml(path)}">${escapeHtml(name)}</span>
    <span class="status" id="status" role="status">Opening…</span>
    <span class="actions">
      <button type="button" id="edit" hidden>Edit</button>
      <button type="button" id="save" hidden>Save</button>
      <button type="button" id="done" hidden>Done</button>
    </span>
  </header>
  <details class="problems" id="problems" hidden>
    <summary id="problems-summary"></summary>
    <ul id="problems-list"></ul>
  </details>
  <div class="workspace">
    <main class="canvas" id="canvas"></main>
    <aside class="properties" id="properties" aria-label="Properties of the selection">
      <div class="properties-head">
        <h2 id="properties-title">Properties</h2>
        <button type="button" class="properties-toggle" id="properties-toggle" aria-expanded="true" aria-controls="properties-body">Hide</button>
      </div>
      <div class="properties-body" id="properties-body">
        <p class="properties-empty">Select an element to see its properties.</p>
      </div>
      <div class="properties-editor" id="properties-editor" hidden></div>
    </aside>
  </div>
  <script id="cmmn-lens-config" type="application/json">${config}</script>
  <script src="/assets/cmmn-navigated-viewer.js"></script>
  <script src="/assets/properties.js"></script>
  <script src="/assets/viewer.js"></script>
</body>
</html>
`;
}

function escapeHtml(text) {
  return String(text)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

/** JSON that can't close the script element it sits in. */
function jsonForScript(value) {
  return JSON.stringify(value)
    .replaceAll('<', '\\u003c')
    .replaceAll('>', '\\u003e')
    .replaceAll('&', '\\u0026');
}
