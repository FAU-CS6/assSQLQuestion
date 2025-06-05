<?php

declare(strict_types=1);

/**
 * A internal helper class to define a solid structure for the participants solution
 * of a ScoringMetric
 *
 * @author Dominik Probst <dominik.probst@studium.fau.de>
 */
class ParticipantMetric
{
    /**
     * @var string The type of the ScoringMetric (e.g. "functional_dependency")
     */
    public $type = "";

    /**
     * @var string The participants value of the ScoringMetric
     */
    public $value = "";

    /**
     * Constructor
     *
     * The construtor of a single ParticipantMetric
     *
     * @param string $type The type of the ScoringMetric (e.g. "functional_dependency")
     * @param string $value The pattern solution value of the ScoringMetric
     * @access public
     */
    public function __construct($type, $value)
    {
        $this->type = $type;
        $this->value = $value;
    }

    /**
     * Serialize a ParticipantMetric object to a JSON string
     *
     * @return string The JSON string
     */
    public function toJSON(): string
    {
        // To use json_encode we need an array containing the values of the object
        $arr = array('type' => $this->type, 'value' => $this->value);

        return json_encode($arr);
    }

    /**
     * Get the type of the ParticipantMetric
     *
     * @return string The type of the ScoringMetric
     */
    public function getType(): string
    {
        return $this->type;
    }

    /**
     * Get the value of the ParticipantMetric
     *
     * @return string The value of the ScoringMetric
     */
    public function getValue(): string
    {
        return $this->value;
    }
}
