/** Read-only, on-demand explanation of an already released QSS assessment. */
class QSSReviewPath
{
  static attach(qss, container, stored, request)
  {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'btn btn-default';
    button.textContent = qss.label('findPath');
    const status = document.createElement('p');
    status.setAttribute('role', 'status');
    const progress = document.createElement('progress');
    progress.setAttribute('aria-label', qss.label('pathRunning'));
    progress.hidden = true;
    container.append(button, status, progress);
    let controller = null;

    button.addEventListener('click', async () => {
      if (controller) { controller.abort(); return; }
      controller = new AbortController();
      const {signal} = controller;
      const stop = () => controller?.abort();
      // ILIAS can replace a result panel via AJAX while the worker is busy.
      const removal = new MutationObserver(() => { if (!container.isConnected) stop(); });
      removal.observe(document.body, {childList: true, subtree: true});
      window.addEventListener('pagehide', stop);
      button.textContent = qss.label('cancelPath');
      status.textContent = qss.label('pathRunning');
      progress.hidden = false;
      try {
        const schema = request.schemaUnavailable ? undefined : await SQLRun.preparedSchema(request.schemaSql, signal);
        const result = await QSSReviewPath.search(request, stored, schema, signal);
        signal.throwIfAborted();
        if (!container.isConnected) return;
        if (result.status !== 'exact' || result.traceVerified !== true || !result.exactWithinModel
            || !Number.isSafeInteger(result.distance) || result.distance < 0 || result.points !== stored.points
            || result.engine !== stored.engine || result.modelVersion !== stored.modelVersion
            || result.rubric !== stored.rubric || result.scale !== stored.scale || result.maxPoints !== stored.maxPoints
            || (stored.status === 'exact' ? result.distance !== stored.distance : result.distance < stored.lowerBound)) {
          throw new Error('Inconsistent path');
        }
        const returnFocus = document.activeElement === button;
        container.replaceChildren(status);
        status.textContent = qss.label('pathReady');
        qss.card.querySelector('.qpisql-qss-distance').textContent = result.distance.toLocaleString();
        qss.renderCorrections(result, container);
        if (returnFocus) { status.tabIndex = -1; status.focus(); }
      } catch (error) {
        if (container.isConnected) {
          status.textContent = qss.label(signal.aborted ? 'pathCancelled' : 'pathFailed');
          button.textContent = qss.label('findPath');
        }
      } finally {
        progress.hidden = true;
        removal.disconnect();
        window.removeEventListener('pagehide', stop);
        controller = null;
      }
    });
  }

  static async search(request, stored, schema, signal)
  {
    signal.throwIfAborted();
    const {workerRevision, schemaUnavailable, ...inputs} = request;
    const worker = new Worker(window.QPISQL_URL_PATH + '/lib/qss/worker.qss.js?v=' + encodeURIComponent(workerRevision));
    let abort;
    try {
      return await new Promise((resolve, reject) => {
        abort = () => reject(signal.reason);
        signal.addEventListener('abort', abort, {once: true});
        worker.onerror = event => { event.preventDefault?.(); reject(new Error(event.message)); };
        worker.onmessageerror = () => reject(new Error('Unreadable worker response'));
        worker.onmessage = ({data}) => {
          if (data?.id !== 1) return;
          if (data.type === 'result') resolve(data.result);
          if (data.type === 'error') reject(new Error(data.message));
        };
        worker.postMessage({...inputs, schema, id: 1, type: 'evaluate', engine: stored.engine,
          scale: stored.scale, maxPoints: stored.maxPoints, exactDistance: true, feedbackOnly: true});
      });
    } finally {
      signal.removeEventListener('abort', abort);
      worker.terminate();
    }
  }
}
