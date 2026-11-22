import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const root = join(import.meta.dirname, '..');
const readJson = path => JSON.parse(readFileSync(join(root, path), 'utf8'));

const marketplace = readJson('.claude-plugin/marketplace.json');

test('the marketplace lists each plugin at a folder with a manifest', () => {
  assert.ok(marketplace.plugins.length > 0);
  for (const entry of marketplace.plugins) {
    assert.match(entry.source, /^\.\//, `${entry.name}: source is a relative path`);
    assert.ok(existsSync(join(root, entry.source, '.claude-plugin/plugin.json')), `${entry.name}: plugin.json exists`);
  }
});

for (const entry of marketplace.plugins) {
  const plugin = readJson(join(entry.source, '.claude-plugin/plugin.json'));

  test(`${entry.name}: the marketplace entry matches plugin.json`, () => {
    assert.equal(plugin.name, entry.name);
    assert.equal(entry.version, undefined, 'version is set in plugin.json only');
  });

  test(`${entry.name}: plugin.json has the metadata a release needs`, () => {
    assert.match(plugin.version, /^\d+\.\d+\.\d+(-[\w.]+)?$/);
    for (const key of ['description', 'author', 'homepage', 'repository', 'license']) {
      assert.ok(plugin[key], `${key} is set`);
    }
  });

  test(`${entry.name}: the plugin folder carries its license`, () => {
    assert.ok(existsSync(join(root, entry.source, 'LICENSE')));
  });
}
