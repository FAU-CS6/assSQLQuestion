/** Browser-only Graph-QSS assessment for explicitly selected QSS questions. */
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
      return config.enabled && ['assessment', 'shadow'].includes(config.mode) ? config : null;
    } catch (error) { return null; }
  }

  /** Historical syntax-comparison results must never appear as current QSS. */
  static isCurrentModel(result, config = {})
  {
    if (!result || result.engine !== (config.engine || 'graph-qss-sqlite-v2')
      || String(result.version) !== (config.engineVersion || '2.1.1')) return false;
    if (result.status === 'exact' || result.status === 'score-zero-certified') {
      const relative = config.scaleMode === 'question-relative' || config.scale === undefined;
      const expected = relative ? (result.maxPoints > 0 ? result.maxPoints / (config.scaleBudget || 5) : 1) : config.scale;
      return result.rubric === (config.rubric || 'paper-linear-v2') && result.scale === expected;
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
      for (const key of ['type', 'name', 'description', 'path', 'beforeSql', 'afterSql', 'beforeToken', 'afterToken']) {
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

  showsAssessmentDetails()
  {
    return ['author', 'solution'].includes(this.config.context);
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
      this.card.setAttribute('aria-label', this.label(this.showsAssessmentDetails() ? 'title' : 'participantTitle'));
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
    if (this.showsAssessmentDetails()) card.append(title, note);
    else {
      // The answering page must not disclose the grade, even through live regions.
      const key = busy ? 'participantRunning' : text === this.label('completed') ? 'participantCompleted'
        : text === this.label('cancelled') ? 'participantCancelled'
        : [this.label('failed'), this.label('unsupported')].includes(text) ? 'participantFailed' : 'participantPending';
      status.textContent = this.label(key);
    }
    card.appendChild(status);
    card.setAttribute('aria-busy', busy ? 'true' : 'false');
    if (busy) {
      const progress = document.createElement('progress');
      progress.setAttribute('aria-label', this.label(this.showsAssessmentDetails() ? 'waiting' : 'participantRunning'));
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
    const card = this.mount();
    if (!card) return;
    if (!this.showsAssessmentDetails()) {
      // Replacing an indeterminate progress element restarts its native animation.
      if (card.getAttribute('aria-busy') !== 'true') this.message('', true);
      return;
    }
    const phase = this.labels[data.phase] ? data.phase : 'comparing';
    const parts = [this.label(phase)];
    if (Number.isFinite(data.visited)) parts.push(this.label('visited') + ': ' + data.visited.toLocaleString());
    if (Number.isFinite(data.lowerBound)) parts.push(this.label('lowerBound') + ': ' + data.lowerBound);
    const text = parts.join(' · ');
    if (card.getAttribute('aria-busy') !== 'true') this.message(text, true);
    else {
      const status = card.querySelector('.qpisql-qss-status');
      if (status.textContent !== text) status.textContent = text;
    }
    const progress = card.querySelector('progress');
    if (progress && Number.isFinite(data.completed) && Number.isFinite(data.total) && data.total > 0) {
      progress.max = data.total;
      progress.value = data.completed;
    } else if (progress) progress.removeAttribute('value');
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
        const revision = this.config.workerRevision === undefined ? '' : '?v=' + encodeURIComponent(this.config.workerRevision);
        this.worker = new Worker(window.QPISQL_URL_PATH + '/lib/qss/worker.qss.js' + revision);
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
          costs: this.config.costs || {},
          scale: this.config.scaleMode === 'question-relative' || this.config.scale === undefined
            ? (snapshot.maxPoints > 0 ? snapshot.maxPoints / (this.config.scaleBudget || 5) : 1) : this.config.scale,
          questionText: this.config.questionText || '', reference: snapshot.reference,
          answer: snapshot.answer, schema: snapshot.schema, schemaSql: snapshot.schemaSql, controlSql: snapshot.controlSql, maxPoints: snapshot.maxPoints,
          referenceRows: this.config.context === 'author' ? snapshot.answerRows : this.config.referenceRows,
          answerRows: snapshot.answerRows,
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
    if (success && this.config.context === 'solution' && this.card) this.card.replaceChildren();
    else this.message(this.label(success ? 'completed' : result.status === 'unsupported' ? 'unsupported'
      : result.status === 'cancelled' ? 'cancelled' : 'failed'), false);
    if (!this.card || !this.showsAssessmentDetails()) return;
    if (success) {
      const summary = document.createElement('p');
      summary.className = 'qpisql-qss-score';
      const distance = Number.isFinite(result.distance) ? Number(result.distance).toLocaleString()
        : Number.isFinite(result.lowerBound) ? '≥ ' + Number(result.lowerBound).toLocaleString() : '—';
      summary.textContent = this.label('points') + ': ' + Number(result.points).toLocaleString() + ' / '
        + Number(result.maxPoints).toLocaleString() + ' · ' + this.label('distance') + ': ' + distance;
      this.card.appendChild(summary);
      this.renderCorrections(result);
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
    this.card.appendChild(details);
  }

  renderCorrections(result)
  {
    const paragraph = text => {
      const p = document.createElement('p');
      p.textContent = text;
      this.card.appendChild(p);
    };
    if (result.status === 'score-zero-certified') {
      paragraph(this.label('zeroThreshold'));
      return;
    }
    const edits = (result.edits || []).slice(0, 50);
    if (!edits.length) {
      paragraph(this.label(result.distance === 0 ? 'noChanges' : 'traceMissing'));
      return;
    }
    const heading = document.createElement('strong');
    heading.textContent = this.label('correctionPath');
    this.card.appendChild(heading);
    const list = document.createElement('ol');
    list.className = 'qpisql-qss-changes';
    // Consecutive edits to the same clause can build an incomplete expression
    // in the middle. Show the net change and sum their actual edge costs.
    const steps = [];
    for (const edit of edits) {
      const previous = steps.at(-1);
      const path = String(edit?.path || '').split(',');
      const clause = path.findLastIndex(field => ['where', 'orderby', 'having', 'columns', 'groupby', 'on', 'set', 'returning'].includes(field));
      const scope = clause >= 0 ? path.slice(0, clause + 1).join(',') : '';
      if (scope && previous?.scope === scope && edit.beforeSql && edit.beforeSql === previous.afterSql
          && typeof edit.afterSql === 'string' && previous.beforeSql !== edit.afterSql
          && edit.cost > 0 && previous.cost > 0) {
        previous.afterSql = edit.afterSql;
        previous.cost += edit.cost;
      } else steps.push(typeof edit === 'object' && edit ? {...edit, scope} : {description: String(edit)});
    }
    for (const step of steps) {
      const item = document.createElement('li');
      const code = text => {
        const element = document.createElement('code');
        element.textContent = text;
        item.appendChild(element);
      };
      if (typeof step.beforeSql === 'string' && typeof step.afterSql === 'string') {
        const clause = (step.afterSql || step.beforeSql).match(/^(ORDER BY|GROUP BY|SELECT|WHERE|HAVING|SET|ON|RETURNING) /)?.[1];
        const title = document.createElement('strong');
        const actions = {SELECT: 'projection', WHERE: 'filter', 'ORDER BY': 'sort', 'GROUP BY': 'group', HAVING: 'groupFilter'};
        title.textContent = this.labels[actions[clause]] || clause || this.label('edits');
        item.append(title, ' · ' + this.label(step.beforeSql ? step.afterSql ? 'editReplace' : 'editDelete' : 'editInsert') + ' ');
        if (step.beforeSql) code(step.beforeSql);
        if (step.beforeSql && step.afterSql) item.append(' → ');
        if (step.afterSql) code(step.afterSql);
      } else {
        const field = step.scope?.split(',').at(-1);
        const clause = {columns: 'SELECT', where: 'WHERE', orderby: 'ORDER BY', groupby: 'GROUP BY', having: 'HAVING',
          on: 'ON', set: 'SET', returning: 'RETURNING'}[field];
        const verb = /^(add|set[A-Z])/.test(step.name) ? 'editInsert'
          : /^(remove|unset)/.test(step.name) ? 'editDelete' : /^change/.test(step.name) ? 'editReplace' : null;
        const name = this.labels.stepNames?.[step.name] || (clause && verb ? clause + ' · ' + this.label(verb)
          : step.description || step.name || this.label('edits'));
        item.append(String(name));
        if (typeof step.beforeToken === 'string' && typeof step.afterToken === 'string') {
          item.append(' ');
          if (step.beforeToken) code(step.beforeToken);
          if (step.beforeToken && step.afterToken) item.append(' → ');
          if (step.afterToken) code(step.afterToken);
        }
      }
      if (Number.isFinite(step.cost)) item.append(' · ' + this.label('cost') + ': ' + step.cost.toLocaleString());
      list.appendChild(item);
    }
    this.card.appendChild(list);
    if (Number.isFinite(result.scale) && result.distance > 0) {
      paragraph(this.label('scaleExplanation').replace('%s', result.scale.toLocaleString(undefined, {maximumSignificantDigits: 8})));
    }
    if (result.editsTruncated) paragraph(this.label('traceShortened'));
  }

  static renderStored(container)
  {
    for (const card of container.querySelectorAll(':scope > .qpisql-qss-shadow')) card.remove();
    const required = container.dataset.qssRequired === 'true';
    if (!required && !container.dataset.qssEvaluation) return;
    try {
      // Only the server-rendered solution output calls this after ILIAS grants access.
      // Completed answers keep the server-saved model and scale that produced
      // their official grade, even after the current question/model changes.
      const model = JSON.parse(container.dataset.qssModel || '{}');
      const qss = new QSSShadow({ ...model, context: 'solution', labels: JSON.parse(container.dataset.qssLabels || '{}') });
      qss.card = document.createElement('section');
      qss.card.className = 'qpisql-qss-shadow';
      container.appendChild(qss.card);
      qss.mount = () => qss.card;
      let result = null;
      try { result = JSON.parse(container.dataset.qssEvaluation || 'null'); } catch (error) { /* Missing evidence remains ungraded. */ }
      if (required) {
        // ILIAS stores a numeric zero when no assessment finished. That value
        // is not a QSS zero certificate; only bound, terminal evidence may
        // display an assessed score in the released solution view.
        const completed = result && QSSShadow.isCurrentModel(result, model)
          && result.modelVersion === model.engineVersion
          && result.referenceRevision === container.dataset.qssReferenceRevision
          && result.answerDigest === model.answerDigest
          && result.maxPoints === model.maxPoints
          && result.scoreCertifiedWithinModel === true
          && result.formula === 'max(maxPoints - distance * scale, 0)'
          && (result.status === 'score-zero-certified' || (result.status === 'exact'
            && result.exactWithinModel === true && Number.isSafeInteger(result.distance) && result.distance >= 0));
        if (!completed) {
          qss.message(qss.label('notCompleted'), false);
          return;
        }
      }
      if (!QSSShadow.isCurrentModel(result, model) || (container.dataset.qssReferenceRevision
        && result.referenceRevision !== container.dataset.qssReferenceRevision)) {
        qss.message(qss.label('stale'), false);
      } else {
        qss.render(result);
        if (container.dataset.qssSubmission && qss.card.querySelector('.qpisql-qss-score')) {
          const heading = document.createElement('strong');
          heading.textContent = qss.label('submission');
          const code = document.createElement('code');
          code.textContent = JSON.parse(container.dataset.qssSubmission).sql;
          const pre = document.createElement('pre');
          pre.appendChild(code);
          qss.card.querySelector('.qpisql-qss-score').before(heading, pre);
        }
      }
    } catch (error) { /* Older answers and malformed sidecars retain their ordinary result. */ }
  }
}
