import { test } from 'node:test';
import assert from 'node:assert/strict';
import { copyFile, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const SERVER = join(import.meta.dirname, '..', 'src', 'index.js');
const FIXTURES = join(import.meta.dirname, 'fixtures');

async function connect(cwd = FIXTURES) {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [SERVER],
    cwd,
    stderr: 'inherit'
  });
  const client = new Client({ name: 'cmmn-lens-test', version: '0.0.0' });

  await client.connect(transport);

  return client;
}

test('open_view returns a working URL, and the web server stops with the MCP server', async () => {
  const client = await connect();
  let url;

  try {
    const { tools } = await client.listTools();
    const openView = tools.find(tool => tool.name === 'open_view');

    assert.ok(openView, 'open_view is listed');
    assert.equal(openView.annotations.readOnlyHint, true);

    const result = await client.callTool({ name: 'open_view', arguments: { path: 'claim.cmmn' } });

    assert.equal(result.isError, undefined);
    assert.match(result.content[0].text, /^Viewer for claim\.cmmn: http:\/\/127\.0\.0\.1:/);

    url = result.structuredContent.url;

    const response = await fetch(url);

    assert.equal(response.status, 200);
    assert.match(await response.text(), /claim\.cmmn/);
  } finally {
    await client.close();
  }

  // the child exits after the client closes stdin; give it a moment
  for (let attempt = 0; attempt < 20; attempt++) {
    try {
      await fetch(url);
    } catch {
      return;
    }

    await new Promise(resolve => setTimeout(resolve, 100));
  }

  assert.fail('the web server is still answering after the MCP server closed');
});

test('open_view reports a missing file as a tool error', async () => {
  const client = await connect();

  try {
    const result = await client.callTool({ name: 'open_view', arguments: { path: 'missing.cmmn' } });

    assert.equal(result.isError, true);
    assert.match(result.content[0].text, /missing\.cmmn doesn't exist/);
  } finally {
    await client.close();
  }
});

test('validate lists the problems of a file with their element ids', async () => {
  const folder = await mkdtemp(join(tmpdir(), 'cmmn-lens-'));
  const client = await connect(folder);

  try {
    await copyFile(join(FIXTURES, 'claim.cmmn'), join(folder, 'claim.cmmn'));

    const clean = await client.callTool({ name: 'validate', arguments: { path: 'claim.cmmn' } });

    assert.equal(clean.content[0].text, 'claim.cmmn: no problems found.');
    assert.equal(clean.structuredContent.isValid, true);

    const xml = (await readFile(join(folder, 'claim.cmmn'), 'utf8')).replace('definitionRef="Task_approve"', 'definitionRef="Task_gone"');
    await writeFile(join(folder, 'claim.cmmn'), xml);

    const broken = await client.callTool({ name: 'validate', arguments: { path: 'claim.cmmn' } });

    assert.equal(broken.isError, undefined, 'problems in the file are a result, not a tool error');
    assert.match(broken.content[0].text, /^claim\.cmmn: 1 error\n- error \(PI_approve, line \d+\): unresolved reference <Task_gone>$/);
    assert.equal(broken.structuredContent.isValid, false);
    assert.equal(broken.structuredContent.problems[0].elementId, 'PI_approve');
  } finally {
    await client.close();
    await rm(folder, { recursive: true });
  }
});

test('validate reports a path it cannot check as a tool error', async () => {
  const client = await connect();

  try {
    const result = await client.callTool({ name: 'validate', arguments: { path: 'notes.txt' } });

    assert.equal(result.isError, true);
    assert.match(result.content[0].text, /is not a CMMN file/);
  } finally {
    await client.close();
  }
});
