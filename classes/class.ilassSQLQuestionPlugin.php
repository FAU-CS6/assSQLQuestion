<?php

declare(strict_types=1);

/**
 * Main plugin file of the SQLQuestion plugin
 *
 * @author Dominik Probst <dominik.probst@fau.de>
 * @version $Id$
 * @ingroup ModulesTestQuestionPool
 */
class ilassSQLQuestionPlugin extends ilQuestionsPlugin
{
    final public function getPluginName(): string
    {
        return "assSQLQuestion";
    }

    final public function getQuestionType(): string
    {
        return "assSQLQuestion";
    }

    final public function getQuestionTypeTranslation(): string
    {
        return $this->txt('gi_name');
    }

    public function loadLanguageModule(): void
    {
        parent::loadLanguageModule();
        global $DIC;
        // ILIAS 11's attempt results ask for the raw type tag.
        // Register a request-local alias without changing core language files.
        $DIC->language()->text[$this->getQuestionType()] = $this->getQuestionTypeTranslation();
    }
}
