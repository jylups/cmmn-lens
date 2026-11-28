import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cp, copyFile, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const PACKAGE = join(import.meta.dirname, '..');

test('the built server runs with no dependencies installed, as the published package does', async () => {
  // what npm publishes: dist, public and package.json, with no node_modules next to them
  const installed = await mkdtemp(join(tmpdir(), 'cmmn-lens-package-'));
  const project = await mkdtemp(join(tmpdir(), 'cmmn-lens-project-'));

  try {
    await cp(join(PACKAGE, 'dist'), join(installed, 'dist'), { recursive: true });
    await cp(join(PACKAGE, 'public'), join(installed, 'public'), { recursive: true });
    await copyFile(join(PACKAGE, 'package.json'), join(installed, 'package.json'));
    await copyFile(join(PACKAGE, 'test', 'fixtures', 'claim.cmmn'), join(project, 'claim.cmmn'));

    const client = new Client({ name: 'bundle-test', version: '0.0.0' });

    await client.connect(new StdioClientTransport({
      command: process.execPath,
      args: [join(installed, 'dist', 'server.mjs')],
      cwd: '/',
      env: { ...process.env, CLAUDE_PROJECT_DIR: project, CMMN_LENS_REGISTRY_DIR: join(project, '.registry') },
      stderr: 'inherit'
    }));

    try {
      const { tools } = await client.listTools();

      assert.deepEqual(tools.map(tool => tool.name).sort(), ['get_changes', 'get_selection', 'highlight', 'open_view', 'validate']);

      const view = await client.callTool({ name: 'open_view', arguments: { path: 'claim.cmmn' } });
      const url = view.structuredContent.url;

      for (const path of ['/assets/cmmn-navigated-viewer.js', '/assets/flowable.json', '/assets/cmmn-js-touch.css', '/assets/cmmn-js-flowable-tools.css', '/assets/build/cmmn/editor.js', '/assets/build/cmmn/properties-panel.css']) {
        assert.equal((await fetch(new URL(path, url))).status, 200, path);
      }

      const validation = await client.callTool({ name: 'validate', arguments: { path: 'claim.cmmn' } });

      assert.equal(validation.content[0].text, 'claim.cmmn: no problems found.');
    } finally {
      await client.close();
    }
  } finally {
    await rm(installed, { recursive: true });
    await rm(project, { recursive: true });
  }
});

test('the BPMN viewer bundle knows the edge dockers Flowable writes on every edge, so they raise no import warnings', async () => {
  // flowable-bpmn-js 0.1.0's bundle was built with flowable-bpmn-moddle 0.1.0, which lacked them
  const viewer = await readFile(join(PACKAGE, 'public', 'vendor', 'bpmn', 'flowable-bpmn-navigated-viewer.js'), 'utf8');
  const editor = await readFile(join(PACKAGE, 'public', 'build', 'bpmn', 'editor.js'), 'utf8');

  for (const name of ['sourceDockerX', 'sourceDockerY', 'targetDockerX', 'targetDockerY']) {
    assert.ok(viewer.includes(name), `the viewer bundle has ${name}`);
    assert.ok(editor.includes(name), `the editor bundle has ${name}`);
  }
});
