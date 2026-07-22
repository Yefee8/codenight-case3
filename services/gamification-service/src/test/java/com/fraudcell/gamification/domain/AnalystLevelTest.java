package com.fraudcell.gamification.domain;

import static org.assertj.core.api.Assertions.assertThat;

import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;

class AnalystLevelTest {
    @ParameterizedTest
    @CsvSource({
        "-8, BRONZ", "0, BRONZ", "499, BRONZ", "500, GUMUS",
        "1499, GUMUS", "1500, ALTIN", "2999, ALTIN", "3000, PLATIN", "999999, PLATIN"
    })
    void resolvesAllBoundaries(long points, AnalystLevel expected) {
        assertThat(AnalystLevel.fromPoints(points)).isEqualTo(expected);
    }
}
