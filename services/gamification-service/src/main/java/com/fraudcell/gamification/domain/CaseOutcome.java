package com.fraudcell.gamification.domain;

import java.time.Duration;
import java.util.Objects;

public record CaseOutcome(
        boolean terminalDecision,
        Duration reviewDuration,
        boolean verifiedFraud,
        boolean critical,
        boolean withinSla,
        boolean slaBreached,
        boolean falseBlock) {

    public CaseOutcome {
        Objects.requireNonNull(reviewDuration, "reviewDuration");
        if (reviewDuration.isNegative()) {
            throw new IllegalArgumentException("reviewDuration cannot be negative");
        }
        if (withinSla && slaBreached) {
            throw new IllegalArgumentException("withinSla and slaBreached cannot both be true");
        }
    }
}
