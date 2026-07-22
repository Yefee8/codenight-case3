package com.fraudcell.gamification.domain;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.Map;
import org.junit.jupiter.api.Test;

class BadgeEvaluatorTest {
    private final BadgeEvaluator evaluator = new BadgeEvaluator();

    @Test
    void awardsAllSixBadgesAtTheirExactBoundaries() {
        var stats = new AnalystStats(1, 10, 50, 0, 20, 10, Map.of("CARD_STOLEN", 50L));

        assertThat(evaluator.eligibleBadges(stats)).containsExactlyInAnyOrder(BadgeCode.values());
    }

    @Test
    void oneFalseBlockPreventsZeroErrorAndOtherBelowBoundariesDoNotAward() {
        var stats = new AnalystStats(0, 9, 50, 1, 19, 9, Map.of("CARD_STOLEN", 49L));

        assertThat(evaluator.eligibleBadges(stats)).isEmpty();
    }
}
