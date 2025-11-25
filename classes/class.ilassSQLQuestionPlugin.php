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
}
