# QPI-SQL · SQL questions for ILIAS

QPI-SQL (`assSQLQuestion`) adds an interactive SQL question type to ILIAS tests
and question pools. Instructors provide a SQLite database setup and a model
answer. Students write SQL in the editor, run it against the exercise data and
inspect the output. Instructors choose how each question is graded.

## Grading

- **Result-based grading** awards points for properties of the query output.
  Instructors set the points for row count, column names and functional dependencies.
  This is the default for new questions. Questions created before QSS was
  introduced keep their result-based settings on upgrade or import from QTI.
- **Graph-based QSS** awards partial credit based on the lowest total cost of
  editing the submitted SQL into the model answer. Instructors can adjust the
  cost of individual edits, including equivalence transformations that are free
  by default. Once ILIAS releases the results, students can see the edits and their
  costs. If a zero score was established before the full path was needed, they can
  request that explanation in the results view. The method follows sections 4.2–4.7
  of the [Graph-based QSS paper (BTW 2025)](https://doi.org/10.18420/BTW2025-13).

Only the selected grading method runs. SQLite execution and the QSS search run in
browser workers and can be cancelled. During a QSS assessment, students see a
progress indicator. ILIAS controls access to the score and feedback. The QSS
model answer is available to the browser, and ILIAS uses browser-generated
evidence to calculate the stored grade.

See the [grading guide](docs/v0.3.0/qss-bewertung.md) and [QSS cost settings](docs/v0.3.0/qss-kostenkonfiguration.md)
for configuration examples and details on copying, importing and exporting questions.

## Installation

Plugin **0.3.0** targets **ILIAS 11** with **PHP 8.3 or 8.4**. For ILIAS 8 or 9,
see the [v0.0.83 source and installation instructions](https://github.com/FAU-CS6/assSQLQuestion/tree/v0.0.83).

### Install or update in an existing ILIAS instance

1. Place the plugin in `public/Customizing/global/plugins/Modules/TestQuestionPool/Questions/assSQLQuestion`
   under the ILIAS root directory.
2. In the plugin directory, run `composer install --no-dev --prefer-dist`.
3. In the ILIAS root directory, run `composer dump-autoload`, then use the setup
   command for your installation.

   | Installation | Command |
   | --- | --- |
   | First install | `php cli/setup.php install --legacy-plugin assSQLQuestion` |
   | Update an installed plugin | `php cli/setup.php update --legacy-plugin assSQLQuestion` |

4. Check the plugin status under **Administration → Extending ILIAS → Plugins**.

The [ILIAS 11 upgrade guide](docs/v0.1.1/ilias-11.md) covers migration, including the
[question-pool fix for ILIAS 11.5](docs/v0.1.1/ilias-11.md#erforderliche-ilias-kernkorrektur)
and [StudOn taxonomy data](docs/v0.1.1/ilias-11.md#studon-zusatzdaten-in-taxonomien-vor-der-migration-prüfen).

### Try it locally with Docker Compose

From the repository root, start the test instance and read the login credentials
from the ILIAS service log after setup finishes.

```sh
docker compose -p ass_sql_ilias11 up -d
docker compose -p ass_sql_ilias11 logs ilias
```

Open <http://localhost:8080> and check the plugin status in the administration
area. If it is listed as uninstalled, run this command from the repository root.

```sh
docker compose -p ass_sql_ilias11 exec -u www-data ilias php cli/setup.php install --legacy-plugin assSQLQuestion
```

## Development

- Run the **PHP unit tests** with `composer install` and `composer test` from the plugin root. The
  [integration test instructions](docs/v0.1.1/ilias-11.md#reproduzierbare-tests) use the
  PHPUnit executable provided by ILIAS. The browser-facing PHP minifier has its
  own Composer dependencies, maintained in `lib/minify/` and shipped with the plugin.
- The plugin ships the **CodeMirror editor and QSS bundles**.
  Building them requires Node.js 24. For the editor, run the following commands
  in `lib/codemirror/`. For QSS, see the [build and browser test instructions](lib/qss/README.md#reproducible-build-and-verification).

  ```sh
  npm ci --ignore-scripts
  npm test
  npm run audit:security
  npm run build
  npm run build:check
  ```

  Commit the rebuilt bundle when changing editor sources. `build:check` verifies
  that the shipped bundle matches the sources and lockfile. The [audit script](lib/codemirror/scripts/audit.mjs)
  documents the exception for a withdrawn advisory.

## Documentation

The [documentation archive](docs/) is organized by plugin version.

- The [QSS model and edit catalogue](lib/qss/README.md) describes how the
  search works and which SQL transformations it supports.
- The [Chrome test report](docs/v0.1.1/chrome-abnahme-2026-11-06.md) records tests on a
  local ILIAS installation using 699 questions imported from StudOn. The
  [QSS assessment report](docs/v0.3.0/qss-bewertung.md#native-nachprüfung-von-modell-270-am-13-november-2026)
  records the grading and compatibility checks for specific model versions.
- The [original project documentation for v0.0.73](docs/v0.0.73/dokumentation.tex) is in German.
  To build the PDF with its bibliography, run `latexmk -pdf dokumentation.tex` from `docs/v0.0.73/` with Biber installed.

## Additional Information

***QPI-SQL*** is a project started by Dominik Probst (https://cs6.tf.fau.eu/dp) as part of his master's degree in 2018. The accompanying chair is the [*Chair of Computer Science 6*](https://www.cs6.tf.fau.eu) at [*Friedrich-Alexander University Erlangen-Nuremberg*](https://www.fau.eu/).

In his 2025 master's project, Marco Angerer adapted the plugin for ILIAS 9 and upgraded its SQL editor to CodeMirror 6. His [project report (PDF)](docs/v0.0.82/ausarbeitung.pdf) and [presentation (PDF)](docs/v0.0.82/praesentation.pdf) document the work on plugin version 0.0.82.

For ILIAS 11 and later, the primary contact for the plugin is Felix Hanika (<felix.hanika@fau.de>).
