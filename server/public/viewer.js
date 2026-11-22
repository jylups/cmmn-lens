/* global CmmnJS */

(function() {
  'use strict';

  var config = JSON.parse(document.getElementById('cmmn-lens-config').textContent);
  var statusEl = document.getElementById('status');
  var canvasEl = document.getElementById('canvas');

  function setStatus(text, kind) {
    statusEl.textContent = text;
    statusEl.setAttribute('data-kind', kind || 'ok');
  }

  function fetchOk(url) {
    return fetch(url, { cache: 'no-store' }).then(function(response) {
      if (!response.ok) {
        return response.text().then(function(text) {
          throw new Error(text || response.statusText);
        });
      }

      return response;
    });
  }

  function hasSize() {
    return canvasEl.clientWidth > 0 && canvasEl.clientHeight > 0;
  }

  /**
   * Zooms to fit once the canvas has a size. Zooming an empty viewport (inside
   * the import callback, or while the pane that shows the page is still
   * opening) divides by zero, so this waits for the canvas to be laid out.
   */
  function fitViewport(viewer) {
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

  function importDiagram(viewer, xml) {
    viewer.importXML(xml, function(error, warnings) {
      if (error) {
        setStatus('Couldn\'t open the diagram: ' + error.message, 'error');

        return;
      }

      fitViewport(viewer);

      var count = (warnings || []).length;

      if (count) {
        console.warn('cmmn-lens: import warnings', warnings);
      }

      setStatus(count ? 'Opened with ' + count + ' warning' + (count === 1 ? '' : 's') : 'Opened', count ? 'warning' : 'ok');
    });
  }

  Promise.all([
    fetchOk(config.flowableUrl).then(function(response) { return response.json(); }),
    fetchOk(config.diagramUrl).then(function(response) { return response.text(); })
  ]).then(function(results) {
    var viewer = new CmmnJS({
      container: canvasEl,
      moddleExtensions: { flowable: results[0] }
    });

    window.addEventListener('resize', function() {
      viewer.get('canvas').resized();
    });

    importDiagram(viewer, results[1]);
  }).catch(function(error) {
    setStatus('Couldn\'t load the diagram: ' + error.message, 'error');
  });
})();
