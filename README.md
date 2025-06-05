# Question Plugin for ILIAS - SQL

The Open Source Learning Management System [ILIAS](https://www.ilias.de/) is a an extensive tool to support students at universities learning. One big feature of ILIAS is the testing module. Using this lecturers are enabled to give their students a test they have to solve before accessing important documents. Of course the testing module can be used to create real (online) exams, too.

While the testing module supports a bunch of different question types by default, including [Single Choice](https://docu.ilias.de/ilias.php?ref_id=2221&obj_id=42830&obj_type=StructureObject&cmd=layout&cmdClass=illmpresentationgui&cmdNode=2c&baseClass=ilLMPresentationGUI), [Multiple Choice](https://docu.ilias.de/ilias.php?ref_id=2221&obj_id=41931&cmd=layout&cmdClass=illmpresentationgui&cmdNode=2c&baseClass=ilLMPresentationGUI) and [Ordering](https://docu.ilias.de/ilias.php?ref_id=2221&obj_id=41720&cmd=layout&cmdClass=illmpresentationgui&cmdNode=2c&baseClass=ilLMPresentationGUI) questions, more complex question types have to be added by installing a plugin.

In this project - called ***Q**uestion **P**lugin for **I**LIAS - **SQL** (**QPI-SQL**)* - we developed an ILIAS plugin, named *assSQLQuestion*. The plugin enables lecturers to add interactive SQL questions to their tests. Students can execute their answers and their work is graded automatically by applying different metrics.

## Installation

There are two different options to install this plugin. One for demonstration and testing purposes and one to install the plugin to an existing ILIAS instance for production use.

### Installation as part of an existing ILIAS instance

1. Copy the content of this repository into the `Customizing/global/plugins/Modules/TestQuestionPool/Questions/assSQLQuestion` subfolder of your ILIAS installation. It might be necessary to create the subfolders if they do not exist.

1. Access Adminstration -> Extending ILIAS -> Plugins

1. Press "Install" for the assSQLQuestion plugin

1. Press "Activate" for the assSQLQuestion plugin

### Installation for testing purposes

1. Install Docker-compose on your device

1. Start the test installation of ILIAS by executing `docker-compose up` in the root folder of this repository and write down the login data for ILIAS, which will be displayed in the console at the end of the installation process.

1. Prepare the plugin subfolder by executing `docker exec [NAME_OF_THE_ILIAS_CONTAINER] mkdir -p /var/www/html/Customizing/global/plugins/Modules/TestQuestionPool/Questions/`

1. Copy the content of this repository into the container by executing `docker cp . [NAME_OF_THE_ILIAS_CONTAINER]:/var/www/html/Customizing/global/plugins/Modules/TestQuestionPool/Questions/assSQLQuestion` in the root folder of this repository

1. Access the ILIAS installation at `localhost:8080`

1. Access Adminstration -> Extending ILIAS -> Plugins

1. Press "Install" for the assSQLQuestion plugin

1. Press "Activate" for the assSQLQuestion plugin

## Development

Some of the artifacts are uploaded to the repository in built form, some need to be built during installation. For the PHP part of the plugin, we adhere to the suggestions of ILIAS, namely to `composer install --no-dev` all dependencies during installation and not check in dependency artifacts into git (c.f. https://github.com/ILIAS-eLearning/ILIAS/pull/1833 and specifically https://docu.ilias.de/go/wiki/wpage_6371_1357 for plugins).

At the same time, there is the file `js/min.js.php`, which depends on `MatthiasMullie\Minify`. `min.js.php` is called directly from the browser but not via `ilias.php`. For this reason, we maintain a second, parallel composer in `lib/minify/vendor/`, which we do check in! It is up to the developer to update these dependencies and in order to do so, they need to operate in this composer instance (e.g. by calling `composer update matthiasmullie/path-converter`).

### Building the JavaScript bundle

From version 6 on, _Codemirror_ "exposes only modules, which will require some kind of build step before you can use them." (https://codemirror.net/docs/migration/) Therefore, we use _rollupjs_ and some glue code (c.f. `lib/codemirror/editor.mjs`) to make codemirror available from the global environment (i.e. `<script src="compiled.bundle.js"></script><script>here</script>`). This approach is taken from the official manual here: https://codemirror.net/examples/bundle/ The link gives an explanation about the later rollup invocation, too.

To install codemirror, rollup and its plugins, use `npm install` in the `lib/codemirror` directory, which installs the packages as in `package-lock.json`.

Use the following command to build the bundle:

```sh
node_modules/.bin/rollup editor.mjs \
  -f iife \
  -o codemirror_sqlquestion.bundle.js \
  -p @rollup/plugin-node-resolve \
  -p @rollup/plugin-terser \
  --name codemirror_sqlquestion
```

We do check in the resulting `codemirror_sqlquestion.bundle.js` file, as we cannot expect all administrators to set up their own JavaScript build environment to gather the file themselves.

## Documentation
Additionally to the in source documentation there is a documentation educating about the interaction of components and further informations. Due to the origin of this project this part of the documentation is only available in German. It can be viewed by compiling the `dokumentation.tex` in the `docs/` folder with *pdflatex* or a comparable Latex compiler.

  ```
    cd docs/
    pdflatex dokumentation.tex
  ```

## Additional Information

***QPI-SQL*** is a project started by Dominik Probst (https://cs6.tf.fau.eu/dp) as part of his master's degree in 2018. The accompanying chair is the [*Chair of Computer Science 6*](https://www.cs6.tf.fau.eu) at [*Friedrich-Alexander University Erlangen-Nuremberg*](https://www.fau.eu/).
