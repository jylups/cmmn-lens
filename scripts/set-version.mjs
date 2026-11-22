// Sets the version of a release everywhere it is written: the plugin's
// manifest, the server package (and the lockfile), and the server version
// the plugin pins in its .mcp.json. Add the CHANGELOG entry by hand.
//
//   node scripts/set-version.mjs 0.2.0

import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const root = join(import.meta.dirname, '..');
const version = process.argv[2];

if (!/^\d+\.\d+\.\d+(-[\w.]+)?$/.test(version ?? '')) {
  console.error('usage: node scripts/set-version.mjs <version>, such as 0.2.0');
  process.exit(1);
}

function update(path, change) {
  const file = join(root, path);
  const json = JSON.parse(readFileSync(file, 'utf8'));

  change(json);
  writeFileSync(file, `${JSON.stringify(json, null, 2)}\n`);
}

update('plugins/cmmn-lens/.claude-plugin/plugin.json', json => { json.version = version; });

execFileSync('npm', ['version', version, '--workspace', 'server', '--no-git-tag-version', '--allow-same-version'], {
  cwd: root,
  stdio: 'inherit'
});

const { name } = JSON.parse(readFileSync(join(root, 'server/package.json'), 'utf8'));

update('plugins/cmmn-lens/.mcp.json', json => {
  const args = json.mcpServers['cmmn-lens'].args;
  const index = args.findIndex(arg => arg.startsWith(`${name}@`));

  args[index] = `${name}@${version}`;
});

console.log(`set ${version} in plugin.json, server/package.json and .mcp.json; now add "## ${version} (YYYY-MM-DD)" to CHANGELOG.md`);
