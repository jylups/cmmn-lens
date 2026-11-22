/* global CmmnJS */

(function() {
  'use strict';

  var config = JSON.parse(document.getElementById('cmmn-lens-config').textContent);
  var statusEl = document.getElementById('status');
  var canvasEl = document.getElementById('canvas');
  var problemsEl = document.getElementById('problems');
  var problemsSummaryEl = document.getElementById('problems-summary');
  var problemsListEl = document.getElementById('problems-list');

  var viewer = null;

  // the version of the file the page shows, and the XML of the last version
  // that opened, which the page goes back to when a new version fails
  var shownVersion = null;
  var lastGood = null;

  // the newest state the event stream reported, and whether a load runs
  var fileState = null;
  var isLoading = false;

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

  function importXML(xml) {
    return new Promise(function(resolve) {
      viewer.importXML(xml, function(error, warnings) {
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
      shownVersion = version;
      showProblems(result.error, result.warnings);

      if (!result.error) {
        lastGood = xml;
        restoreViewbox(box);

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

    if (fileState.version === shownVersion) {
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

  fetch(config.flowableUrl).then(function(response) {
    if (!response.ok) {
      throw new Error(response.statusText);
    }

    return response.json();
  }).then(function(descriptor) {
    viewer = new CmmnJS({
      container: canvasEl,
      moddleExtensions: { flowable: descriptor }
    });

    window.addEventListener('resize', function() {
      viewer.get('canvas').resized();
    });

    follow();
  }).catch(function(error) {
    setStatus('Couldn\'t start the viewer: ' + error.message, 'error');
  });
})();
