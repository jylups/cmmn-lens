import CmmnModdle from '@jylups/cmmn-moddle';
import flowable from 'flowable-cmmn-moddle/resources/flowable.json' with { type: 'json' };

/** A moddle that reads CMMN with the Flowable extensions, as the viewer does. */
export function createModdle() {
  return new CmmnModdle({ flowable });
}

/**
 * Parses CMMN XML. Rejects when the XML doesn't parse.
 *
 * @param {string} xml
 * @returns {Promise<{ rootElement: object, elementsById: Record<string, object>, warnings: object[] }>}
 */
export function parseCmmn(xml) {
  return createModdle().fromXML(xml, 'cmmn:Definitions');
}

/**
 * The line and column (1-based) of the element with an id, found by its `id`
 * attribute in the source; empty when the source has no such attribute.
 *
 * @param {string} xml
 * @param {string} id
 * @returns {{ line?: number, column?: number }}
 */
export function locate(xml, id) {
  const escaped = id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = new RegExp(`\\sid\\s*=\\s*(["'])${escaped}\\1`).exec(xml);

  if (!match) {
    return {};
  }

  const line = xml.slice(0, match.index + 1).split('\n').length;
  const tagStart = xml.lastIndexOf('<', match.index);
  const lineStart = xml.lastIndexOf('\n', tagStart) + 1;

  return { line, column: tagStart - lineStart + 1 };
}
