// Prints the CHANGELOG.md entry of a version, for the GitHub release notes.
//
//   node scripts/changelog-section.mjs 0.1.0

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const version = process.argv[2];
const lines = readFileSync(join(import.meta.dirname, '..', 'CHANGELOG.md'), 'utf8').split('\n');
const start = lines.findIndex(line => line.startsWith(`## ${version} `) || line === `## ${version}`);

if (start < 0) {
  console.error(`CHANGELOG.md has no entry for ${version}`);
  process.exit(1);
}

const end = lines.findIndex((line, index) => index > start && line.startsWith('## '));

console.log(lines.slice(start + 1, end < 0 ? undefined : end).join('\n').trim());
