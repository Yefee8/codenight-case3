package com.fraudcell.gamification.api;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

public final class GameDtos {
    private GameDtos() {}

    public record BadgeView(String code, String name, String description, boolean earned, Instant earnedAt) {}

    public record ProfileView(
            UUID analystId,
            String name,
            long totalPoints,
            String level,
            long solvedCases,
            Double averageFeedback,
            Long dailyRank,
            Long weeklyRank,
            List<BadgeView> badges) {}

    public record LeaderboardEntry(long rank, UUID analystId, String name, long points, String level) {}

    public record LeaderboardView(
            String period,
            Instant generatedAt,
            boolean stale,
            List<LeaderboardEntry> entries) {}
}
