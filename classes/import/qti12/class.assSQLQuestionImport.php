<?php
/**
 * SQL question import
 */
class assSQLQuestionImport extends assQuestionImport
{
    /**
     * Creates a question from a QTI file
     *
     * Receives parameters from a QTI parser and creates a valid ILIAS question object
     *
     * @param object $item The QTI item object
     * @param integer $questionpool_id The id of the parent questionpool
     * @param integer $tst_id The id of the parent test if the question is part of a test
     * @param object $tst_object A reference to the parent test object
     * @param integer $question_counter A reference to a question counter to count the questions of an imported question pool
     * @param array $import_mapping An array containing references to included ILIAS objects
     * @access public
     */
    public function fromXML(&$item, $questionpool_id, &$tst_id, &$tst_object, &$question_counter, $import_mapping): array
    {
        global $DIC;
        
        $ilUser = $DIC->user();
        $ilLog = $DIC->logger()->root();

        // Empty session variable for imported xhtml mobs
        unset($_SESSION["import_mob_xhtml"]);
        $presentation = $item->getPresentation();
        $now = getdate();
        $created = sprintf("%04d%02d%02d%02d%02d%02d", $now['year'], $now['mon'], $now['mday'], $now['hours'], $now['minutes'], $now['seconds']);

        // Get the generic feedbach
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
        $this->object->setNrOfTries($item->getMaxattempts());
        $this->object->setComment($item->getComment());
        $this->object->setAuthor($item->getAuthor());
        $this->object->setOwner($ilUser->getId());
        $this->object->setQuestion($this->QTIMaterialToString($item->getQuestiontext()));
        $this->object->setObjId($questionpool_id);
        $this->object->setPoints($item->getMetadataEntry("POINTS"));

        // Set plugin specific information
        $this->object->setSequence("sequence_a", $item->getMetadataEntry("SEQUENCE_A"));
        $this->object->setSequence("sequence_b", $item->getMetadataEntry("SEQUENCE_B"));
        $this->object->setSequence("sequence_c", $item->getMetadataEntry("SEQUENCE_C"));
        $this->object->setIntegrityCheck($item->getMetadataEntry("INTEGRITY_CHECK"));
        $this->object->setErrorBool($item->getMetadataEntry("ERROR_BOOL"));
        $this->object->setError($item->getMetadataEntry("ERROR"));
        $this->object->setExecutedBool($item->getMetadataEntry("EXECUTED_BOOL"));
        $this->object->setOutputRelation($item->getMetadataEntry("OUTPUT_RELATION"));
        $this->object->setAllSolutionMetricsFromJSON($item->getMetadataEntry("SOLUTION_METRICS"));

        // Additional content editing mode information
        $this->object->setAdditionalContentEditingMode(
            $this->fetchAdditionalContentEditingModeInformation($item)
        );

        // First save the question to get a new question id
        $this->object->saveToDb();

        // Convert the generic feedback
        foreach ($feedbacksgeneric as $correctness => $material) {
            $m = $this->QTIMaterialToString($material);
            $feedbacksgeneric[$correctness] = $m;
        }

        // Handle the import of media objects in XHTML code
        $questiontext = $this->object->getQuestion();
        if (is_array($_SESSION["import_mob_xhtml"])) {
            include_once "./Services/MediaObjects/classes/class.ilObjMediaObject.php";
            include_once "./Services/RTE/classes/class.ilRTE.php";
            foreach ($_SESSION["import_mob_xhtml"] as $mob) {
                if ($tst_id > 0) {
                    $importfile = $this->getTstImportArchivDirectory() . '/' . $mob["uri"];
                } else {
                    $importfile = $this->getQplImportArchivDirectory() . '/' . $mob["uri"];
                }
                $ilLog->write($importfile);
                $media_object = ilObjMediaObject::_saveTempFileAsMediaObject(basename($importfile), $importfile, FALSE);
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
                $correctness,
                ilRTE::_replaceMediaObjectImageSrc($material, 1)
            );
        }

        // Now save the question again
        $this->object->saveToDb();

        // Import mapping for tests
        if ($tst_id > 0) {
            $q_1_id = $this->object->getId();
            $question_id = $this->object->duplicate(true, null, null, null, $tst_id);
            $tst_object->questions[$question_counter++] = $question_id;
            $import_mapping[$item->getIdent()] = array("pool" => $q_1_id, "test" => $question_id);
        } else {
            $import_mapping[$item->getIdent()] = array("pool" => $this->object->getId(), "test" => 0);
        }

        return $import_mapping;
    }
}
