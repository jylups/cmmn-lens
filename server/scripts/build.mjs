// Builds what the page loads in edit mode into public/build/:
// editor.js (the Modeler and the Flowable properties panel, bundled) and
// properties-panel.css (the panel's LESS styles, compiled); and writes
// THIRD_PARTY_NOTICES.md for every package the page gets code or files from.
//
//   npm run build --workspace server

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { build } from 'esbuild';
import less from 'less';

import { writeNotices } from './notices.mjs';

const require = createRequire(import.meta.url);
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'public', 'build');

await mkdir(out, { recursive: true });

const result = await build({
  entryPoints: [join(root, 'client', 'editor.js')],
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

const lessFile = require.resolve('cmmn-js-properties-panel-flowable/styles/properties.less');
const { css } = await less.render(await readFile(lessFile, 'utf8'), {
  filename: lessFile,
  paths: [dirname(lessFile)]
});

await writeFile(join(out, 'properties-panel.css'), css);

const notices = await writeNotices({ root, inputs: result.metafile.inputs, out: join(root, 'THIRD_PARTY_NOTICES.md') });

console.log(`built public/build/editor.js and public/build/properties-panel.css; ${notices.file} lists ${notices.count} packages`);
