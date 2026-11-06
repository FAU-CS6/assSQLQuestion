/** Execution state, persisted answer fields and safely rendered SQL output. */
class OutputAreaOutput extends ExecutionOutput
{
  constructor()
  {
    super();
    const area = document.getElementById('qpisql-output-area');
    this.area = area;
    this.labels = JSON.parse(area.dataset.labels);
    this.restoring = false;
    this.autosaveJQuery = null;
    // Inline question templates can run before ILIAS loads jQuery at the end of the document.
    const bindWhenReady = () => this.bindAutosave();
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bindWhenReady, { once: true });
    if (document.readyState !== 'complete') window.addEventListener('load', bindWhenReady, { once: true });
    this.bindAutosave();
  }

  status(key)
  {
    document.getElementById('qpisql-execution-status').textContent = this.labels[key];
  }

  changed()
  {
    if (this.restoring) return;
    const saveStatus = document.getElementById('qpisql-save-status');
    saveStatus.textContent = this.labels.unsaved;
    document.getElementById('qpisql-executed-bool').dispatchEvent(new Event('change', { bubbles: true }));
  }

  bindAutosave()
  {
    if (document.getElementById('qpisql-output-area') !== this.area || !window.jQuery) return;
    if (this.autosaveJQuery === window.jQuery) return;
    if (this.autosaveJQuery) this.autosaveJQuery(document).off('.qpisqlAutosave');
    this.autosaveJQuery = window.jQuery;
    // Use the actual ILIAS autosave response, never infer persistence from a local edit.
    const jq = window.jQuery;
    const isCurrentAnswer = (settings) => {
      if (document.getElementById('qpisql-output-area') !== this.area) return false;
      if (!/[?&]test_answer_changed=/.test(settings.url || '')) return false;
      const sent = new URLSearchParams(settings.data || '');
      const names = ['sequence_b', 'executed_bool', 'error_bool', 'error', 'output_relation'];
      return names.every(name => {
        const input = document.querySelector('[name="' + name + '"]');
        // HTML form serialization canonicalizes textarea line endings to CRLF.
        const normalizeNewlines = value => String(value).replace(/\r\n|\r/g, '\n');
        return input && sent.has(name) && normalizeNewlines(sent.get(name)) === normalizeNewlines(input.value);
      });
    };
    jq(document).off('.qpisqlAutosave');
    jq(document).on('ajaxSuccess.qpisqlAutosave', (event, xhr, settings) => {
      if (!isCurrentAnswer(settings) || !xhr.responseText || xhr.responseText === '-IGNORE-') return;
      const confirmed = String(xhr.responseText).trim() === this.labels.autosaveSuccess;
      document.getElementById('qpisql-save-status').textContent = confirmed
        ? this.labels.saved + ' · ' + new Date().toLocaleTimeString() : this.labels.saveFailed;
    });
    jq(document).on('ajaxError.qpisqlAutosave', (event, xhr, settings) => {
      if (isCurrentAnswer(settings)) document.getElementById('qpisql-save-status').textContent = this.labels.saveFailed;
    });
  }

  setFields(error, result)
  {
    document.getElementById('qpisql-error-bool').value = error ? 'true' : 'false';
    document.getElementById('qpisql-error').value = error ? error.toJSON() : '';
    document.getElementById('qpisql-executed-bool').value = result ? 'true' : 'false';
    document.getElementById('qpisql-output-relation').value = result ? result.toJSON() : '';
  }

  clear()
  {
    ['error', 'relation', 'execution-running'].forEach(name => {
      const element = document.getElementById('qpisql-output-area-' + name);
      if (name !== 'execution-running') element.textContent = '';
      element.style.display = 'none';
    });
  }

  onChange()
  {
    this.onError(new SQLRunErrorNoExecution());
  }

  onExecution()
  {
    this.setFields(null, null);
    this.clear();
    this.status('running');
    document.getElementById('qpisql-output-area-execution-running').style.display = 'block';
    this.changed();
  }

  onError(error)
  {
    this.setFields(error, null);
    this.clear();
    this.status(error.errorType === 'SQLRunErrorNoExecution' ? 'notExecuted' : error.errorType === 'SQLRunErrorCancelled' ? 'cancelled' : 'failed');
    const element = document.getElementById('qpisql-output-area-error');
    element.textContent = OutputAreaOutput.errorText(error, this.labels);
    element.style.display = 'block';
    this.changed();
  }

  onResult(result)
  {
    this.setFields(null, result);
    this.clear();
    this.status('success');
    const element = document.getElementById('qpisql-output-area-relation');
    result.renderInto(element, this.labels);
    element.style.display = 'block';
    this.changed();
  }

  static errorText(error, labels)
  {
    const detail = String(error.errorMessage || '');
    switch (error.errorType) {
      case 'SQLRunErrorNoExecution': return labels.notExecuted;
      case 'SQLRunErrorCancelled': return labels.cancelled;
      case 'SQLRunErrorDBCreation': return labels.dbCreation + ' ' + detail;
      case 'SQLRunErrorIntegrityCheck': return labels.integrity + ' ' + detail;
      case 'SQLRunErrorNoVisibleResult': return labels.noVisibleResult + ' ' + detail;
      case 'SQLRunErrorRunningSequence': return '(' + String(error.sequence || '') + ') ' + labels.sequenceError + ' ' + detail;
      default: return detail || labels.failed;
    }
  }

  restore(errorBool, error, executedBool, relation)
  {
    this.restoring = true;
    try {
      if (errorBool === 'true' && error) {
        const stored = JSON.parse(error);
        const restored = new SQLRunErrorAbstract(stored.errorMessage || '');
        restored.errorType = stored.errorType;
        restored.sequence = stored.sequence;
        // Preserve sequence when the restored answer is submitted again.
        restored.toJSON = () => JSON.stringify(stored);
        this.onError(restored);
      } else if (executedBool === 'true' && relation) {
        this.onResult(new SQLResult(JSON.parse(relation)));
      } else {
        this.onError(new SQLRunErrorNoExecution());
      }
    } catch (error) {
      this.onError(new SQLRunErrorNoExecution());
    }
    this.restoring = false;
  }

  static renderStored(container)
  {
    const labels = JSON.parse(container.dataset.labels);
    const errorArea = container.querySelector('.qpisql-output-area-error');
    const resultArea = container.querySelector('.qpisql-output-area-relation');
    try {
      if (container.dataset.errorBool === 'true' && container.dataset.error) {
        errorArea.textContent = OutputAreaOutput.errorText(JSON.parse(container.dataset.error), labels);
        errorArea.style.display = 'block';
      } else if (container.dataset.executedBool === 'true' && container.dataset.relation) {
        new SQLResult(JSON.parse(container.dataset.relation)).renderInto(resultArea, labels);
        resultArea.style.display = 'block';
      } else {
        errorArea.textContent = labels.notExecuted;
        errorArea.style.display = 'block';
      }
    } catch (error) {
      errorArea.textContent = labels.notExecuted;
      errorArea.style.display = 'block';
    }
  }
}
