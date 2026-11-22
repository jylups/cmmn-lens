/**
 * The read-only properties panel: shows the selected elements as the server
 * describes them from the file (server/src/selection.js). Every value is set
 * as text, never parsed as HTML.
 */
(function() {
  'use strict';

  /** `cmmn:HumanTask` → "Human task"; `casePlanModel` → "Case plan model". */
  function typeLabel(type) {
    var words = String(type || '').replace(/^[a-z]+:/, '').replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase();

    return words.charAt(0).toUpperCase() + words.slice(1);
  }

  function el(tag, className, text) {
    var node = document.createElement(tag);

    if (className) {
      node.className = className;
    }

    if (text !== undefined) {
      node.textContent = text;
    }

    return node;
  }

  /** A list of name–value rows; values that are lists become one row each. */
  function rows(entries) {
    var list = el('dl', 'properties-rows');

    entries.forEach(function(entry) {
      if (entry[1] === undefined || entry[1] === null || entry[1] === '') {
        return;
      }

      list.appendChild(el('dt', entry[2] ? 'is-code' : '', entry[0]));
      list.appendChild(el('dd', '', String(entry[1])));
    });

    return list.childNodes.length ? list : null;
  }

  function attributeRows(attributes) {
    return Object.keys(attributes || {}).map(function(name) {
      return [name, attributes[name], true];
    });
  }

  function section(title, children) {
    var node = el('section', 'properties-section');
    var content = children.filter(Boolean);

    if (!content.length) {
      return null;
    }

    node.appendChild(el('h3', '', title));
    content.forEach(function(child) { node.appendChild(child); });

    return node;
  }

  function onPartText(onPart) {
    var source = onPart.sourceName ? onPart.sourceName + ' (' + onPart.source + ')' : onPart.source;

    return [source, onPart.event].filter(Boolean).join(': ');
  }

  /** A sentry as lines: each on part, then the if part. */
  function sentryList(sentry) {
    var list = el('ul', 'properties-list');

    (sentry.onParts || []).forEach(function(onPart) {
      list.appendChild(el('li', '', 'On ' + onPartText(onPart)));
    });

    if (sentry.ifPart) {
      list.appendChild(el('li', 'is-code', 'If ' + sentry.ifPart));
    }

    if (!list.childNodes.length) {
      list.appendChild(el('li', '', 'Sentry ' + sentry.id + ' has no on part or if part'));
    }

    return list;
  }

  function criteriaSection(title, criteria) {
    if (!criteria || !criteria.length) {
      return null;
    }

    return section(title, criteria.map(function(criterion) {
      var item = el('div', 'properties-criterion');

      item.appendChild(el('div', 'properties-id', criterion.id));

      if (criterion.sentry) {
        item.appendChild(sentryList(criterion.sentry));
      }

      return item;
    }));
  }

  function describeElement(element) {
    var node = el('article', 'properties-element');

    if (element.isMissing) {
      node.appendChild(el('p', 'properties-note', element.id + ' is no longer in the file.'));

      return node;
    }

    var definition = element.definition;
    var name = element.name || (definition && definition.name);
    var type = typeLabel(element.type) + (definition ? ' · ' + typeLabel(definition.type) : '');

    node.appendChild(el('div', 'properties-type', type));
    node.appendChild(el('div', 'properties-name', name || element.id));

    [
      rows([
        ['Id', element.id, true],
        ['Line', element.line],
        ['In', element.stage && (element.stage.name || element.stage.id)],
        ['Of', element.planItem && (element.planItem.name || element.planItem.id)],
        ['Source', element.source && onPartText(element)]
      ].concat(attributeRows(element.attributes))),
      definition && section(typeLabel(definition.type), [
        rows([['Id', definition.id, true]].concat(attributeRows(definition.attributes))),
        definition.extensionElements && rows([['Extensions', definition.extensionElements.join(', ')]])
      ]),
      element.extensionElements && rows([['Extensions', element.extensionElements.join(', ')]]),
      criteriaSection('Entry criteria', element.entryCriteria),
      criteriaSection('Exit criteria', element.exitCriteria),
      element.sentry && section('Sentry', [sentryList(element.sentry)])
    ].forEach(function(child) {
      if (child) {
        node.appendChild(child);
      }
    });

    return node;
  }

  /**
   * @param {HTMLElement} body where the panel draws
   * @param {HTMLElement} title the panel's heading
   */
  window.cmmnLensProperties = function(body, title) {
    function replace(children, heading) {
      title.textContent = heading;
      body.textContent = '';
      children.forEach(function(child) { body.appendChild(child); });
    }

    return {
      /**
       * @param {null | { elements?: object[], error?: string }} result null
       *   when nothing is selected
       */
      show: function(result) {
        if (!result || (result.elements && !result.elements.length)) {
          replace([el('p', 'properties-empty', 'Select an element to see its properties.')], 'Properties');

          return;
        }

        if (result.error) {
          replace([el('p', 'properties-note', 'The file can\'t be read as CMMN right now: ' + result.error)], 'Properties');

          return;
        }

        var count = result.elements.length;

        replace(result.elements.map(describeElement), count === 1 ? 'Properties' : count + ' elements');
      }
    };
  };
})();
