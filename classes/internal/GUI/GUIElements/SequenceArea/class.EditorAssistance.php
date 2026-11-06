<?php

declare(strict_types=1);

/** Opt-in student hints and anonymous author examples. */
class EditorAssistance extends GUIElement
{
    public function getEditOutput(): string
    {
        $enabled = isset($_POST['editor_assistance_present'])
            ? isset($_POST['editor_assistance'])
            : $this->object->getEditorAssistance();
        $tpl = $this->template($enabled, true);
        $tpl->setCurrentBlock('author_options');
        foreach (['hints', 'hints_info', 'example', 'example_select', 'example_update', 'example_delete', 'example_insert', 'example_apply', 'example_empty'] as $key) {
            $tpl->setVariable(strtoupper($key), $this->plugin->txt('help_' . $key));
        }
        $tpl->setVariable('CHECKED', $enabled ? 'checked' : '');
        $tpl->parseCurrentBlock();
        return $tpl->get();
    }

    public function getQuestionOutput($participant_input): string
    {
        return $this->object->getEditorAssistance() ? $this->template(true, false)->get() : '';
    }

    public function getSolutionOutput($participant_input): string
    {
        return '';
    }

    private function template(bool $enabled, bool $author): ilTemplate
    {
        $tpl = $this->plugin->getTemplate('SequenceArea/tpl.il_as_qpl_qpisql_sea_help.html');
        $tpl->setVariable('PLUGIN_PATH', $this->plugin->getRelativeDirectory());
        $tpl->setVariable('ENABLED', $enabled ? 'true' : 'false');
        $tpl->setVariable('AUTHOR', $author ? 'true' : 'false');
        foreach (['schema', 'schema_load', 'schema_cancel', 'schema_loading', 'schema_empty', 'schema_cancelled', 'schema_changed'] as $key) {
            $tpl->setVariable(strtoupper($key), htmlspecialchars($this->plugin->txt('help_' . $key), ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8'));
        }
        return $tpl;
    }

    public function writePostData(): void
    {
        $this->object->setEditorAssistance(isset($_POST['editor_assistance']));
    }

    public function writeParticipantInput($participant_input): void
    {
    }
}
