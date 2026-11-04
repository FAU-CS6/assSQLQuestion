<?php

declare(strict_types=1);

/**
 * SQL question import
 */

class assSQLQuestionImport extends assQuestionImport
{
    /**
     * Creates a question from a QTI file
     *
     * Receives parameters from a QTI parser and creates a valid ILIAS question object.
     * As in `ilQTIItem` all variables are of type string, we need to typecast some of them.
     *
     * @param ilQtiItem $item The QTI item object
     * @param integer $questionpool_id The id of the parent questionpool
     * @param integer $tst_id The id of the parent test if the question is part of a test
     * @param object $tst_object A reference to the parent test object
     * @param integer $question_counter A reference to a question counter to count the questions of an imported question pool
     * @param array $import_mapping An array containing references to included ILIAS objects
     * @access public
     */
    public function fromXML(
        string $importdirectory,
        int $user_id,
        ilQTIItem $item,
        int $questionpool_id,
        ?int $tst_id,
        ?ilObject &$tst_object,
        int &$question_counter,
        array $import_mapping
    ): array {
        global $DIC;

        $ilLog = $DIC->logger()->root();

        // Empty session variable for imported xhtml mobs
        ilSession::clear('import_mob_xhtml');

        $presentation = $item->getPresentation();
        $now = getdate();
        $created = sprintf("%04d%02d%02d%02d%02d%02d", $now['year'], $now['mon'], $now['mday'], $now['hours'], $now['minutes'], $now['seconds']);

        // Get the generic feedback
        $feedbacksgeneric = array();
        if (isset($item->itemfeedback)) {
            foreach ($item->itemfeedback as $ifb) {
                if (strcmp($ifb->getIdent(), "response_allcorrect") == 0) {
                    // Found a feedback for the identifier
                    if (count($ifb->material)) {
                        foreach ($ifb->material as $material) {
                            $feedbacksgeneric[1] = $material;
                        }
                    }
                    if ((count($ifb->flow_mat) > 0)) {
                        foreach ($ifb->flow_mat as $fmat) {
                            if (count($fmat->material)) {
                                foreach ($fmat->material as $material) {
                                    $feedbacksgeneric[1] = $material;
                                }
                            }
                        }
                    }
                } elseif (strcmp($ifb->getIdent(), "response_onenotcorrect") == 0) {
                    // Found a feedback for the identifier
                    if (count($ifb->material)) {
                        foreach ($ifb->material as $material) {
                            $feedbacksgeneric[0] = $material;
                        }
                    }
                    if ((count($ifb->flow_mat) > 0)) {
                        foreach ($ifb->flow_mat as $fmat) {
                            if (count($fmat->material)) {
                                foreach ($fmat->material as $material) {
                                    $feedbacksgeneric[0] = $material;
                                }
                            }
                        }
                    }
                }
            }
        }
        // Set generic question properties
        $this->addGeneralMetadata($item);
        $this->object->setTitle($item->getTitle());
        $this->object->setNrOfTries((int) $item->getMaxattempts());
        $this->object->setComment($item->getComment());
        $this->object->setAuthor($item->getAuthor());
        $this->object->setOwner($user_id);
        $this->object->setQuestion($this->QTIMaterialToString($item->getQuestiontext()));
        $this->object->setObjId($questionpool_id);
        $this->object->setPoints((float) $item->getMetadataEntry("POINTS"));

        // Set plugin specific information
        $this->object->setSequence("sequence_a", $item->getMetadataEntry("SEQUENCE_A"));
        $this->object->setSequence("sequence_b", $item->getMetadataEntry("SEQUENCE_B"));
        $this->object->setSequence("sequence_c", $item->getMetadataEntry("SEQUENCE_C"));
        $this->object->setIntegrityCheck((bool) $item->getMetadataEntry("INTEGRITY_CHECK"));
        $this->object->setErrorBool((bool) $item->getMetadataEntry("ERROR_BOOL"));
        $this->object->setError($item->getMetadataEntry("ERROR"));
        $this->object->setExecutedBool((bool) $item->getMetadataEntry("EXECUTED_BOOL"));
        $this->object->setOutputRelation($item->getMetadataEntry("OUTPUT_RELATION"));
        $this->object->setAllSolutionMetricsFromJSON($item->getMetadataEntry("SOLUTION_METRICS"));

        // Additional content editing mode information
        $this->object->setAdditionalContentEditingMode(
            $this->fetchAdditionalContentEditingModeInformation($item)
        );

        // First save the question to get a new question id
        $this->object->saveToDb();
        $this->importSuggestedSolutions($this->object->getId(), $item->suggested_solutions);

        // Convert the generic feedback
        foreach ($feedbacksgeneric as $correctness => $material) {
            $m = $this->QTIMaterialToString($material);
            $feedbacksgeneric[$correctness] = $m;
        }

        // Handle the import of media objects in XHTML code
        $questiontext = $this->object->getQuestion();
        if (is_array(ilSession::get("import_mob_xhtml"))) {
            foreach (ilSession::get("import_mob_xhtml") as $mob) {
                $importfile = $importdirectory . DIRECTORY_SEPARATOR . $mob["uri"];
                $ilLog->write($importfile);
                $media_object = ilObjMediaObject::_saveTempFileAsMediaObject(basename($importfile), $importfile, false);
                ilObjMediaObject::_saveUsage($media_object->getId(), "qpl:html", $this->object->getId());

                // Images in question text
                $questiontext = str_replace("src=\"" . $mob["mob"] . "\"", "src=\"" . "il_" . IL_INST_ID . "_mob_" . $media_object->getId() . "\"", $questiontext);

                // Images in feedback
                foreach ($feedbacksgeneric as $correctness => $material) {
                    $feedbacksgeneric[$correctness] = str_replace("src=\"" . $mob["mob"] . "\"", "src=\"" . "il_" . IL_INST_ID . "_mob_" . $media_object->getId() . "\"", $material);
                }
            }
        }
        $this->object->setQuestion(ilRTE::_replaceMediaObjectImageSrc($questiontext, 1));
        foreach ($feedbacksgeneric as $correctness => $material) {
            $this->object->feedbackOBJ->importGenericFeedback(
                $this->object->getId(),
                (bool) $correctness,
                ilRTE::_replaceMediaObjectImageSrc($material, 1)
            );
        }

        // Now save the question again
        $this->object->saveToDb();

        // Import mapping for tests
        $import_mapping[$item->getIdent()] = $this->addQuestionToParentObjectAndBuildMappingEntry(
            $questionpool_id,
            $tst_id,
            $question_counter,
            $tst_object
        );

        return $import_mapping;
    }
}
