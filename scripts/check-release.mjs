// Checks that a release tag matches the code it is on: the tag, the
// plugin's version, the server package's version and the server version the
// plugin pins are the same, and CHANGELOG.md has a dated entry for it.
//
//   node scripts/check-release.mjs v0.1.0

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = join(import.meta.dirname, '..');
const read = path => readFileSync(join(root, path), 'utf8');
const tag = process.argv[2] ?? '';
const version = tag.replace(/^v/, '');
const problems = [];

const plugin = JSON.parse(read('plugins/cmmn-lens/.claude-plugin/plugin.json'));
const server = JSON.parse(read('server/package.json'));
const pinned = JSON.parse(read('plugins/cmmn-lens/.mcp.json')).mcpServers['cmmn-lens'].args
  .find(arg => arg.startsWith(`${server.name}@`));

if (!/^v\d+\.\d+\.\d+(-[\w.]+)?$/.test(tag)) {
  problems.push(`the tag ${tag || '(none)'} is not v<major>.<minor>.<patch>`);
}

if (plugin.version !== version) {
  problems.push(`plugin.json has version ${plugin.version}`);
}

if (server.version !== version) {
  problems.push(`server/package.json has version ${server.version}`);
}

if (pinned !== `${server.name}@${version}`) {
  problems.push(`.mcp.json pins ${pinned}`);
}

if (!new RegExp(`^## ${version.replaceAll('.', '\\.')} \\(\\d{4}-\\d{2}-\\d{2}\\)$`, 'm').test(read('CHANGELOG.md'))) {
  problems.push(`CHANGELOG.md has no dated entry "## ${version} (YYYY-MM-DD)"`);
}

if (problems.length) {
  console.error(`The release ${tag} doesn't match the code:\n- ${problems.join('\n- ')}`);
  process.exit(1);
}

console.log(`${tag} matches the plugin, the server package and the changelog`);
