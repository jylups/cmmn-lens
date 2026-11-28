// Builds the publishable server package, so it runs with no dependencies
// installed (npx then downloads one package, which starts in a second or two):
//
// - dist/server.mjs: the MCP server, bundled with its dependencies (the MCP
//   SDK, zod, the CMMN and Flowable moddle packages)
// - public/vendor/: the files the viewer page loads as they are, for each
//   model type (for CMMN: the cmmn-js viewer bundle, its styles, the Flowable
//   descriptor; for BPMN, in vendor/bpmn: the flowable-bpmn-js viewer bundle
//   and its styles; for DMN, in vendor/dmn: the dmn-js viewer bundle, its
//   styles and the properties panel's; for forms, in vendor/form: the
//   form-js viewer, editor and properties panel styles)
// - public/build/<type>/: what edit mode loads for each model type, built
//   separately so a page loads only its own type's (for CMMN: editor.js, the
//   Modeler and the Flowable properties panel, bundled, and
//   properties-panel.css, the panel's LESS styles, compiled; for BPMN:
//   editor.js, the flowable-bpmn-js Modeler with its properties panel, lint
//   and touch module; for DMN: editor.js, the dmn-js Modeler with the DMN
//   properties panel; for forms: viewer.js and editor.js, the form-js viewer
//   and editor, which have no browser bundles)
// - THIRD_PARTY_NOTICES.md: every package whose code or files the package
//   carries
//
//   npm run build --workspace server

import { copyFile, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { build } from 'esbuild';
import less from 'less';

import { writeNotices } from './notices.mjs';

const require = createRequire(import.meta.url);
const root = join(dirname(fileURLToPath(import.meta.url)), '..');

const cmmnJsDist = dirname(require.resolve('@jylups/cmmn-js/dist/cmmn-navigated-viewer.production.min.js'));
const bpmnJsDist = dirname(require.resolve('@jylups/flowable-bpmn-js/dist/flowable-bpmn-navigated-viewer.production.min.js'));
const dmnJsDist = dirname(require.resolve('dmn-js/dist/dmn-navigated-viewer.production.min.js'));

/**
 * What each model type's page needs built: `vendor`, files copied into
 * public/vendor as they are, by name; `editor`, the client entry bundled into
 * public/build/<type>/editor.js; `viewer`, for a type whose viewer has no
 * browser bundle, the entry bundled into public/build/<type>/viewer.js; `styles`, CSS files written into
 * public/build/<type>/, by name.
 */
const TYPES = [
  {
    id: 'cmmn',
    vendor: {
      'cmmn-navigated-viewer.js': join(cmmnJsDist, 'cmmn-navigated-viewer.production.min.js'),
      'diagram-js.css': join(cmmnJsDist, 'assets/diagram-js.css'),
      'cmmn-embedded.css': join(cmmnJsDist, 'assets/cmmn-font/css/cmmn-embedded.css'),
      'cmmn-js-flowable.css': join(cmmnJsDist, 'assets/cmmn-js-flowable.css'),
      'cmmn-js-touch.css': join(cmmnJsDist, 'assets/cmmn-js-touch.css'),
      'cmmn-js-flowable-tools.css': join(cmmnJsDist, 'assets/cmmn-js-flowable-tools.css'),
      'flowable.json': require.resolve('flowable-cmmn-moddle/resources/flowable.json')
    },
    editor: join(root, 'client', 'cmmn', 'editor.js'),
    styles: {
      'properties-panel.css': () => compileLess(require.resolve('cmmn-js-properties-panel-flowable/styles/properties.less'))
    }
  },
  {
    id: 'bpmn',
    // flowable-bpmn-js ships its viewer bundle and copies of the bpmn-js,
    // properties panel and linting styles
    vendor: {
      'bpmn/flowable-bpmn-navigated-viewer.js': join(bpmnJsDist, 'flowable-bpmn-navigated-viewer.production.min.js'),
      'bpmn/diagram-js.css': join(bpmnJsDist, 'assets/diagram-js.css'),
      'bpmn/bpmn-js.css': join(bpmnJsDist, 'assets/bpmn-js.css'),
      'bpmn/bpmn-embedded.css': join(bpmnJsDist, 'assets/bpmn-font/css/bpmn-embedded.css'),
      'bpmn/flowable-bpmn-js.css': join(bpmnJsDist, 'assets/flowable-bpmn-js.css'),
      'bpmn/flowable-bpmn-js-touch.css': join(bpmnJsDist, 'assets/flowable-bpmn-js-touch.css'),
      'bpmn/properties-panel.css': join(bpmnJsDist, 'assets/properties-panel.css'),
      'bpmn/bpmn-js-bpmnlint.css': join(bpmnJsDist, 'assets/bpmn-js-bpmnlint.css')
    },
    editor: join(root, 'client', 'bpmn', 'editor.js'),
    styles: {}
  },
  {
    id: 'dmn',
    // dmn-js ships its viewer bundle and styles; the properties panel's styles
    // come with dmn-js-properties-panel
    vendor: {
      'dmn/dmn-navigated-viewer.js': join(dmnJsDist, 'dmn-navigated-viewer.production.min.js'),
      'dmn/diagram-js.css': join(dmnJsDist, 'assets/diagram-js.css'),
      'dmn/dmn-js-shared.css': join(dmnJsDist, 'assets/dmn-js-shared.css'),
      'dmn/dmn-js-drd.css': join(dmnJsDist, 'assets/dmn-js-drd.css'),
      'dmn/dmn-js-decision-table.css': join(dmnJsDist, 'assets/dmn-js-decision-table.css'),
      'dmn/dmn-js-decision-table-controls.css': join(dmnJsDist, 'assets/dmn-js-decision-table-controls.css'),
      'dmn/dmn-js-literal-expression.css': join(dmnJsDist, 'assets/dmn-js-literal-expression.css'),
      'dmn/dmn-js-boxed-expression.css': join(dmnJsDist, 'assets/dmn-js-boxed-expression.css'),
      'dmn/dmn-js-boxed-expression-controls.css': join(dmnJsDist, 'assets/dmn-js-boxed-expression-controls.css'),
      'dmn/dmn-embedded.css': join(dmnJsDist, 'assets/dmn-font/css/dmn-embedded.css'),
      'dmn/properties-panel.css': require.resolve('dmn-js-properties-panel/dist/assets/properties-panel.css')
    },
    editor: join(root, 'client', 'dmn', 'editor.js'),
    styles: {}
  },
  {
    id: 'form',
    // form-js has no browser bundle: the viewer is bundled here too
    vendor: {
      'form/form-js.css': require.resolve('@bpmn-io/form-js-viewer/dist/assets/form-js.css'),
      'form/form-js-editor.css': require.resolve('@bpmn-io/form-js-editor/dist/assets/form-js-editor.css'),
      'form/properties-panel.css': require.resolve('@bpmn-io/form-js-editor/dist/assets/properties-panel.css')
    },
    viewer: join(root, 'client', 'form', 'viewer.js'),
    editor: join(root, 'client', 'form', 'editor.js'),
    styles: {}
  }
];

async function compileLess(file) {
  const { css } = await less.render(await readFile(file, 'utf8'), { filename: file, paths: [dirname(file)] });

  return css;
}

await rm(join(root, 'public', 'vendor'), { recursive: true, force: true });

for (const type of TYPES) {
  for (const [name, source] of Object.entries(type.vendor)) {
    const target = join(root, 'public', 'vendor', name);

    await mkdir(dirname(target), { recursive: true });
    await copyFile(source, target);
  }
}

const server = await build({
  entryPoints: [join(root, 'src', 'index.js')],
  outfile: join(root, 'dist', 'server.mjs'),
  bundle: true,
  format: 'esm',
  platform: 'node',
  target: ['node22'],
  // CommonJS code in the bundle calls require; give the ES module one
  banner: { js: "import { createRequire as __cmmnLensRequire } from 'node:module';\nconst require = __cmmnLensRequire(import.meta.url);" },
  legalComments: 'eof',
  metafile: true,
  absWorkingDir: root,
  logLevel: 'warning'
});

const inputs = { ...server.metafile.inputs };

// the build folder holds only what this build writes
await rm(join(root, 'public', 'build'), { recursive: true, force: true });

for (const type of TYPES) {
  const out = join(root, 'public', 'build', type.id);
  const bundles = { editor: type.editor, ...(type.viewer ? { viewer: type.viewer } : {}) };

  for (const [name, entry] of Object.entries(bundles)) {
    const bundle = await build({
      entryPoints: [entry],
      outfile: join(out, `${name}.js`),
      bundle: true,
      format: 'iife',
      platform: 'browser',
      target: ['es2020'],
      minify: true,
      legalComments: 'eof',
      define: { 'process.env.NODE_ENV': '"production"' },
      metafile: true,
      absWorkingDir: root,
      logLevel: 'warning'
    });

    Object.assign(inputs, bundle.metafile.inputs);
  }

  for (const [name, compile] of Object.entries(type.styles)) {
    await writeFile(join(out, name), await compile());
  }
}

const notices = await writeNotices({ root, inputs, out: join(root, 'THIRD_PARTY_NOTICES.md') });

console.log(`built dist/server.mjs, public/vendor/ and public/build/ (${TYPES.map(type => type.id).join(', ')}); ${notices.file} lists ${notices.count} packages`);
