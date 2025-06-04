<?php declare(strict_types=1);

use PHPUnit\Framework\TestCase;

final class ColumnNamesTest extends TestCase
{
    public function testGivesFullPointsForCorrectSolution(): void
    {
        $solution_metrics = [];
        array_push($solution_metrics, new SolutionMetric("column_names", 1, '["id","name","geburtsjahr"]'));
        array_push($solution_metrics, new SolutionMetric("functional_dependencies", 5, '["{\"determinateAttributes\":[\"id\"],\"dependentAttributes\":[\"name\"]}","{\"determinateAttributes\":[\"id\"],\"dependentAttributes\":[\"geburtsjahr\"]}","{\"determinateAttributes\":[\"name\"],\"dependentAttributes\":[\"id\"]}","{\"determinateAttributes\":[\"name\"],\"dependentAttributes\":[\"geburtsjahr\"]}"]'));
        array_push($solution_metrics, new SolutionMetric("result_lines", 7, '100'));

        $participant_metrics = [];
        array_push($participant_metrics, new ParticipantMetric("column_names", '["geburtsjahr","id","name"]'));
        array_push($participant_metrics, new ParticipantMetric("functional_dependencies", '["{\"determinateAttributes\":[\"id\"],\"dependentAttributes\":[\"name\"]}","{\"determinateAttributes\":[\"id\"],\"dependentAttributes\":[\"geburtsjahr\"]}","{\"determinateAttributes\":[\"name\"],\"dependentAttributes\":[\"id\"]}","{\"determinateAttributes\":[\"name\"],\"dependentAttributes\":[\"geburtsjahr\"]}"]'));
        array_push($participant_metrics, new ParticipantMetric("result_lines", "100"));

        $points = ColumnNames::calculateReachedPoints($solution_metrics, $participant_metrics);

        $this->assertSame(1.0, $points);
    }

    public function testGivesZeroPointsForIncorrectSolution(): void
    {
        $solution_metrics = [];
        array_push($solution_metrics, new SolutionMetric("column_names", 1, '["id","name","geburtsjahr"]'));
        array_push($solution_metrics, new SolutionMetric("functional_dependencies", 5, '["{\"determinateAttributes\":[\"id\"],\"dependentAttributes\":[\"name\"]}","{\"determinateAttributes\":[\"id\"],\"dependentAttributes\":[\"geburtsjahr\"]}","{\"determinateAttributes\":[\"name\"],\"dependentAttributes\":[\"id\"]}","{\"determinateAttributes\":[\"name\"],\"dependentAttributes\":[\"geburtsjahr\"]}"]'));
        array_push($solution_metrics, new SolutionMetric("result_lines", 7, '100'));

        $participant_metrics = [];
        array_push($participant_metrics, new ParticipantMetric("column_names", '["geburtsjahr_error","id_error","name_error"]'));
        array_push($participant_metrics, new ParticipantMetric("functional_dependencies", '["{\"determinateAttributes\":[\"id\"],\"dependentAttributes\":[\"name\"]}","{\"determinateAttributes\":[\"id\"],\"dependentAttributes\":[\"geburtsjahr\"]}","{\"determinateAttributes\":[\"name\"],\"dependentAttributes\":[\"id\"]}","{\"determinateAttributes\":[\"name\"],\"dependentAttributes\":[\"geburtsjahr\"]}"]'));
        array_push($participant_metrics, new ParticipantMetric("result_lines", "0"));

        $points = ColumnNames::calculateReachedPoints($solution_metrics, $participant_metrics);

        $this->assertSame(0.0, $points);
    }

    public function testGivesZeroPointsIfOnlySolutionIsEmpty(): void
    {
        $solution_metrics = [new SolutionMetric("column_names", 7, "")];
        $participant_metrics = [new ParticipantMetric("column_names", '["id","name","geburtsjahr"]')];
        $points = ColumnNames::calculateReachedPoints($solution_metrics, $participant_metrics);

        $this->assertSame(0.0, $points);
    }

    public function testGivesZeroPointsIfOnlyParticipantIsEmpty(): void
    {
        $solution_metrics = [new SolutionMetric("column_names", 7, '["id","name","geburtsjahr"]')];
        $participant_metrics = [new ParticipantMetric("column_names", "")];
        $points = ColumnNames::calculateReachedPoints($solution_metrics, $participant_metrics);

        $this->assertSame(0.0, $points);
    }

    public function testGivesFullPointsIfBothSolutionsAreEmpty(): void
    {
        $solution_metrics = [new SolutionMetric("column_names", 7, "")];
        $participant_metrics = [new ParticipantMetric("column_names", "")];
        $points = ColumnNames::calculateReachedPoints($solution_metrics, $participant_metrics);

        $this->assertSame(7.0, $points);
    }

    public function testGivesFullPointsIfBothSolutionsAreEmpty2(): void
    {
        $solution_metrics = [new SolutionMetric("column_names", 7, "")];
        $participant_metrics = [];
        $points = ColumnNames::calculateReachedPoints($solution_metrics, $participant_metrics);

        $this->assertSame(7.0, $points);
    }

    public function testRecognizesEmptyArray(): void
    {
        $solution_metrics = [new SolutionMetric("column_names", 7, "")];
        $participant_metrics = [new ParticipantMetric("column_names", "[]")];
        $points = ColumnNames::calculateReachedPoints($solution_metrics, $participant_metrics);

        $this->assertSame(7.0, $points);
    }

    public function testGivesPartialPointsIfAIsSubsetOfB(): void
    {
        $solution_metrics = [new SolutionMetric("column_names", 10, '["id", "name"]')];
        $participant_metrics = [new ParticipantMetric("column_names", '["id"]')];
        $points = ColumnNames::calculateReachedPoints($solution_metrics, $participant_metrics);

        $this->assertSame(5.0, $points);
    }

    public function testGivesPartialPointsIfBIsSubsetOfA(): void
    {
        $solution_metrics = [new SolutionMetric("column_names", 10, '["id"]')];
        $participant_metrics = [new ParticipantMetric("column_names", '["id", "name"]')];
        $points = ColumnNames::calculateReachedPoints($solution_metrics, $participant_metrics);

        $this->assertSame(5.0, $points);
    }

    public function testGivesZeroPointsIfAAndBHaveNoCommonElement(): void
    {
        $solution_metrics = [new SolutionMetric("column_names", 10, '["geburtsjahr", "mentor"]')];
        $participant_metrics = [new ParticipantMetric("column_names", '["id", "name"]')];
        $points = ColumnNames::calculateReachedPoints($solution_metrics, $participant_metrics);

        $this->assertSame(0.0, $points);
    }

    public function testGivesFullPointsForCaseInsensitivity(): void
    {
        $solution_metrics = [new SolutionMetric("column_names", 10, '["id", "name"]')];
        $participant_metrics = [new ParticipantMetric("column_names", '["NAME", "ID"]')];
        $points = ColumnNames::calculateReachedPoints($solution_metrics, $participant_metrics);

        $this->assertSame(10.0, $points);
    }
}


