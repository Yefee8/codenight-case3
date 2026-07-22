package com.fraudcell.gamification.domain;

import java.util.EnumSet;
import java.util.Set;

public final class BadgeEvaluator {
    public Set<BadgeCode> eligibleBadges(AnalystStats stats) {
        var result = EnumSet.noneOf(BadgeCode.class);
        addIf(result, stats.verifiedFrauds() >= 1, BadgeCode.FIRST_CATCH);
        addIf(result, stats.fastReviews() >= 10, BadgeCode.SHARP_EYE);
        addIf(result, stats.reviewedCases() >= 50 && stats.falseBlocks() == 0, BadgeCode.ZERO_ERROR);
        addIf(result, stats.maxCompletedInDay() >= 20, BadgeCode.MARATHONER);
        addIf(result, stats.criticalWithinSla() >= 10, BadgeCode.CRISIS_MANAGER);
        addIf(result,
                stats.verifiedFraudsByType().values().stream().anyMatch(count -> count >= 50),
                BadgeCode.EXPERT_HUNTER);
        return Set.copyOf(result);
    }

    private static void addIf(EnumSet<BadgeCode> result, boolean condition, BadgeCode badge) {
        if (condition) {
            result.add(badge);
        }
    }
}
