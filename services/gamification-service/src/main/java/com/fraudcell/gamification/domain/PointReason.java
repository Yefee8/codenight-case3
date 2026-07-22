package com.fraudcell.gamification.domain;

public enum PointReason {
    TERMINAL_DECISION(10),
    FAST_REVIEW(5),
    VERIFIED_FRAUD(15),
    CRITICAL_WITHIN_SLA(15),
    SLA_BREACH(-5),
    FALSE_BLOCK(-8);

    private final int points;

    PointReason(int points) {
        this.points = points;
    }

    public int points() {
        return points;
    }
}
