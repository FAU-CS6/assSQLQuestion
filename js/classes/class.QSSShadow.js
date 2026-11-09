/** Browser-only, experimental parallel assessment. Never changes the ILIAS score. */
class QSSShadow
{
  constructor(config)
  {
    this.config = config;
    this.labels = config.labels || {};
    this.worker = null;
    this.resolve = null;
    this.job = 0;
    this.result = null;
    this.card = null;
    this.configElement = document.getElementById('qpisql-qss-config');
    this.area = null;
  }

  static configuration()
  {
    const element = document.getElementById('qpisql-qss-config');
    if (!element) return null;
    try {
      const config = JSON.parse(element.dataset.config);
      return config.enabled && config.mode === 'shadow' ? config : null;
    } catch (error) { return null; }
  }

  /** Historical syntax-comparison results must never appear as current QSS. */
  static isCurrentModel(result, config = {})
  {
    if (!result || result.engine !== (config.engine || 'graph-qss-sqlite-v2')
      || String(result.version) !== (config.engineVersion || '2.0.1')) return false;
    if (result.status === 'exact' || result.status === 'score-zero-certified') {
      return result.rubric === (config.rubric || 'paper-linear-v1')
        && result.scale === (config.scale === undefined ? 1 : config.scale);
    }
    return true;
  }

  /** Keep autosave diagnostics bounded; full graph states stay in the worker. */
  static sidecar(result)
  {
    const keys = ['status', 'engine', 'version', 'modelVersion', 'distance', 'points', 'maxPoints',
      'exactWithinModel', 'answerDigest', 'referenceRevision', 'lowerBound', 'upperBound',
      'runtimeMs', 'visited', 'visitedStates', 'formula', 'scale', 'pointsPerEdit',
      'scoreCertifiedWithinModel', 'validation', 'code', 'message', 'provisionalRubric', 'rubric'];
    const saved = {};
    for (const key of keys) if (result[key] !== undefined) saved[key] = result[key];
    saved.limitations = (result.limitations || []).slice(0, 12).map(value => String(value).slice(0, 512));
    saved.edits = (result.edits || []).slice(0, 50).map(edit => {
      if (!edit || typeof edit !== 'object') return String(edit).slice(0, 256);
      const summary = {};
      for (const key of ['type', 'name', 'description', 'path']) {
        if (edit[key] !== undefined) summary[key] = String(edit[key]).slice(0, key === 'description' ? 512 : 256);
      }
      if (Number.isFinite(edit.cost)) summary.cost = edit.cost;
      return summary;
    });
    saved.editsTruncated = Boolean(result.editsTruncated) || (result.edits || []).length > saved.edits.length;
    // Reserve enough space for long Unicode descriptions and answer bindings.
    while (saved.edits.length && new TextEncoder().encode(JSON.stringify(saved)).length > 16000) {
      saved.edits.pop(); saved.editsTruncated = true;
    }
    return saved;
  }

  label(key)
  {
    return this.labels[key] || key;
  }

  mount()
  {
    const area = document.getElementById('qpisql-output-area');
    if (!area || !this.isCurrent()) return null;
    this.area = area;
    if (!this.card || !area.contains(this.card)) {
      this.card = document.createElement('section');
      this.card.className = 'qpisql-qss-shadow';
      this.card.id = 'qpisql-qss-shadow';
      this.card.setAttribute('aria-label', this.label('title'));
      area.insertBefore(this.card, document.getElementById('qpisql-output-area-relation'));
    }
    return this.card;
  }

  isCurrent()
  {
    return this.configElement === document.getElementById('qpisql-qss-config')
      && (!this.area || this.area === document.getElementById('qpisql-output-area'));
  }

  message(text, busy)
  {
    const card = this.mount();
    if (!card) return;
    card.replaceChildren();
    const title = document.createElement('strong');
    title.textContent = this.label('title');
    const note = document.createElement('p');
    note.className = 'qpisql-qss-note';
    note.textContent = this.label('shadow');
    const status = document.createElement('div');
    status.className = 'qpisql-qss-status';
    status.setAttribute('role', 'status');
    status.setAttribute('aria-live', 'polite');
    status.textContent = text;
    card.append(title, note, status);
    card.setAttribute('aria-busy', busy ? 'true' : 'false');
    if (busy) {
      const progress = document.createElement('progress');
      progress.setAttribute('aria-label', this.label('waiting'));
      card.appendChild(progress);
    }
  }

  clear()
  {
    this.result = null;
    const input = document.getElementById('qpisql-qss-evaluation');
    if (input) input.value = '';
    this.message(this.label('notEvaluated'), false);
  }

  progress(data)
  {
    const phase = this.labels[data.phase] ? data.phase : 'comparing';
    const parts = [this.label(phase)];
    if (Number.isFinite(data.visited)) parts.push(this.label('visited') + ': ' + data.visited.toLocaleString());
    if (Number.isFinite(data.lowerBound)) parts.push(this.label('lowerBound') + ': ' + data.lowerBound);
    this.message(parts.join(' · '), true);
    const progress = this.card && this.card.querySelector('progress');
    if (progress && Number.isFinite(data.completed) && Number.isFinite(data.total) && data.total > 0) {
      progress.max = data.total;
      progress.value = data.completed;
    }
  }

  static async digest(answer)
  {
    if (!window.crypto || !window.crypto.subtle) return undefined;
    const bytes = await window.crypto.subtle.digest('SHA-256', new TextEncoder().encode(answer));
    return Array.from(new Uint8Array(bytes), byte => byte.toString(16).padStart(2, '0')).join('');
  }

  async evaluate(snapshot)
  {
    const id = ++this.job;
    this.progress({ phase: 'parsing' });
    const digest = await QSSShadow.digest(snapshot.answer);
    if (id !== this.job) return { status: 'cancelled' };
    return new Promise(resolve => {
      this.resolve = resolve;
      let settled = false;
      const finish = result => {
        if (id !== this.job || settled) return;
        if (!this.isCurrent()) { this.abortSilently(); return; }
        settled = true;
        if (!result || typeof result !== 'object') result = { status: 'error', limitations: [this.label('failed')] };
        this.dispose();
        this.resolve = null;
        result.referenceRevision = this.config.referenceRevision;
        if (digest) result.answerDigest = digest;
        this.result = QSSShadow.sidecar(result);
        const input = document.getElementById('qpisql-qss-evaluation');
        if (input) input.value = JSON.stringify(this.result);
        this.render(result);
        resolve(result);
      };
      try {
        this.worker = new Worker(window.QPISQL_URL_PATH + '/lib/qss/worker.qss.js');
        this.worker.onmessage = event => {
          const data = event.data || {};
          if (data.id !== id || id !== this.job) return;
          if (data.type === 'progress') this.progress(data);
          if (data.type === 'result') finish(data.result);
          if (data.type === 'error') finish({ status: 'error', engine: 'qss', version: '1', limitations: [String(data.message || '')] });
        };
        this.worker.onerror = event => {
          if (event.preventDefault) event.preventDefault();
          finish({ status: 'error', engine: 'qss', version: '1', limitations: [String(event.message || this.label('failed'))] });
        };
        this.worker.postMessage({ type: 'evaluate', id, engine: this.config.engine || 'graph-qss-sqlite-v2',
          scale: this.config.scale === undefined ? 1 : this.config.scale, reference: snapshot.reference,
          answer: snapshot.answer, schema: snapshot.schema, schemaSql: snapshot.schemaSql, maxPoints: snapshot.maxPoints,
          referenceExecutionValid: snapshot.referenceExecutionValid,
          answerExecutionValid: snapshot.answerExecutionValid });
      } catch (error) {
        finish({ status: 'error', engine: 'qss', version: '1', limitations: [String(error.message)] });
      }
    });
  }

  dispose()
  {
    if (!this.worker) return;
    this.worker.onmessage = null;
    this.worker.onerror = null;
    this.worker.terminate();
    this.worker = null;
  }

  abortSilently()
  {
    ++this.job;
    this.dispose();
    const resolve = this.resolve;
    this.resolve = null;
    if (resolve) resolve({ status: 'cancelled' });
  }

  cancel()
  {
    ++this.job;
    this.dispose();
    const resolve = this.resolve;
    this.resolve = null;
    this.clear();
    this.message(this.label('cancelled'), false);
    if (resolve) resolve({ status: 'cancelled' });
  }

  render(result)
  {
    const success = result.status === 'exact' || result.status === 'score-zero-certified';
    if (success && !QSSShadow.isCurrentModel(result, this.config)) {
      this.message(this.label('stale'), false);
      return;
    }
    this.message(this.label(success ? 'completed' : result.status === 'unsupported' ? 'unsupported'
      : result.status === 'cancelled' ? 'cancelled' : 'failed'), false);
    if (!this.card) return;
    if (success) {
      const summary = document.createElement('p');
      summary.className = 'qpisql-qss-score';
      const distance = Number.isFinite(result.distance) ? Number(result.distance).toLocaleString()
        : Number.isFinite(result.lowerBound) ? '≥ ' + Number(result.lowerBound).toLocaleString() : '—';
      summary.textContent = this.label('points') + ': ' + Number(result.points).toLocaleString() + ' / '
        + Number(result.maxPoints).toLocaleString() + ' · ' + this.label('distance') + ': ' + distance;
      this.card.appendChild(summary);
    }
    const details = document.createElement('details');
    const heading = document.createElement('summary');
    heading.textContent = this.label('details');
    details.appendChild(heading);
    const model = document.createElement('p');
    model.textContent = this.label('model') + ': ' + String(result.engine || '') + ' · ' + String(result.version || '');
    details.appendChild(model);
    for (const text of (result.limitations || []).slice(0, 12)) {
      const item = document.createElement('p'); item.textContent = String(text); details.appendChild(item);
    }
    const list = document.createElement('ol');
    for (const edit of (result.edits || []).slice(0, 50)) {
      const item = document.createElement('li');
      if (edit === null || typeof edit !== 'object') item.textContent = String(edit);
      else if (edit.description || edit.name) item.textContent = String(edit.description || edit.name)
        + ' · ' + this.label('cost') + ': ' + Number(edit.cost || 0);
      else {
        const labels = { insert: 'editInsert', delete: 'editDelete', replace: 'editReplace' };
        const before = edit.before ? String(edit.before.value || edit.before.kind || '') : '';
        const after = edit.after ? String(edit.after.value || edit.after.kind || '') : '';
        item.textContent = this.label(labels[edit.type] || 'edits') + ': ' + before
          + (before && after ? ' → ' : '') + after + ' · ' + this.label('cost') + ': ' + Number(edit.cost || 0);
      }
      list.appendChild(item);
    }
    if (list.childElementCount) details.appendChild(list);
    this.card.appendChild(details);
  }

  static renderStored(container)
  {
    for (const card of container.querySelectorAll(':scope > .qpisql-qss-shadow')) card.remove();
    if (!container.dataset.qssEvaluation) return;
    try {
      const qss = new QSSShadow({ labels: JSON.parse(container.dataset.qssLabels || '{}') });
      qss.card = document.createElement('section');
      qss.card.className = 'qpisql-qss-shadow';
      container.appendChild(qss.card);
      qss.mount = () => qss.card;
      const result = JSON.parse(container.dataset.qssEvaluation);
      if (!QSSShadow.isCurrentModel(result) || (container.dataset.qssReferenceRevision
        && result.referenceRevision !== container.dataset.qssReferenceRevision)) {
        qss.message(qss.label('stale'), false);
      } else qss.render(result);
    } catch (error) { /* Older answers and malformed sidecars retain their ordinary result. */ }
  }
}
