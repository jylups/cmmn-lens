// Builds the publishable server package, so it runs with no dependencies
// installed (npx then downloads one package, which starts in a second or two):
//
// - dist/server.mjs: the MCP server, bundled with its dependencies (the MCP
//   SDK, zod, the CMMN and Flowable moddle packages)
// - public/vendor/: the files the viewer page loads as they are (the cmmn-js
//   viewer bundle, its styles, the Flowable descriptor)
// - public/build/: what edit mode loads, editor.js (the Modeler and the
//   Flowable properties panel, bundled) and properties-panel.css (the panel's
//   LESS styles, compiled)
// - THIRD_PARTY_NOTICES.md: every package whose code or files the package
//   carries
//
//   npm run build --workspace server

import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { build } from 'esbuild';
import less from 'less';

import { writeNotices } from './notices.mjs';

const require = createRequire(import.meta.url);
const root = join(dirname(fileURLToPath(import.meta.url)), '..');

/** The vendor files the page loads, by their name in public/vendor. */
const cmmnJsDist = dirname(require.resolve('@jylups/cmmn-js/dist/cmmn-navigated-viewer.production.min.js'));
const VENDOR = {
  'cmmn-navigated-viewer.js': join(cmmnJsDist, 'cmmn-navigated-viewer.production.min.js'),
  'diagram-js.css': join(cmmnJsDist, 'assets/diagram-js.css'),
  'cmmn-embedded.css': join(cmmnJsDist, 'assets/cmmn-font/css/cmmn-embedded.css'),
  'cmmn-js-flowable.css': join(cmmnJsDist, 'assets/cmmn-js-flowable.css'),
  'cmmn-js-touch.css': join(cmmnJsDist, 'assets/cmmn-js-touch.css'),
  'cmmn-js-flowable-tools.css': join(cmmnJsDist, 'assets/cmmn-js-flowable-tools.css'),
  'flowable.json': require.resolve('flowable-cmmn-moddle/resources/flowable.json')
};

await mkdir(join(root, 'public', 'vendor'), { recursive: true });

for (const [name, source] of Object.entries(VENDOR)) {
  await copyFile(source, join(root, 'public', 'vendor', name));
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

const editor = await build({
  entryPoints: [join(root, 'client', 'editor.js')],
  outfile: join(root, 'public', 'build', 'editor.js'),
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

const lessFile = require.resolve('cmmn-js-properties-panel-flowable/styles/properties.less');
const { css } = await less.render(await readFile(lessFile, 'utf8'), {
  filename: lessFile,
  paths: [dirname(lessFile)]
});

await writeFile(join(root, 'public', 'build', 'properties-panel.css'), css);

const notices = await writeNotices({
  root,
  inputs: { ...server.metafile.inputs, ...editor.metafile.inputs },
  out: join(root, 'THIRD_PARTY_NOTICES.md')
});

console.log(`built dist/server.mjs, public/vendor/ and public/build/; ${notices.file} lists ${notices.count} packages`);
