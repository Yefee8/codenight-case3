package com.fraudcell.gamification.domain;

public record PointAward(PointReason reason, int points) {
    public PointAward(PointReason reason) {
        this(reason, reason.points());
    }
}
