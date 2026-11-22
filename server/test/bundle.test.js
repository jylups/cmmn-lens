import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cp, copyFile, mkdtemp, rm } from 'node:fs/promises';
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

      for (const path of ['/assets/cmmn-navigated-viewer.js', '/assets/flowable.json', '/assets/build/editor.js']) {
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
