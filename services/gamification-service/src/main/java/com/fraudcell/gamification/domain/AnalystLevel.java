package com.fraudcell.gamification.domain;

public enum AnalystLevel {
    BRONZ(0, 499),
    GUMUS(500, 1499),
    ALTIN(1500, 2999),
    PLATIN(3000, Long.MAX_VALUE);

    private final long minimum;
    private final long maximum;

    AnalystLevel(long minimum, long maximum) {
        this.minimum = minimum;
        this.maximum = maximum;
    }

    public static AnalystLevel fromPoints(long points) {
        long normalized = Math.max(points, 0);
        for (var level : values()) {
            if (normalized >= level.minimum && normalized <= level.maximum) {
                return level;
            }
        }
        throw new IllegalStateException("No level for points: " + points);
    }
}
