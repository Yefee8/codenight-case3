package com.fraudcell.gamification.domain;

import java.time.Duration;
import java.util.ArrayList;
import java.util.List;

public final class PointCalculator {
    private static final Duration FAST_REVIEW_LIMIT = Duration.ofMinutes(15);

    public List<PointAward> calculate(CaseOutcome outcome) {
        var awards = new ArrayList<PointAward>();
        addIf(awards, outcome.terminalDecision(), PointReason.TERMINAL_DECISION);
        addIf(awards,
                outcome.terminalDecision() && outcome.reviewDuration().compareTo(FAST_REVIEW_LIMIT) < 0,
                PointReason.FAST_REVIEW);
        addIf(awards, outcome.verifiedFraud(), PointReason.VERIFIED_FRAUD);
        addIf(awards, outcome.critical() && outcome.withinSla(), PointReason.CRITICAL_WITHIN_SLA);
        addIf(awards, outcome.slaBreached(), PointReason.SLA_BREACH);
        addIf(awards, outcome.falseBlock(), PointReason.FALSE_BLOCK);
        return List.copyOf(awards);
    }

    private static void addIf(List<PointAward> awards, boolean condition, PointReason reason) {
        if (condition) {
            awards.add(new PointAward(reason));
        }
    }
}
