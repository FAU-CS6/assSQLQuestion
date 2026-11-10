# Question Plugin for ILIAS - SQL

This experimental branch adds browser-only Graph-based QSS shadow assessment
following [Köberlein, Probst and Lenz, sections 4.2–4.7](https://www.cs6.tf.fau.eu/files/2025/03/Koeberlein-Graph-based_QSS-141_b.pdf).
Concrete SQLite AST states are connected by named SQL edits with fixed costs;
exact shortest-path search includes actual zero-cost semantic transformations.
The score uses the paper's linear deduction formula. This replaces the earlier
syntax-tree comparison. Regular ILIAS grades still use the established metrics.

The comparison runs directly at each question with progress, a result/navigation
barrier and manual cancellation. It has no execution timeout and starts no Node
service. Reference SQL is accessible in the student's browser; this branch remains
an experimental shadow/teaching pilot before any exam deployment. See
[the model, workflow and limitations](docs/qss-shadow.md) and the
[engine/edit catalogue](lib/qss/README.md).

The [student-answer matrix report](docs/qss-studentenvarianten-2026-11-10.md)
confirms model 2.1.0 on all 699 original questions with 6,812 native Chrome cases,
saved official grades and all five import/export/reimport round trips. It also
records gaps in variant coverage and calibration.
The [9 November Graph-based QSS report](docs/qss-graph-abnahme-2026-11-09.md)
records model 2.0.1 and does not establish acceptance of the current build. The
[earlier QSS report](docs/qss-abnahme-2026-11-09.md) records the
historical syntax experiment and is not acceptance of this replacement.

The Open Source Learning Management System [ILIAS](https://www.ilias.de/) is a an extensive tool to support students at universities learning. One big feature of ILIAS is the testing module. Using this lecturers are enabled to give their students a test they have to solve before accessing important documents. Of course the testing module can be used to create real (online) exams, too.

While the testing module supports a bunch of different question types by default, including [Single Choice](https://docu.ilias.de/ilias.php?ref_id=2221&obj_id=42830&obj_type=StructureObject&cmd=layout&cmdClass=illmpresentationgui&cmdNode=2c&baseClass=ilLMPresentationGUI), [Multiple Choice](https://docu.ilias.de/ilias.php?ref_id=2221&obj_id=41931&cmd=layout&cmdClass=illmpresentationgui&cmdNode=2c&baseClass=ilLMPresentationGUI) and [Ordering](https://docu.ilias.de/ilias.php?ref_id=2221&obj_id=41720&cmd=layout&cmdClass=illmpresentationgui&cmdNode=2c&baseClass=ilLMPresentationGUI) questions, more complex question types have to be added by installing a plugin.

In this project - called ***Q**uestion **P**lugin for **I**LIAS - **SQL** (**QPI-SQL**)* - we developed an ILIAS plugin, named *assSQLQuestion*. The plugin enables lecturers to add interactive SQL questions to their tests. Students can execute their answers and their work is graded automatically by applying different metrics.

## Installation

Version 0.2.2 targets **ILIAS 11 with PHP 8.3 or 8.4**. The migration notes and
reproducible tests are documented in [the ILIAS 11 upgrade guide](docs/ilias-11.md).

The [full Chrome acceptance report](docs/chrome-abnahme-2026-11-06.md) covers all
699 existing StudOn questions, native import/export round trips, and separate
lecturer/student accounts.

There are two different options to install this plugin. One for demonstration and testing purposes and one to install the plugin to an existing ILIAS instance for production use.

### Installation as part of an existing ILIAS instance

1. Copy the content of this repository into the `public/Customizing/global/plugins/Modules/TestQuestionPool/Questions/assSQLQuestion` subfolder of your ILIAS installation. Create the subfolders if needed. In ILIAS 11, `public/` is the web root; `Modules/TestQuestionPool/Questions` remains the legacy plugin slot path.

1. Run `composer install --no-dev` in the plugin directory.

1. Run `composer dump-autoload` in the **ILIAS root directory**, followed by `php cli/setup.php install --legacy-plugin assSQLQuestion`. For an existing plugin installation use `php cli/setup.php update --legacy-plugin assSQLQuestion` instead.

1. Check the plugin status under Administration -> Extending ILIAS -> Plugins. A new CLI installation activates the plugin automatically; updates preserve its activation status.

### Installation for testing purposes

1. Install Docker-compose on your device

1. Start the test installation of ILIAS 11 by executing `docker compose -p ass_sql_ilias11 up -d` in the root folder of this repository. Read the generated login credentials with `docker compose -p ass_sql_ilias11 logs ilias` after setup completes.

1. Access the ILIAS installation at `localhost:8080`

1. The test installation installs and activates the plugin automatically. See the [upgrade guide](docs/ilias-11.md) for unit, database and browser tests.

The ILIAS 11.5 base image needs the verified upstream question-type correction
before using its native question-pool list. See [test-image preparation](docs/ilias-11.md#erforderliche-ilias-kernkorrektur).
The plugin itself does not modify ILIAS core files.

## Development

Run `composer install` followed by `composer test` for the scoring unit tests.
Run the ILIAS integration suite with ILIAS's own PHPUnit executable to avoid
mixing two PHPUnit installations; instructions are in the [upgrade guide](docs/ilias-11.md).

Both QSS browser bundles are included. Node.js is needed only for development
and rebuilding them; the ILIAS installation runs no Node service. See the
[QSS build and test commands](lib/qss/README.md).

The current experimental parallel QSS model is `2.1.0` (`paper-linear-v2`).
It uses named SQL graph edits and a question-relative linear scale of
`maxPoints / 5`; the official ILIAS scoring metrics remain authoritative.
See the [parallel-assessment documentation](docs/qss-shadow.md) for its rules
and trust boundary.

Some of the artifacts are uploaded to the repository in built form, some need to be built during installation. For the PHP part of the plugin, we adhere to the suggestions of ILIAS, namely to `composer install --no-dev` all dependencies during installation and not check in dependency artifacts into git (c.f. https://github.com/ILIAS-eLearning/ILIAS/pull/1833 and specifically https://docu.ilias.de/go/wiki/wpage_6371_1357 for plugins).

At the same time, there is the file `js/min.js.php`, which depends on `MatthiasMullie\Minify`. `min.js.php` is called directly from the browser but not via `ilias.php`. For this reason, we maintain a second, parallel composer in `lib/minify/vendor/`, which we do check in! It is up to the developer to update these dependencies and in order to do so, they need to operate in this composer instance (e.g. by calling `composer update matthiasmullie/path-converter`).

### Building the JavaScript bundle

From version 6 on, _Codemirror_ "exposes only modules, which will require some kind of build step before you can use them." (https://codemirror.net/docs/migration/) Therefore, we use _rollupjs_ and some glue code (c.f. `lib/codemirror/editor.mjs`) to make codemirror available from the global environment (i.e. `<script src="compiled.bundle.js"></script><script>here</script>`). This approach is taken from the official manual here: https://codemirror.net/examples/bundle/ The link gives an explanation about the later rollup invocation, too.

Use **Node.js 24 LTS** (also specified in `lib/codemirror/.nvmrc`) and install the
locked editor and build dependencies with `npm ci --ignore-scripts`. From the
`lib/codemirror` directory, run:

```sh
npm ci --ignore-scripts
npm test
npm run audit:security
npm run build
npm run build:check
```

We do check in the resulting `codemirror_sqlquestion.bundle.js` file, as we cannot expect all administrators to set up their own JavaScript build environment to gather the file themselves.

`build:check` rebuilds into a temporary directory and verifies that the checked-in
bundle matches the sources and lockfile. CI runs the same checks and audits the
two Composer lockfiles and the browser test dependencies separately. Dependabot
monitors all four dependency directories.

`audit:security` fails on every active npm advisory. It only excludes
`GHSA-gcqx-w48m-w2h4` on `deepmerge` and findings that exclusively propagate that
advisory: its [CVE-2026-93753 was officially rejected on 2 November 2026](https://github.com/CVEProject/cvelistV5/blob/main/cves/2026/93xxx/CVE-2026-93753.json).
New advisories on `deepmerge` still fail. An unfiltered `npm audit` may continue to
report this withdrawn advisory until the npm advisory database catches up.

## Documentation
Additionally to the in source documentation there is a documentation educating about the interaction of components and further informations. Due to the origin of this project this part of the documentation is only available in German. It can be viewed by compiling the `dokumentation.tex` in the `docs/` folder with *pdflatex* or a comparable Latex compiler.

  ```
    cd docs/
    pdflatex dokumentation.tex
  ```

## Additional Information

***QPI-SQL*** is a project started by Dominik Probst (https://cs6.tf.fau.eu/dp) as part of his master's degree in 2018. The accompanying chair is the [*Chair of Computer Science 6*](https://www.cs6.tf.fau.eu) at [*Friedrich-Alexander University Erlangen-Nuremberg*](https://www.fau.eu/).
