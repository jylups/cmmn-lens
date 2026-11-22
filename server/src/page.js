/**
 * The viewer page for one file. The page reads its settings from a JSON block
 * and loads the diagram itself (public/viewer.js).
 *
 * @param {object} options
 * @param {string} options.name the file name, shown as the title
 * @param {string} options.path the full path, shown on hover
 * @param {string} options.diagramUrl where the page fetches the file's XML
 * @returns {string}
 */
export function renderPage({ name, path, diagramUrl }) {
  const config = jsonForScript({ name, diagramUrl, flowableUrl: '/assets/flowable.json' });

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
  </header>
  <main class="canvas" id="canvas"></main>
  <script id="cmmn-lens-config" type="application/json">${config}</script>
  <script src="/assets/cmmn-navigated-viewer.js"></script>
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
