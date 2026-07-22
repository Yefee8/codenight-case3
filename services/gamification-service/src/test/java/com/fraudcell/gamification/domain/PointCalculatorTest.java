package com.fraudcell.gamification.domain;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatIllegalArgumentException;

import java.time.Duration;
import org.junit.jupiter.api.Test;

class PointCalculatorTest {
    private final PointCalculator calculator = new PointCalculator();

    @Test
    void combinesEveryApplicablePositiveAndNegativeRuleExactlyOnce() {
        var outcome = new CaseOutcome(true, Duration.ofMinutes(14).plusSeconds(59), true, true, false, true, true);

        var awards = calculator.calculate(outcome);

        assertThat(awards).extracting(PointAward::reason).containsExactly(
                PointReason.TERMINAL_DECISION,
                PointReason.FAST_REVIEW,
                PointReason.VERIFIED_FRAUD,
                PointReason.SLA_BREACH,
                PointReason.FALSE_BLOCK);
        assertThat(awards).extracting(PointAward::points).containsExactly(10, 5, 15, -5, -8);
    }

    @Test
    void exactFifteenMinutesIsNotFastButExactDeadlineIsWithinSla() {
        var outcome = new CaseOutcome(true, Duration.ofMinutes(15), false, true, true, false, false);

        assertThat(calculator.calculate(outcome)).extracting(PointAward::reason)
                .containsExactly(PointReason.TERMINAL_DECISION, PointReason.CRITICAL_WITHIN_SLA);
    }

    @Test
    void noFactsProduceNoLedgerEntries() {
        assertThat(calculator.calculate(new CaseOutcome(false, Duration.ZERO, false, false, false, false, false)))
                .isEmpty();
    }

    @Test
    void contradictorySlaFactsAreRejected() {
        assertThatIllegalArgumentException().isThrownBy(() ->
                new CaseOutcome(true, Duration.ZERO, false, false, true, true, false));
    }
}
