package com.fraudcell.gamification.application;

import tools.jackson.core.JacksonException;
import tools.jackson.databind.json.JsonMapper;
import com.fraudcell.gamification.domain.AnalystLevel;
import com.fraudcell.gamification.domain.BadgeCode;
import com.fraudcell.gamification.domain.PointReason;
import com.fraudcell.gamification.messaging.EventEnvelope;
import java.sql.Timestamp;
import java.time.LocalDate;
import java.time.ZoneId;
import java.time.temporal.WeekFields;
import java.util.EnumSet;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.support.TransactionSynchronization;
import org.springframework.transaction.support.TransactionSynchronizationManager;

@Service
public class LedgerService {
    private static final Logger LOG = LoggerFactory.getLogger(LedgerService.class);
    private static final ZoneId BUSINESS_ZONE = ZoneId.of("Europe/Istanbul");
    private final JdbcTemplate jdbc;
    private final JsonMapper objectMapper;
    private final StringRedisTemplate redis;
    private final GameSseHub sseHub;

    public LedgerService(JdbcTemplate jdbc, JsonMapper objectMapper, StringRedisTemplate redis, GameSseHub sseHub) {
        this.jdbc = jdbc;
        this.objectMapper = objectMapper;
        this.redis = redis;
        this.sseHub = sseHub;
    }

    public void ensureAnalyst(UUID analystId, String displayName) {
        jdbc.update("""
                INSERT INTO analyst_profiles (analyst_id, display_name)
                VALUES (?, ?) ON CONFLICT (analyst_id) DO NOTHING
                """, analystId, displayName);
    }

    public boolean award(EventEnvelope event, UUID analystId, UUID caseId, PointReason reason, Map<String, ?> metadata) {
        ensureAnalyst(analystId, "Analist-" + analystId.toString().substring(0, 8));
        var ids = jdbc.query("""
                INSERT INTO point_ledger
                    (event_id, analyst_id, case_id, reason, points, aggregate_version, occurred_at, metadata)
                VALUES (?, ?, ?, ?, ?, ?, ?, CAST(? AS jsonb))
                ON CONFLICT (event_id, reason) DO NOTHING RETURNING id
                """, (rs, rowNum) -> rs.getObject(1, UUID.class), event.eventId(), analystId, caseId,
                reason.name(), reason.points(), event.aggregateVersion(), Timestamp.from(event.occurredAt()), json(metadata));
        if (ids.isEmpty()) return false;

        UUID ledgerId = ids.getFirst();
        var totals = jdbc.queryForMap("""
                UPDATE analyst_profiles
                   SET total_points = total_points + ?, version = version + 1, updated_at = now()
                 WHERE analyst_id = ? RETURNING total_points, level
                """, reason.points(), analystId);
        long total = ((Number) totals.get("total_points")).longValue();
        String previousLevel = String.valueOf(totals.get("level"));
        String level = AnalystLevel.fromPoints(total).name();
        if (!level.equals(previousLevel)) {
            jdbc.update("UPDATE analyst_profiles SET level = ? WHERE analyst_id = ?", level, analystId);
        }
        updatePeriodStats(event, analystId, reason.points(), reason == PointReason.TERMINAL_DECISION);
        enqueue(event, "points.changed", analystId, Map.of(
                "analyst_id", analystId, "ledger_id", ledgerId, "delta", reason.points(),
                "reason", reason.name(), "effective_total", total));
        if (!level.equals(previousLevel)) {
            enqueue(event, "level.changed", analystId, Map.of(
                    "analyst_id", analystId, "from_level", previousLevel,
                    "to_level", level, "effective_points", total));
        }
        evaluateBadges(event, analystId);
        afterCommit(analystId, event.eventId(), "points.changed", Map.of(
                "message", "Puanınız güncellendi.", "delta", reason.points(),
                "reason", reason.name(), "effective_total", total));
        return true;
    }

    private void updatePeriodStats(EventEnvelope event, UUID analystId, int points, boolean completed) {
        var date = event.occurredAt().atZone(BUSINESS_ZONE).toLocalDate();
        var fields = WeekFields.ISO;
        jdbc.update("""
                INSERT INTO daily_stats (analyst_id, local_day, points, completed_cases)
                VALUES (?, ?, ?, ?) ON CONFLICT (analyst_id, local_day) DO UPDATE
                SET points = daily_stats.points + EXCLUDED.points,
                    completed_cases = daily_stats.completed_cases + EXCLUDED.completed_cases,
                    updated_at = now()
                """, analystId, date, points, completed ? 1 : 0);
        jdbc.update("""
                INSERT INTO weekly_stats (analyst_id, iso_year, iso_week, points, completed_cases)
                VALUES (?, ?, ?, ?, ?) ON CONFLICT (analyst_id, iso_year, iso_week) DO UPDATE
                SET points = weekly_stats.points + EXCLUDED.points,
                    completed_cases = weekly_stats.completed_cases + EXCLUDED.completed_cases,
                    updated_at = now()
                """, analystId, date.get(fields.weekBasedYear()), date.get(fields.weekOfWeekBasedYear()),
                points, completed ? 1 : 0);
    }

    private void evaluateBadges(EventEnvelope event, UUID analystId) {
        Map<String, Object> counts = jdbc.queryForMap("""
                SELECT count(*) FILTER (WHERE reason = 'VERIFIED_FRAUD') AS frauds,
                       count(*) FILTER (WHERE reason = 'FAST_REVIEW') AS fast,
                       count(*) FILTER (WHERE reason = 'TERMINAL_DECISION') AS reviewed,
                       count(*) FILTER (WHERE reason = 'FALSE_BLOCK') AS false_blocks,
                       count(*) FILTER (WHERE reason = 'CRITICAL_WITHIN_SLA') AS critical
                  FROM point_ledger WHERE analyst_id = ?
                """, analystId);
        long maxDaily = jdbc.queryForObject(
                "SELECT COALESCE(max(completed_cases), 0) FROM daily_stats WHERE analyst_id = ?", Long.class, analystId);
        long sameType = jdbc.queryForObject("""
                SELECT COALESCE(max(type_count), 0) FROM (
                    SELECT count(*) AS type_count FROM point_ledger
                     WHERE analyst_id = ? AND reason = 'VERIFIED_FRAUD'
                     GROUP BY metadata->>'fraud_type'
                ) counts
                """, Long.class, analystId);
        var eligible = EnumSet.noneOf(BadgeCode.class);
        addIf(eligible, number(counts, "frauds") >= 1, BadgeCode.FIRST_CATCH);
        addIf(eligible, number(counts, "fast") >= 10, BadgeCode.SHARP_EYE);
        addIf(eligible, number(counts, "reviewed") >= 50 && number(counts, "false_blocks") == 0, BadgeCode.ZERO_ERROR);
        addIf(eligible, maxDaily >= 20, BadgeCode.MARATHONER);
        addIf(eligible, number(counts, "critical") >= 10, BadgeCode.CRISIS_MANAGER);
        addIf(eligible, sameType >= 50, BadgeCode.EXPERT_HUNTER);
        for (var badge : eligible) earnBadge(event, analystId, badge);
    }

    private void earnBadge(EventEnvelope event, UUID analystId, BadgeCode badge) {
        int inserted = jdbc.update("""
                INSERT INTO earned_badges (analyst_id, badge_code, source_event_id, earned_at)
                VALUES (?, ?, ?, ?) ON CONFLICT DO NOTHING
                """, analystId, badge.name(), event.eventId(), Timestamp.from(event.occurredAt()));
        if (inserted == 0) return;
        enqueue(event, "badge.earned", analystId, Map.of(
                "analyst_id", analystId, "badge_code", badge.name(), "earned_at", event.occurredAt()));
        afterCommit(analystId, event.eventId(), "badge.earned", Map.of(
                "message", "Yeni rozet kazandınız.",
                "badge_code", badge.name(), "badge_name", badge.name()));
    }

    private void enqueue(EventEnvelope source, String type, UUID analystId, Map<String, ?> payload) {
        jdbc.update("""
                INSERT INTO outbox_events
                    (event_type, aggregate_id, aggregate_version, correlation_id, causation_id, payload)
                VALUES (?, ?, ?, ?, ?, CAST(? AS jsonb))
                """, type, analystId, source.aggregateVersion(), source.correlationId(), source.eventId(), json(payload));
    }

    private void afterCommit(UUID analystId, UUID eventId, String type, Map<String, ?> data) {
        TransactionSynchronizationManager.registerSynchronization(new TransactionSynchronization() {
            @Override public void afterCommit() {
                try {
                    LocalDate today = LocalDate.now(BUSINESS_ZONE);
                    WeekFields fields = WeekFields.ISO;
                    redis.delete(java.util.List.of(
                            "fraudcell:game:profile:v1:" + analystId,
                            "fraudcell:game:leaderboard:v1:daily:" + today,
                            "fraudcell:game:leaderboard:v1:weekly:" + today.get(fields.weekBasedYear())
                                    + "-W" + today.get(fields.weekOfWeekBasedYear())));
                } catch (RuntimeException exception) {
                    LOG.warn("gamification cache invalidation deferred");
                }
                sseHub.publish(analystId, eventId, type, data);
            }
        });
    }

    private static long number(Map<String, Object> values, String key) {
        return ((Number) values.get(key)).longValue();
    }

    private static void addIf(Set<BadgeCode> badges, boolean condition, BadgeCode badge) {
        if (condition) badges.add(badge);
    }

    private String json(Object value) {
        try {
            return objectMapper.writeValueAsString(value);
        } catch (JacksonException exception) {
            throw new IllegalArgumentException("event payload cannot be serialized", exception);
        }
    }
}
