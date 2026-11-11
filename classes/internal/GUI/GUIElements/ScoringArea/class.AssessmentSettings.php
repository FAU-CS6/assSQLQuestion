<?php

declare(strict_types=1);

/** Explicit assessment choice; legacy questions start with result scoring. */
class AssessmentSettings extends GUIElement
{
    public function getEditOutput()
    {
        global $DIC;
        $escape = static fn($s): string => htmlspecialchars(is_scalar($s) ? (string) $s : '', ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8');
        $mode = isset($_POST['assessment_mode']) && is_string($_POST['assessment_mode']) ? $_POST['assessment_mode'] : $this->object->getAssessmentMode();
        $maximum = $_POST['qss_maximum_points'] ?? $this->object->getQssMaximumPoints();
        $html = '<label for="qpisql-assessment-mode">' . $this->plugin->txt('assessment_mode') . '</label>'
            . '<select id="qpisql-assessment-mode" name="assessment_mode" class="form-control">';
        foreach (['result', 'qss'] as $value) {
            $html .= '<option value="' . $value . '"' . ($value === $mode ? ' selected' : '') . '>' . $this->plugin->txt('assessment_' . $value) . '</option>';
        }
        $html .= '</select><div id="qpisql-qss-settings"' . ($mode === 'qss' ? '' : ' hidden') . '>'
            . '<p class="help-block">' . $this->plugin->txt('assessment_qss_info') . '</p>'
            . '<label for="qpisql-qss-maximum">' . $this->plugin->txt('assessment_maximum') . '</label>'
            . '<input class="form-control" type="number" min="0.0001" max="1000000" step="0.0001" id="qpisql-qss-maximum" name="qss_maximum_points" value="' . $escape($maximum) . '">';
        $costs = $this->object->getQssCosts();
        $language = $DIC->language()->getLangKey() === 'de' ? 'de' : 'en';
        foreach (['equivalence', 'repair', 'basic'] as $group) {
            $html .= '<details><summary>' . $this->plugin->txt('assessment_group_' . $group) . '</summary><table class="table"><thead><tr><th>'
                . $this->plugin->txt('assessment_step') . '</th><th>' . $this->plugin->txt('assessment_cost') . '</th></tr></thead><tbody>';
            foreach (QssAssessment::catalog()['steps'] as $step) {
                if ($step['group'] !== $group) { continue; }
                $name = 'qss_cost_' . $step['id'];
                $value = $_POST[$name] ?? $costs[$step['id']];
                $html .= '<tr><td><label for="' . $name . '">' . $escape($step[$language] ?? $step['en']) . '</label></td><td>'
                    . '<input class="form-control" type="number" min="0" max="1000000" step="1" name="' . $name . '" id="' . $name
                    . '" data-qss-cost="' . $step['id'] . '" data-default-cost="' . $step['defaultCost'] . '" value="' . $escape($value) . '"></td></tr>';
            }
            $html .= '</tbody></table></details>';
        }
        return $html . '<button type="button" id="qpisql-costs-reset" class="btn btn-default">' . $this->plugin->txt('assessment_reset')
            . '</button></div><script>AssessmentSettings.mount();</script>';
    }

    public function getQuestionOutput($participant_input) { return ''; }
    public function getSolutionOutput($participant_input) { return ''; }

    public static function postedCosts(): array
    {
        $costs = [];
        foreach (QssAssessment::catalog()['steps'] as $step) {
            $value = $_POST['qss_cost_' . $step['id']] ?? null;
            if (!is_string($value) || !preg_match('/^(0|[1-9][0-9]{0,6})$/D', $value)) {
                throw new InvalidArgumentException('Invalid QSS step cost.');
            }
            $costs[$step['id']] = (int) $value;
        }
        return QssAssessment::costs($costs);
    }

    public function writePostData()
    {
        $this->object->setAssessmentMode((string) ($_POST['assessment_mode'] ?? QssAssessment::RESULT));
        if ($this->object->getAssessmentMode() === QssAssessment::QSS) {
            $this->object->setQssMaximumPoints((float) $_POST['qss_maximum_points']);
            $this->object->setQssCosts(self::postedCosts());
        }
    }

    public function writeParticipantInput($participant_input) { }
}
