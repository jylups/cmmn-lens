/* global CmmnJS */

(function() {
  'use strict';

  var config = JSON.parse(document.getElementById('cmmn-lens-config').textContent);
  var statusEl = document.getElementById('status');
  var canvasEl = document.getElementById('canvas');
  var problemsEl = document.getElementById('problems');
  var problemsSummaryEl = document.getElementById('problems-summary');
  var problemsListEl = document.getElementById('problems-list');
  var propertiesEl = document.getElementById('properties');
  var propertiesToggleEl = document.getElementById('properties-toggle');
  var properties = window.cmmnLensProperties(
    document.getElementById('properties-body'),
    document.getElementById('properties-title')
  );

  var propertiesBodyEl = document.getElementById('properties-body');
  var propertiesEditorEl = document.getElementById('properties-editor');
  var editButton = document.getElementById('edit');
  var saveButton = document.getElementById('save');
  var doneButton = document.getElementById('done');

  // the diagram: a NavigatedViewer in view mode, a Modeler with the Flowable
  // properties panel in edit mode (both answer the same calls used here)
  var viewer = null;
  var flowableDescriptor = null;
  var mode = 'view';
  var isDirty = false;
  var isSaving = false;
  var editorLoading = null;

  // a change to the file while there are unsaved edits: the version the
  // file holds, and the version the user chose to overwrite ("Keep my edits")
  var conflictEl = document.getElementById('conflict');
  var conflictVersion = null;
  var overwriteVersion = null;

  // the version of the file the page shows, and the XML of the last version
  // that opened, which the page goes back to when a new version fails
  var shownVersion = null;
  var lastGood = null;

  // the newest state the event stream reported, and whether a load runs
  var fileState = null;
  var isLoading = false;

  // the user's selection, as the semantic ids of the selected elements, kept
  // across re-imports and posted to the server when it changes
  var selectedIds = [];
  var isImporting = false;
  var postTimer = null;

  // the agent's highlight: the one waiting for its version of the file to be
  // shown, and the one marked on the canvas
  var HIGHLIGHT_MARKER = 'cmmn-lens-highlight';
  var pendingHighlight = null;
  var shownHighlight = null;

  // the properties panel's request in flight, so an older answer can't
  // replace a newer one
  var propertiesRequest = 0;

  function setStatus(text, kind) {
    statusEl.textContent = text;
    statusEl.setAttribute('data-kind', kind || 'ok');
  }

  function plural(count, word) {
    return count + ' ' + word + (count === 1 ? '' : 's');
  }

  function time() {
    return new Date().toLocaleTimeString();
  }

  /**
   * Lists the error and warnings of the last import under the bar.
   *
   * @param {Error} [error] the import error, if the import failed
   * @param {Array<{ message: string }>} [warnings]
   */
  function showProblems(error, warnings) {
    var messages = [];

    if (error) {
      messages.push({ kind: 'error', text: error.message });
    }

    (warnings || []).forEach(function(warning) {
      messages.push({ kind: 'warning', text: warning.message });
    });

    problemsListEl.textContent = '';
    messages.forEach(function(message) {
      var item = document.createElement('li');

      item.textContent = message.text;
      item.setAttribute('data-kind', message.kind);
      problemsListEl.appendChild(item);
    });

    var warningCount = (warnings || []).length;

    problemsSummaryEl.textContent = error ?
      'Import error' + (warningCount ? ' and ' + plural(warningCount, 'warning') : '') :
      plural(warningCount, 'import warning');
    problemsEl.hidden = !messages.length;
  }

  function hasSize() {
    return canvasEl.clientWidth > 0 && canvasEl.clientHeight > 0;
  }

  /**
   * Zooms to fit once the canvas has a size. Zooming an empty viewport (inside
   * the import callback, or while the pane that shows the page is still
   * opening) divides by zero, so this waits for the canvas to be laid out.
   */
  function fitViewport() {
    function fit() {
      try {
        var canvas = viewer.get('canvas');

        canvas.resized();
        canvas.zoom('fit-viewport');
      } catch (error) {
        console.warn('cmmn-lens: fit-viewport failed', error);
      }
    }

    if (hasSize()) {
      requestAnimationFrame(fit);

      return;
    }

    var observer = new ResizeObserver(function() {
      if (hasSize()) {
        observer.disconnect();
        fit();
      }
    });

    observer.observe(canvasEl);
  }

  /**
   * The zoom and the top left corner of the view, to keep across a re-import.
   * The scale is kept rather than the visible box, so the zoom stays the same
   * when the canvas changes size (the problems list opening, say).
   */
  function currentViewbox() {
    if (!lastGood || !hasSize()) {
      return null;
    }

    var box = viewer.get('canvas').viewbox();

    return { x: box.x, y: box.y, scale: box.scale };
  }

  function restoreViewbox(view) {
    if (!view) {
      fitViewport();

      return;
    }

    var canvas = viewer.get('canvas');

    canvas.resized();

    var size = canvas.getSize();

    canvas.viewbox({ x: view.x, y: view.y, width: size.width / view.scale, height: size.height / view.scale });
  }

  /** The semantic ids of selected diagram elements, labels counted as their element. */
  function idsOf(elements) {
    var ids = [];

    elements.forEach(function(element) {
      var id = element.businessObject && element.businessObject.id;

      if (id && ids.indexOf(id) < 0) {
        ids.push(id);
      }
    });

    return ids;
  }

  function sameIds(a, b) {
    return a.length === b.length && a.every(function(id, index) { return id === b[index]; });
  }

  /** Shows the selected elements' properties, as the file has them now. */
  function refreshProperties() {
    var request = ++propertiesRequest;

    // in edit mode the Flowable properties panel shows the selection
    if (mode === 'edit') {
      return;
    }

    if (!selectedIds.length) {
      properties.show(null);

      return;
    }

    fetch(config.describeUrl + '&ids=' + encodeURIComponent(selectedIds.join(',')), { cache: 'no-store' })
      .then(function(response) { return response.json(); })
      .then(function(result) {
        if (request === propertiesRequest) {
          properties.show(result);
        }
      })
      .catch(function(error) {
        if (request === propertiesRequest) {
          properties.show({ error: error.message });
        }
      });
  }

  function setPropertiesOpen(isOpen) {
    propertiesEl.classList.toggle('is-collapsed', !isOpen);
    propertiesToggleEl.textContent = isOpen ? 'Hide' : 'Show';
    propertiesToggleEl.setAttribute('aria-expanded', String(isOpen));

    try {
      localStorage.setItem('cmmn-lens-properties', isOpen ? 'open' : 'closed');
    } catch {
      // storage blocked: the choice lasts for this page only
    }

    if (viewer) {
      viewer.get('canvas').resized();
    }
  }

  /** Tells the server what is selected, once the selection has settled. */
  function postSelection() {
    clearTimeout(postTimer);
    postTimer = setTimeout(function() {
      fetch(config.selectionUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: selectedIds })
      }).catch(function(error) {
        console.warn('cmmn-lens: posting the selection failed', error);
      });
    }, 100);
  }

  function onSelectionChanged(event) {
    // an import clears the selection; that is not the user's doing
    if (isImporting) {
      return;
    }

    var ids = idsOf(event.newSelection);

    if (!sameIds(ids, selectedIds)) {
      selectedIds = ids;
      postSelection();
      refreshProperties();
    }
  }

  /** Selects again, after an import, the elements that are still there. */
  function restoreSelection() {
    var elements = viewer.get('elementRegistry').filter(function(element) {
      return !element.labelTarget && element.businessObject && selectedIds.indexOf(element.businessObject.id) >= 0;
    });

    viewer.get('selection').select(elements);

    var ids = idsOf(elements);

    if (!sameIds(ids, selectedIds)) {
      selectedIds = ids;
      postSelection();
    }
  }

  function importXML(xml) {
    isImporting = true;

    return new Promise(function(resolve) {
      viewer.importXML(xml, function(error, warnings) {
        if (!error) {
          restoreSelection();
        }

        isImporting = false;
        resolve({ error: error, warnings: warnings || [] });
      });
    });
  }

  /**
   * Shows a new version of the file. The first version is fitted to the
   * canvas; later ones keep the zoom and scroll position. A version that
   * fails to open leaves the last one that opened on the canvas.
   */
  function show(xml, version) {
    var box = currentViewbox();
    var isFirst = !lastGood;

    return importXML(xml).then(function(result) {
      // the import replaced the elements, and the marks with them
      shownHighlight = null;
      shownVersion = version;
      showProblems(result.error, result.warnings);

      if (!result.error) {
        lastGood = xml;
        restoreViewbox(box);
        syncHighlight();
        refreshProperties();
        updateButtons();

        var count = result.warnings.length;
        var opened = isFirst ? 'Opened' : 'Updated ' + time();

        setStatus(count ? opened + ' with ' + plural(count, 'warning') : opened, count ? 'warning' : 'ok');

        return;
      }

      // the error's details are in the problems list
      setStatus(
        isFirst ? 'Couldn\'t open the diagram.' : 'Couldn\'t open the new version. Showing the last version that opened.',
        'error'
      );

      if (!isFirst) {
        // an import error after parsing clears the canvas: draw the last good version again
        return importXML(lastGood).then(function() {
          restoreViewbox(box);
        });
      }
    });
  }

  function elementsOf(ids) {
    var registry = viewer.get('elementRegistry');

    return ids.map(function(id) { return registry.get(id); }).filter(Boolean);
  }

  function boundsOf(elements) {
    var box = null;

    elements.forEach(function(element) {
      var points = element.waypoints || [
        { x: element.x, y: element.y },
        { x: element.x + element.width, y: element.y + element.height }
      ];

      points.forEach(function(point) {
        if (!box) {
          box = { minX: point.x, minY: point.y, maxX: point.x, maxY: point.y };
        } else {
          box.minX = Math.min(box.minX, point.x);
          box.minY = Math.min(box.minY, point.y);
          box.maxX = Math.max(box.maxX, point.x);
          box.maxY = Math.max(box.maxY, point.y);
        }
      });
    });

    return box;
  }

  /**
   * Brings elements into view: nothing when they are visible, centered at the
   * same zoom when they fit, zoomed out to fit otherwise.
   */
  function scrollTo(elements) {
    var box = boundsOf(elements);

    if (!box || !hasSize()) {
      return;
    }

    var canvas = viewer.get('canvas');
    var view = canvas.viewbox();
    var padding = 40 / view.scale;
    var isVisible = box.minX >= view.x && box.minY >= view.y &&
      box.maxX <= view.x + view.width && box.maxY <= view.y + view.height;

    if (isVisible) {
      return;
    }

    var width = box.maxX - box.minX + 2 * padding;
    var height = box.maxY - box.minY + 2 * padding;

    if (width <= view.width && height <= view.height) {
      var centerX = (box.minX + box.maxX) / 2;
      var centerY = (box.minY + box.maxY) / 2;

      canvas.viewbox({ x: centerX - view.width / 2, y: centerY - view.height / 2, width: view.width, height: view.height });
    } else {
      canvas.viewbox({ x: box.minX - padding, y: box.minY - padding, width: width, height: height });
    }
  }

  function clearHighlight() {
    if (shownHighlight) {
      var canvas = viewer.get('canvas');

      elementsOf(shownHighlight.ids).forEach(function(element) {
        canvas.removeMarker(element, HIGHLIGHT_MARKER);
      });
    }

    shownHighlight = null;
  }

  /**
   * Marks the pending highlight once its version of the file is on the
   * canvas, and drops a marked one when another version has replaced it.
   */
  function syncHighlight() {
    if (shownHighlight && shownHighlight.version !== shownVersion) {
      clearHighlight();
    }

    if (!pendingHighlight || pendingHighlight.version !== shownVersion) {
      return;
    }

    clearHighlight();

    var highlight = pendingHighlight;
    var elements = elementsOf(highlight.ids);
    var canvas = viewer.get('canvas');

    pendingHighlight = null;
    shownHighlight = highlight;

    elements.forEach(function(element) {
      canvas.addMarker(element, HIGHLIGHT_MARKER);
    });

    scrollTo(elements);
  }

  function fetchDiagram() {
    return fetch(config.diagramUrl, { cache: 'no-store' }).then(function(response) {
      if (!response.ok) {
        return response.text().then(function(text) {
          throw new Error(text || response.statusText);
        });
      }

      return response.text().then(function(xml) {
        return { xml: xml, version: response.headers.get('X-Diagram-Version') };
      });
    });
  }

  /** Brings the page up to the newest state the event stream reported. */
  function sync() {
    if (isLoading || !fileState) {
      return;
    }

    if (!fileState.exists) {
      setStatus(config.name + ' was deleted or moved' + (lastGood ? '. Showing the last version.' : '.'), 'error');

      return;
    }

    if (fileState.version === shownVersion || isSaving) {
      return;
    }

    if (mode === 'edit' && isDirty) {
      // the unsaved edits stay until the user chooses
      if (fileState.version !== overwriteVersion && fileState.version !== conflictVersion) {
        showConflict(fileState.version);
      }

      return;
    }

    isLoading = true;

    fetchDiagram().then(function(diagram) {
      return diagram.version === shownVersion ? null : show(diagram.xml, diagram.version);
    }).catch(function(error) {
      setStatus('Couldn\'t load the diagram: ' + error.message, 'error');
    }).then(function() {
      isLoading = false;

      // the file may have changed again while this version loaded
      if (fileState.exists && fileState.version !== shownVersion) {
        sync();
      }
    });
  }

  /**
   * Follows the file through the server's event stream. The browser retries a
   * dropped stream; a server that stopped doesn't come back on the same port
   * and token, so the page gives up after a few failed retries.
   */
  function follow() {
    var events = new EventSource(config.eventsUrl);
    var failedRetries = 0;

    // the selection the server holds, sent on connect: a page that loads
    // again shows it, rather than leaving the server with a selection the
    // user can't see
    var hasSelectionFromServer = false;

    events.addEventListener('selection', function(event) {
      if (hasSelectionFromServer) {
        return;
      }

      hasSelectionFromServer = true;
      selectedIds = JSON.parse(event.data).ids || [];

      if (lastGood) {
        restoreSelection();
        refreshProperties();
      }
    });

    events.addEventListener('highlight', function(event) {
      pendingHighlight = JSON.parse(event.data);
      syncHighlight();
    });

    events.addEventListener('state', function(event) {
      fileState = JSON.parse(event.data);
      sync();
    });

    events.addEventListener('error', function() {
      failedRetries++;

      if (events.readyState === EventSource.CLOSED || failedRetries > 3) {
        events.close();
        setStatus('The viewer stopped. Changes to the file aren\'t shown; open the file again for a new view.', 'error');
      } else {
        setStatus('Reconnecting to the viewer…', 'warning');
      }
    });

    events.addEventListener('open', function() {
      var wasRetrying = failedRetries > 0;

      failedRetries = 0;

      if (wasRetrying && lastGood) {
        setStatus('Reconnected', 'ok');
      }
    });
  }

  function updateButtons() {
    editButton.hidden = mode !== 'view' || !lastGood;
    saveButton.hidden = mode !== 'edit';
    doneButton.hidden = mode !== 'edit';
    saveButton.disabled = !isDirty || isSaving;
    document.body.classList.toggle('is-editing', mode === 'edit');
    propertiesBodyEl.hidden = mode === 'edit';
    propertiesEditorEl.hidden = mode !== 'edit';
  }

  /** Asks the user what to do about a change to the file under unsaved edits. */
  function showConflict(version) {
    conflictVersion = version;
    conflictEl.hidden = false;
    setStatus('Unsaved changes. The file changed on disk.', 'warning');
  }

  function hideConflict() {
    conflictEl.hidden = true;
    conflictVersion = null;
  }

  /** Drops the unsaved edits and shows what the file holds. */
  function loadFileVersion() {
    hideConflict();
    overwriteVersion = null;
    isDirty = false;
    updateButtons();

    // force a reload even if the page thinks it shows that version
    shownVersion = null;
    sync();
  }

  /** Keeps the unsaved edits; the next save replaces the file's version. */
  function keepEdits() {
    overwriteVersion = conflictVersion;
    hideConflict();
    setStatus('Unsaved changes. Saving replaces the change on disk.', 'warning');
  }

  function markDirty() {
    if (isImporting) {
      return;
    }

    isDirty = true;
    setStatus('Unsaved changes', 'warning');
    updateButtons();
  }

  /** Replaces the diagram instance with a viewer or a modeler. */
  function createInstance(kind) {
    if (viewer) {
      viewer.destroy();
    }

    canvasEl.textContent = '';
    propertiesEditorEl.textContent = '';

    var options = {
      container: canvasEl,
      moddleExtensions: { flowable: flowableDescriptor }
    };

    if (kind === 'edit') {
      options.keyboard = { bind: true };
      options.additionalModules = window.CmmnLensEditor.modules;
      options.propertiesPanel = { parent: propertiesEditorEl };
      viewer = new window.CmmnLensEditor.Modeler(options);
      viewer.on('commandStack.changed', markDirty);
    } else {
      viewer = new CmmnJS(options);
    }

    viewer.on('selection.changed', onSelectionChanged);
  }

  /** Loads the editor bundle and the panel's styles, once. */
  function loadEditor() {
    if (!editorLoading) {
      editorLoading = new Promise(function(resolve, reject) {
        var style = document.createElement('link');

        style.rel = 'stylesheet';
        style.href = config.editorStyleUrl;
        document.head.appendChild(style);

        var script = document.createElement('script');

        script.src = config.editorScriptUrl;
        script.onload = function() { resolve(); };
        script.onerror = function() {
          editorLoading = null;
          reject(new Error('the editor isn\'t built (npm run build)'));
        };
        document.head.appendChild(script);
      });
    }

    return editorLoading;
  }

  /** Switches to a viewer or a modeler showing the last version that opened. */
  function switchTo(kind) {
    var box = currentViewbox();

    createInstance(kind);
    mode = kind;
    isDirty = false;
    updateButtons();

    return importXML(lastGood).then(function() {
      restoreViewbox(box);
      syncHighlight();
      refreshProperties();
    });
  }

  function enterEdit() {
    if (!lastGood) {
      return;
    }

    setStatus('Opening the editor…');

    loadEditor().then(function() {
      return switchTo('edit');
    }).then(function() {
      setStatus('Editing. Save writes the file.');
    }).catch(function(error) {
      setStatus('Couldn\'t open the editor: ' + error.message, 'error');
    });
  }

  function leaveEdit() {
    if (isDirty && !window.confirm('Discard the unsaved changes?')) {
      return;
    }

    hideConflict();
    overwriteVersion = null;

    switchTo('view').then(function() {
      setStatus('Opened');

      // the file may have changed while the editor was open
      sync();
    });
  }

  function save() {
    if (!isDirty || isSaving) {
      return;
    }

    isSaving = true;
    updateButtons();
    setStatus('Saving…');

    viewer.saveXML({ format: true }, function(error, xml) {
      if (error) {
        isSaving = false;
        updateButtons();
        setStatus('Couldn\'t export the model: ' + error.message, 'error');

        return;
      }

      fetch(config.saveUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ xml: xml, baseVersion: overwriteVersion || shownVersion })
      }).then(function(response) {
        if (response.status === 409) {
          // the file changed since the edits began: nothing was written
          return response.json().then(function(result) {
            showConflict(result.version);
            setStatus('Not saved: the file changed on disk. Choose which version to keep.', 'error');

            return null;
          });
        }

        return response.ok ? response.json() : response.text().then(function(text) { throw new Error(text); });
      }).then(function(result) {
        if (!result) {
          return;
        }

        lastGood = xml;
        shownVersion = result.version;
        overwriteVersion = null;
        isDirty = false;
        hideConflict();
        setStatus('Saved ' + time());
      }).catch(function(saveError) {
        setStatus('Couldn\'t save: ' + saveError.message, 'error');
      }).then(function() {
        isSaving = false;
        updateButtons();
        sync();
      });
    });
  }

  fetch(config.flowableUrl).then(function(response) {
    if (!response.ok) {
      throw new Error(response.statusText);
    }

    return response.json();
  }).then(function(descriptor) {
    flowableDescriptor = descriptor;
    createInstance('view');

    window.addEventListener('resize', function() {
      viewer.get('canvas').resized();
    });

    window.addEventListener('beforeunload', function(event) {
      if (isDirty) {
        event.preventDefault();
      }
    });

    editButton.addEventListener('click', enterEdit);
    saveButton.addEventListener('click', save);
    doneButton.addEventListener('click', leaveEdit);
    document.getElementById('conflict-reload').addEventListener('click', loadFileVersion);
    document.getElementById('conflict-keep').addEventListener('click', keepEdits);

    document.addEventListener('keydown', function(event) {
      if ((event.metaKey || event.ctrlKey) && event.key === 's' && mode === 'edit') {
        event.preventDefault();
        save();
      }
    });

    propertiesToggleEl.addEventListener('click', function() {
      setPropertiesOpen(propertiesEl.classList.contains('is-collapsed'));
    });

    try {
      if (localStorage.getItem('cmmn-lens-properties') === 'closed') {
        setPropertiesOpen(false);
      }
    } catch {
      // storage blocked: the panel starts open
    }

    follow();
  }).catch(function(error) {
    setStatus('Couldn\'t start the viewer: ' + error.message, 'error');
  });
})();
