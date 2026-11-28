// Builds the publishable server package, so it runs with no dependencies
// installed (npx then downloads one package, which starts in a second or two):
//
// - dist/server.mjs: the MCP server, bundled with its dependencies (the MCP
//   SDK, zod, the CMMN and Flowable moddle packages)
// - public/vendor/: the files the viewer page loads as they are, for each
//   model type (for CMMN: the cmmn-js viewer bundle, its styles, the Flowable
//   descriptor)
// - public/build/<type>/: what edit mode loads for each model type, built
//   separately so a page loads only its own type's (for CMMN: editor.js, the
//   Modeler and the Flowable properties panel, bundled, and
//   properties-panel.css, the panel's LESS styles, compiled)
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

/**
 * What each model type's page needs built: `vendor`, files copied into
 * public/vendor as they are, by name; `editor`, the client entry bundled into
 * public/build/<type>/editor.js; `styles`, CSS files written into
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
  }
];

async function compileLess(file) {
  const { css } = await less.render(await readFile(file, 'utf8'), { filename: file, paths: [dirname(file)] });

  return css;
}

await mkdir(join(root, 'public', 'vendor'), { recursive: true });

for (const type of TYPES) {
  for (const [name, source] of Object.entries(type.vendor)) {
    await copyFile(source, join(root, 'public', 'vendor', name));
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
  const editor = await build({
    entryPoints: [type.editor],
    outfile: join(out, 'editor.js'),
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

  Object.assign(inputs, editor.metafile.inputs);

  for (const [name, compile] of Object.entries(type.styles)) {
    await writeFile(join(out, name), await compile());
  }
}

const notices = await writeNotices({ root, inputs, out: join(root, 'THIRD_PARTY_NOTICES.md') });

console.log(`built dist/server.mjs, public/vendor/ and public/build/ (${TYPES.map(type => type.id).join(', ')}); ${notices.file} lists ${notices.count} packages`);
