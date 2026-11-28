/**
 * The namespace of the root element of XML, `<definitions xmlns="…">` or
 * `<cmmn:definitions xmlns:cmmn="…">`; null when there is none to find.
 *
 * @param {string} xml the document, or enough of its start to hold the root tag
 * @returns {string|null}
 */
export function rootNamespace(xml) {
  const body = xml
    .replace(/^\uFEFF/, '')
    .replace(/<\?[\s\S]*?\?>/g, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<!DOCTYPE[^>[]*(\[[\s\S]*?\])?\s*>/i, '');
  const tag = /<(?:([A-Za-z_][\w.-]*):)?[A-Za-z_][\w.-]*((?:\s+[^\s=>/]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*\/?>/.exec(body);

  if (!tag) {
    return null;
  }

  const [, prefix, attributes] = tag;
  const name = prefix ? `xmlns:${prefix}` : 'xmlns';

  for (const match of attributes.matchAll(/([^\s=]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) {
    if (match[1] === name) {
      return match[2] ?? match[3];
    }
  }

  return null;
}
