package com.fraudcell.gamification.domain;

import java.util.Map;
import java.util.Objects;

public record AnalystStats(
        long verifiedFrauds,
        long fastReviews,
        long reviewedCases,
        long falseBlocks,
        long maxCompletedInDay,
        long criticalWithinSla,
        Map<String, Long> verifiedFraudsByType) {

    public AnalystStats {
        Objects.requireNonNull(verifiedFraudsByType, "verifiedFraudsByType");
        if (verifiedFrauds < 0 || fastReviews < 0 || reviewedCases < 0 || falseBlocks < 0
                || maxCompletedInDay < 0 || criticalWithinSla < 0
                || verifiedFraudsByType.values().stream().anyMatch(value -> value == null || value < 0)) {
            throw new IllegalArgumentException("statistics cannot be negative");
        }
        verifiedFraudsByType = Map.copyOf(verifiedFraudsByType);
    }
}
