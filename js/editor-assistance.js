(function () {
  if (window.QPISQL_ATTACH_HELP) return;

  // Newly authored examples reflect the SELECT/aggregation and mutation + C
  // patterns in StudOn pools. They contain no exported exam text or datasets.
  const scores = "CREATE TABLE scores (id INTEGER PRIMARY KEY, name TEXT, points INTEGER);\nINSERT INTO scores VALUES (1, 'Ada', 9), (2, 'Grace', 5);";
  const examples = {
    select: {
      a: "CREATE TABLE people (id INTEGER PRIMARY KEY, name TEXT);\nCREATE TABLE orders (id INTEGER PRIMARY KEY, person_id INTEGER, amount INTEGER);\nINSERT INTO people VALUES (1, 'Ada'), (2, 'Grace');\nINSERT INTO orders VALUES (1, 1, 10), (2, 1, 20), (3, 2, 15);",
      b: 'SELECT p.name, SUM(o.amount) AS total\nFROM people p JOIN orders o ON o.person_id = p.id\nGROUP BY p.id, p.name ORDER BY p.name;', c: '', integrity: true
    },
    update: {a: scores, b: 'UPDATE scores SET points = points + 1 WHERE id = 1;', c: 'SELECT name, points FROM scores ORDER BY id;', integrity: false},
    delete: {a: scores, b: 'DELETE FROM scores WHERE points < 6;', c: 'SELECT name, points FROM scores ORDER BY id;', integrity: false},
    insert: {a: scores, b: "INSERT INTO scores VALUES (3, 'Sam', 7);", c: 'SELECT name, points FROM scores ORDER BY id;', integrity: false}
  };

  window.QPISQL_ATTACH_HELP = function (root) {
    if (!root || root.dataset.attached) return;
    root.dataset.attached = 'true';
    const handler = window.EXECUTE_HANDLER;
    const inputs = () => handler.inputs.filter(input => input.editor);
    const source = () => handler.getSequenceA();
    const optIn = root.querySelector('#qpisql-editor-assistance');
    const enabled = () => optIn ? optIn.checked : root.dataset.enabled === 'true';
    let schema = Object.create(null);
    let worker = null;
    let schemaSource = null;
    const status = root.querySelector('#qpisql-schema-status');
    const tables = root.querySelector('#qpisql-schema-tables');
    const load = root.querySelector('#qpisql-schema-load');
    const cancel = root.querySelector('#qpisql-schema-cancel');

    function setCompletion() {
      for (const input of inputs()) input.editor.setAssistance(enabled(), schema);
    }
    function stop() {
      if (worker) worker.terminate();
      worker = null;
      load.disabled = false;
      cancel.hidden = true;
    }
    function fail(message) {
      stop();
      status.textContent = message;
    }
    optIn?.addEventListener('change', setCompletion);
    setCompletion();

    cancel.addEventListener('click', () => fail(root.dataset.cancelled));
    window.addEventListener('pagehide', stop);
    load.addEventListener('click', () => {
      stop();
      tables.replaceChildren();
      schema = Object.create(null);
      setCompletion();
      schemaSource = source();
      status.textContent = root.dataset.loading;
      load.disabled = true;
      cancel.hidden = false;
      let current;
      try {
        current = new Worker(window.QPISQL_URL_PATH + '/lib/sql.js/worker.sql.js');
      } catch (error) {
        fail(error.message);
        return;
      }
      worker = current;
      current.onerror = event => {
        event.preventDefault();
        if (worker === current) fail(event.message);
      };
      const readTables = () => {
        current.onmessage = event => {
          if (worker !== current) return;
          if (event.data.error) return fail(String(event.data.error));
          const rows = event.data.results?.[0]?.values || [];
          const pending = rows.map(row => String(row[0]));
          function next() {
            if (worker !== current) return;
            if (!pending.length) {
              stop();
              if (source() !== schemaSource) {
                schema = Object.create(null);
                tables.replaceChildren();
                return fail(root.dataset.changed);
              }
              setCompletion();
              status.textContent = rows.length ? '' : root.dataset.empty;
              return;
            }
            const name = pending.shift();
            current.onmessage = result => {
              if (worker !== current) return;
              if (result.data.error) return fail(String(result.data.error));
              const columns = (result.data.results?.[0]?.values || []).map(row => String(row[1]));
              schema[name] = columns;
              const item = document.createElement('li');
              item.textContent = name + ' (' + columns.join(', ') + ')';
              tables.append(item);
              next();
            };
            current.postMessage({action: 'exec', sql: 'PRAGMA table_info("' + name.replaceAll('"', '""') + '");'});
          }
          next();
        };
        current.postMessage({action: 'exec', sql: "SELECT name FROM sqlite_master WHERE type IN ('table', 'view') AND name NOT LIKE 'sqlite_%' ORDER BY name;"});
      };
      current.onmessage = event => {
        if (worker !== current) return;
        if (event.data.error) return fail(String(event.data.error));
        readTables();
      };
      current.postMessage({action: 'exec', sql: schemaSource});
    });

    document.getElementById('sequence_a')?.addEventListener('change', () => {
      if (schemaSource !== null && source() !== schemaSource) {
        stop();
        schema = Object.create(null);
        tables.replaceChildren();
        setCompletion();
        status.textContent = root.dataset.changed;
      }
    });

    const select = root.querySelector('#qpisql-example');
    if (!select) return;
    const apply = root.querySelector('#qpisql-example-apply');
    const preview = root.querySelector('#qpisql-example-preview');
    function updateExample() {
      const example = examples[select.value];
      preview.textContent = 'A:\n' + example.a + '\n\nB:\n' + example.b + '\n\nC:\n' + example.c;
      apply.disabled = ['A', 'B', 'C'].some(letter => handler['getSequence' + letter]().trim() !== '');
    }
    select.addEventListener('change', updateExample);
    for (const name of ['sequence_a', 'sequence_b', 'sequence_c']) document.getElementById(name)?.addEventListener('change', updateExample);
    apply.addEventListener('click', () => {
      // Verify again at click time; never replace an author's existing SQL.
      if (['A', 'B', 'C'].some(letter => handler['getSequence' + letter]().trim() !== '')) return;
      const example = examples[select.value];
      for (const input of inputs()) input.editor.setValue(example[input.getName().slice(-1)]);
      const integrity = document.getElementById('qpisql-integrity-check');
      if (integrity) {
        integrity.checked = example.integrity;
        integrity.dispatchEvent(new Event('change', {bubbles: true}));
      }
      updateExample();
    });
    updateExample();
  };
})();
