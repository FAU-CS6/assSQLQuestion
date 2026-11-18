/** Live author settings. SQL/QSS remain browser-only; one scorer per question. */
class AssessmentSettings
{
  static mount()
  {
    const select = document.getElementById('qpisql-assessment-mode');
    if (!select) return;
    // Scoring fields occur later in the form than this script.
    const ready = () => {
      const handler = window.EXECUTE_HANDLER;
      const qssPanel = document.getElementById('qpisql-qss-settings');
      const inputs = [...qssPanel.querySelectorAll('input')];
      const apply = invalidate => {
        if (invalidate) handler.onChange();
        const element = document.getElementById('qpisql-qss-config');
        const config = JSON.parse(element.dataset.config);
        config.assessmentMode = select.value;
        config.enabled = select.value === 'qss';
        config.maxPoints = Number(document.getElementById('qpisql-qss-maximum').value);
        config.costs = Object.fromEntries(inputs.filter(input => input.dataset.qssCost).map(input => [input.dataset.qssCost, Number(input.value)]));
        element.dataset.config = JSON.stringify(config);
        if (handler.qss) { handler.qss.abortSilently(); handler.qss.card?.remove(); handler.qss = null; }
        handler.assessmentMode = select.value;
        handler.initializeQSS();
        qssPanel.hidden = select.value !== 'qss';
        for (const input of inputs) input.disabled = qssPanel.hidden;
        document.getElementById('qpisql-result-settings').hidden = select.value === 'qss';
      };
      select.addEventListener('change', () => apply(true));
      for (const input of inputs) input.addEventListener('change', () => apply(true));
      document.getElementById('qpisql-costs-reset').addEventListener('click', () => {
        for (const input of inputs) if (input.dataset.qssCost) input.value = input.dataset.defaultCost;
        apply(true);
      });
      apply(false);
    };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', ready, {once:true});
    else queueMicrotask(ready);
  }
}
