package com.fraudcell.gamification.application;

import tools.jackson.core.JacksonException;
import tools.jackson.databind.json.JsonMapper;
import com.fraudcell.gamification.api.GameDtos.BadgeView;
import com.fraudcell.gamification.api.GameDtos.LeaderboardEntry;
import com.fraudcell.gamification.api.GameDtos.LeaderboardView;
import com.fraudcell.gamification.api.GameDtos.ProfileView;
import com.fraudcell.gamification.security.RequestPrincipal;
import com.fraudcell.gamification.security.RlsContext;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneId;
import java.time.temporal.WeekFields;
import java.util.List;
import java.util.NoSuchElementException;
import java.util.Optional;
import java.util.UUID;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.dao.DataAccessException;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class GameQueryService {
    private static final Logger LOG = LoggerFactory.getLogger(GameQueryService.class);
    private static final ZoneId BUSINESS_ZONE = ZoneId.of("Europe/Istanbul");
    private static final Duration CACHE_TTL = Duration.ofSeconds(30);
    private final JdbcTemplate jdbc;
    private final StringRedisTemplate redis;
    private final JsonMapper objectMapper;
    private final RlsContext rls;
    private final Clock clock;

    @Autowired
    public GameQueryService(JdbcTemplate jdbc, StringRedisTemplate redis, JsonMapper objectMapper, RlsContext rls) {
        this(jdbc, redis, objectMapper, rls, Clock.systemUTC());
    }

    GameQueryService(JdbcTemplate jdbc, StringRedisTemplate redis, JsonMapper objectMapper, RlsContext rls, Clock clock) {
        this.jdbc = jdbc;
        this.redis = redis;
        this.objectMapper = objectMapper;
        this.rls = rls;
        this.clock = clock;
    }

    @Transactional(readOnly = true)
    public ProfileView profile(RequestPrincipal principal, UUID analystId) {
        rls.apply(principal.userId(), principal.role());
        if ("ANALYST".equals(principal.role()) && !principal.userId().equals(analystId)) {
            throw new NoSuchElementException("profile");
        }
        String key = "fraudcell:game:profile:v1:" + analystId;
        var cached = readCache(key, ProfileView.class);
        if (cached.isPresent()) return cached.get();

        var profiles = jdbc.query(
                "SELECT analyst_id, display_name, total_points, level FROM analyst_profiles WHERE analyst_id = ?",
                (rs, rowNum) -> new ProfileBase(
                        rs.getObject("analyst_id", UUID.class), rs.getString("display_name"),
                        rs.getLong("total_points"), rs.getString("level")), analystId);
        if (profiles.isEmpty()) throw new NoSuchElementException("profile");
        var base = profiles.getFirst();
        var badges = jdbc.query("""
                SELECT b.code, b.display_name, b.description, eb.earned_at
                  FROM earned_badges eb JOIN badges b ON b.code = eb.badge_code
                 WHERE eb.analyst_id = ? ORDER BY eb.earned_at, b.code
                """, (rs, rowNum) -> new BadgeView(
                        rs.getString("code"), rs.getString("display_name"),
                        rs.getString("description"), true, rs.getTimestamp("earned_at").toInstant()), analystId);
        var metrics = jdbc.queryForMap("""
                SELECT count(*) FILTER (WHERE reason = 'TERMINAL_DECISION') AS solved_cases
                  FROM point_ledger WHERE analyst_id = ?
                """, analystId);
        Double averageFeedback = jdbc.queryForObject(
                "SELECT avg(feedback_score)::double precision FROM case_facts WHERE analyst_id = ?",
                Double.class, analystId);
        LocalDate localDate = LocalDate.now(clock.withZone(BUSINESS_ZONE));
        Long dailyRank = rank("""
                SELECT analyst_id, rank() OVER (ORDER BY points DESC, completed_cases DESC, analyst_id) AS position
                  FROM daily_stats WHERE local_day = ?
                """, analystId, localDate);
        WeekFields fields = WeekFields.ISO;
        Long weeklyRank = rank("""
                SELECT analyst_id, rank() OVER (ORDER BY points DESC, completed_cases DESC, analyst_id) AS position
                  FROM weekly_stats WHERE iso_year = ? AND iso_week = ?
                """, analystId, localDate.get(fields.weekBasedYear()), localDate.get(fields.weekOfWeekBasedYear()));
        var result = new ProfileView(
                base.analystId(), base.name(), base.totalPoints(), base.level(),
                ((Number) metrics.get("solved_cases")).longValue(), averageFeedback,
                dailyRank, weeklyRank, badges);
        writeCache(key, result);
        return result;
    }

    @Transactional(readOnly = true)
    public List<BadgeView> badges(RequestPrincipal principal) {
        rls.apply(principal.userId(), principal.role());
        return jdbc.query("SELECT code, display_name, description FROM badges ORDER BY code",
                (rs, rowNum) -> new BadgeView(rs.getString(1), rs.getString(2), rs.getString(3), false, null));
    }

    @Transactional(readOnly = true)
    public LeaderboardView leaderboard(RequestPrincipal principal, String period) {
        if (!List.of("daily", "weekly").contains(period)) {
            throw new IllegalArgumentException("period daily veya weekly olmalıdır");
        }
        rls.apply(principal.userId(), principal.role());
        LocalDate localDate = LocalDate.now(clock.withZone(BUSINESS_ZONE));
        String key = "fraudcell:game:leaderboard:v1:" + period + ":" + periodKey(period, localDate);
        var cached = readCache(key, LeaderboardView.class);
        if (cached.isPresent()) return cached.get();

        List<LeaderboardEntry> entries = period.equals("daily")
                ? dailyLeaderboard(localDate)
                : weeklyLeaderboard(localDate);
        var result = new LeaderboardView(period, Instant.now(clock), false, entries);
        writeCache(key, result);
        return result;
    }

    private List<LeaderboardEntry> dailyLeaderboard(LocalDate date) {
        return jdbc.query("""
                SELECT rank() OVER (ORDER BY s.points DESC, s.completed_cases DESC, s.analyst_id) AS rank,
                       s.analyst_id, p.display_name, s.points, s.completed_cases, p.level
                  FROM daily_stats s JOIN analyst_profiles p USING (analyst_id)
                 WHERE s.local_day = ?
                 ORDER BY rank LIMIT 10
                """, (rs, rowNum) -> new LeaderboardEntry(
                        rs.getLong("rank"), rs.getObject("analyst_id", UUID.class), rs.getString("display_name"),
                        rs.getLong("points"), rs.getString("level")), date);
    }

    private List<LeaderboardEntry> weeklyLeaderboard(LocalDate date) {
        WeekFields fields = WeekFields.ISO;
        return jdbc.query("""
                SELECT rank() OVER (ORDER BY s.points DESC, s.completed_cases DESC, s.analyst_id) AS rank,
                       s.analyst_id, p.display_name, s.points, s.completed_cases, p.level
                  FROM weekly_stats s JOIN analyst_profiles p USING (analyst_id)
                 WHERE s.iso_year = ? AND s.iso_week = ?
                 ORDER BY rank LIMIT 10
                """, (rs, rowNum) -> new LeaderboardEntry(
                        rs.getLong("rank"), rs.getObject("analyst_id", UUID.class), rs.getString("display_name"),
                        rs.getLong("points"), rs.getString("level")),
                date.get(fields.weekBasedYear()), date.get(fields.weekOfWeekBasedYear()));
    }

    private Long rank(String rankedQuery, UUID analystId, Object... parameters) {
        var arguments = new Object[parameters.length + 1];
        System.arraycopy(parameters, 0, arguments, 0, parameters.length);
        arguments[parameters.length] = analystId;
        var values = jdbc.query(
                "SELECT position FROM (" + rankedQuery + ") ranked WHERE analyst_id = ?",
                (rs, rowNum) -> rs.getLong("position"), arguments);
        return values.isEmpty() ? null : values.getFirst();
    }

    private static String periodKey(String period, LocalDate date) {
        if (period.equals("daily")) return date.toString();
        WeekFields fields = WeekFields.ISO;
        return date.get(fields.weekBasedYear()) + "-W" + date.get(fields.weekOfWeekBasedYear());
    }

    private <T> Optional<T> readCache(String key, Class<T> type) {
        try {
            String value = redis.opsForValue().get(key);
            return value == null ? Optional.empty() : Optional.of(objectMapper.readValue(value, type));
        } catch (DataAccessException | JacksonException exception) {
            LOG.warn("gamification cache read failed; database fallback is active");
            return Optional.empty();
        }
    }

    private void writeCache(String key, Object value) {
        try {
            redis.opsForValue().set(key, objectMapper.writeValueAsString(value), CACHE_TTL);
        } catch (DataAccessException | JacksonException exception) {
            LOG.warn("gamification cache write failed; source of truth remains PostgreSQL");
        }
    }

    private record ProfileBase(UUID analystId, String name, long totalPoints, String level) {}
}
