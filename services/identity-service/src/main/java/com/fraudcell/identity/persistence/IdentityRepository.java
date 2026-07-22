package com.fraudcell.identity.persistence;

import com.fraudcell.identity.domain.IdentityUser;
import com.fraudcell.identity.domain.IdentityUser.Kind;
import com.fraudcell.identity.domain.IdentityUser.Role;
import com.fraudcell.identity.domain.IdentityUser.Status;
import java.sql.Array;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Timestamp;
import java.time.Instant;
import java.util.Arrays;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowMapper;
import org.springframework.stereotype.Repository;

@Repository
public class IdentityRepository {
    private static final String USER_COLUMNS = """
            id,kind,first_name,last_name,gsm,email,password_hash,role,status,title,
            specialties,regions,failed_login_count,locked_until,session_epoch,version
            """;
    private final JdbcTemplate jdbc;

    public IdentityRepository(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    public Optional<IdentityUser> findByGsm(String gsm) {
        return jdbc.query("select " + USER_COLUMNS + " from identity_users where gsm=?", USER_MAPPER, gsm)
                .stream().findFirst();
    }

    public Optional<IdentityUser> findByEmail(String email) {
        return jdbc.query("select " + USER_COLUMNS + " from identity_users where lower(email)=lower(?)",
                USER_MAPPER, email).stream().findFirst();
    }

    public Optional<IdentityUser> lockByEmail(String email) {
        return jdbc.query("select " + USER_COLUMNS + " from identity_users where lower(email)=lower(?) for update",
                USER_MAPPER, email).stream().findFirst();
    }

    public Optional<IdentityUser> findById(UUID id) {
        return jdbc.query("select " + USER_COLUMNS + " from identity_users where id=?", USER_MAPPER, id)
                .stream().findFirst();
    }

    public void insertCustomer(UUID id, String firstName, String lastName, String gsm, String email) {
        jdbc.update("""
                insert into identity_users(id,kind,first_name,last_name,gsm,email,role,status)
                values (?,'CUSTOMER',?,?,?,?, 'CUSTOMER','ACTIVE')
                """, id, firstName, lastName, gsm, blankToNull(email));
    }

    public void insertStaff(IdentityUser user) {
        jdbc.update(connection -> {
            var statement = connection.prepareStatement("""
                    insert into identity_users
                    (id,kind,first_name,last_name,email,password_hash,role,status,title,specialties,regions)
                    values (?,'STAFF',?,?,?,?,?::varchar,?::varchar,?,?,?)
                    """);
            statement.setObject(1, user.id());
            statement.setString(2, user.firstName());
            statement.setString(3, user.lastName());
            statement.setString(4, user.email().toLowerCase());
            statement.setString(5, user.passwordHash());
            statement.setString(6, user.role().name());
            statement.setString(7, user.status().name());
            statement.setString(8, user.title());
            statement.setArray(9, connection.createArrayOf("text", user.specialties().toArray()));
            statement.setArray(10, connection.createArrayOf("text", user.regions().toArray()));
            return statement;
        });
    }

    public void updateStaff(IdentityUser user) {
        jdbc.update(connection -> {
            var statement = connection.prepareStatement("""
                    update identity_users set role=?::varchar,status=?::varchar,title=?,specialties=?,regions=?,
                    session_epoch=?,version=version+1,updated_at=now() where id=? and kind='STAFF'
                    """);
            statement.setString(1, user.role().name());
            statement.setString(2, user.status().name());
            statement.setString(3, user.title());
            statement.setArray(4, connection.createArrayOf("text", user.specialties().toArray()));
            statement.setArray(5, connection.createArrayOf("text", user.regions().toArray()));
            statement.setLong(6, user.sessionEpoch());
            statement.setObject(7, user.id());
            return statement;
        });
    }

    public void registerFailedLogin(UUID id, boolean lock) {
        if (lock) {
            jdbc.update("""
                    update identity_users set failed_login_count=5,status='LOCKED',
                    locked_until=now()+interval '15 minutes',updated_at=now() where id=?
                    """, id);
        } else {
            jdbc.update("update identity_users set failed_login_count=failed_login_count+1,updated_at=now() where id=?", id);
        }
    }

    public void clearLoginFailures(UUID id) {
        jdbc.update("""
                update identity_users set failed_login_count=0,locked_until=null,
                status=case when status='LOCKED' then 'ACTIVE' else status end,updated_at=now() where id=?
                """, id);
    }

    public UUID insertOtp(String gsm, String codeHash, Instant expiresAt) {
        UUID id = UUID.randomUUID();
        jdbc.update("insert into otp_challenges(id,gsm,code_hash,expires_at) values (?,?,?,?)",
                id, gsm, codeHash, Timestamp.from(expiresAt));
        return id;
    }

    public Optional<OtpChallenge> lockOtp(UUID challengeId, String gsm) {
        return jdbc.query("""
                select id,gsm,code_hash,expires_at,used_at,attempts from otp_challenges
                where id=? and gsm=? for update
                """, (rs, row) -> new OtpChallenge(
                rs.getObject("id", UUID.class), rs.getString("gsm"), rs.getString("code_hash"),
                rs.getTimestamp("expires_at").toInstant(), instant(rs, "used_at"), rs.getInt("attempts")),
                challengeId, gsm).stream().findFirst();
    }

    public void failOtp(UUID id) {
        jdbc.update("update otp_challenges set attempts=least(attempts+1,5) where id=?", id);
    }

    public void useOtp(UUID id) {
        jdbc.update("update otp_challenges set used_at=now() where id=? and used_at is null", id);
    }

    public void insertSession(Session session) {
        jdbc.update("""
                insert into auth_sessions(id,family_id,user_id,refresh_hash,expires_at)
                values (?,?,?,?,?)
                """, session.id(), session.familyId(), session.userId(), session.refreshHash(),
                Timestamp.from(session.expiresAt()));
    }

    public Optional<Session> lockSessionByHash(String hash) {
        return jdbc.query("""
                select id,family_id,user_id,refresh_hash,expires_at,revoked_at,replaced_by
                from auth_sessions where refresh_hash=? for update
                """, SESSION_MAPPER, hash).stream().findFirst();
    }

    public void rotateSession(UUID oldId, UUID replacementId) {
        jdbc.update("update auth_sessions set revoked_at=now(),replaced_by=?,last_used_at=now() where id=?",
                replacementId, oldId);
    }

    public long revokeAllSessions(UUID userId) {
        jdbc.update("update auth_sessions set revoked_at=coalesce(revoked_at,now()) where user_id=?", userId);
        return jdbc.queryForObject("""
                update identity_users set session_epoch=session_epoch+1,updated_at=now()
                where id=? returning session_epoch
                """, Long.class, userId);
    }

    public List<IdentityUser> listStaff(int size, int offset) {
        return jdbc.query("select " + USER_COLUMNS + " from identity_users where kind='STAFF' order by created_at,id limit ? offset ?",
                USER_MAPPER, size, offset);
    }

    public long countStaff() {
        return jdbc.queryForObject("select count(*) from identity_users where kind='STAFF'", Long.class);
    }

    public void audit(UUID id, UUID actorId, String actorRole, String action, String result,
                      String resourceType, String resourceId, String maskedIp, UUID requestId, String detailsJson) {
        jdbc.update("""
                insert into audit_logs(id,actor_id,actor_role,action,result,resource_type,resource_id,
                                       ip_address_masked,request_id,details)
                values (?,?,?,?,?,?,?,?,?,?::jsonb)
                """, id, actorId, actorRole, action, result, resourceType, resourceId, maskedIp, requestId, detailsJson);
    }

    public List<AuditRow> listAudit(int size, int offset) {
        return jdbc.query("""
                select id,actor_id,action,result,resource_type,resource_id,ip_address_masked,occurred_at
                from audit_logs order by occurred_at desc,id limit ? offset ?
                """, (rs, row) -> new AuditRow(
                rs.getObject("id", UUID.class), rs.getObject("actor_id", UUID.class), rs.getString("action"),
                rs.getString("result"), rs.getString("resource_type"), rs.getString("resource_id"),
                rs.getString("ip_address_masked"), rs.getTimestamp("occurred_at").toInstant()), size, offset);
    }

    public long countAudit() {
        return jdbc.queryForObject("select count(*) from audit_logs", Long.class);
    }

    public void outbox(String eventType, UUID aggregateId, long aggregateVersion,
                       UUID correlationId, UUID causationId, String payloadJson) {
        jdbc.update("""
                insert into outbox_events(event_id,event_type,aggregate_id,aggregate_version,
                                          correlation_id,causation_id,payload)
                values (?,?,?,?,?,?,?::jsonb)
                """, UUID.randomUUID(), eventType, aggregateId, aggregateVersion,
                correlationId, causationId, payloadJson);
    }

    public List<OutboxRow> lockOutbox(int size) {
        return jdbc.query("""
                select event_id,event_type,aggregate_id,aggregate_version,correlation_id,causation_id,
                       payload::text,occurred_at from outbox_events where published_at is null
                order by occurred_at limit ? for update skip locked
                """, (rs, row) -> new OutboxRow(
                rs.getObject("event_id", UUID.class), rs.getString("event_type"),
                rs.getObject("aggregate_id", UUID.class), rs.getLong("aggregate_version"),
                rs.getObject("correlation_id", UUID.class), rs.getObject("causation_id", UUID.class),
                rs.getString("payload"), rs.getTimestamp("occurred_at").toInstant()), size);
    }

    public void markPublished(UUID eventId) {
        jdbc.update("update outbox_events set published_at=now(),attempts=attempts+1,last_error=null where event_id=?", eventId);
    }

    public void markPublishFailure(UUID eventId, String error) {
        jdbc.update("update outbox_events set attempts=attempts+1,last_error=? where event_id=?",
                error == null ? "publish failed" : error.substring(0, Math.min(500, error.length())), eventId);
    }

    private static final RowMapper<IdentityUser> USER_MAPPER = (rs, row) -> new IdentityUser(
            rs.getObject("id", UUID.class), Kind.valueOf(rs.getString("kind")),
            rs.getString("first_name"), rs.getString("last_name"), rs.getString("gsm"), rs.getString("email"),
            rs.getString("password_hash"), Role.valueOf(rs.getString("role")), Status.valueOf(rs.getString("status")),
            rs.getString("title"), textArray(rs, "specialties"), textArray(rs, "regions"),
            rs.getInt("failed_login_count"), instant(rs, "locked_until"),
            rs.getLong("session_epoch"), rs.getLong("version"));

    private static final RowMapper<Session> SESSION_MAPPER = (rs, row) -> new Session(
            rs.getObject("id", UUID.class), rs.getObject("family_id", UUID.class),
            rs.getObject("user_id", UUID.class), rs.getString("refresh_hash"),
            rs.getTimestamp("expires_at").toInstant(), instant(rs, "revoked_at"),
            rs.getObject("replaced_by", UUID.class));

    private static List<String> textArray(ResultSet rs, String name) throws SQLException {
        Array array = rs.getArray(name);
        return array == null ? List.of() : List.copyOf(Arrays.asList((String[]) array.getArray()));
    }

    private static Instant instant(ResultSet rs, String name) throws SQLException {
        Timestamp value = rs.getTimestamp(name);
        return value == null ? null : value.toInstant();
    }

    private static String blankToNull(String value) {
        return value == null || value.isBlank() ? null : value.trim().toLowerCase();
    }

    public record OtpChallenge(UUID id, String gsm, String codeHash, Instant expiresAt, Instant usedAt, int attempts) {}
    public record Session(UUID id, UUID familyId, UUID userId, String refreshHash,
                          Instant expiresAt, Instant revokedAt, UUID replacedBy) {}
    public record AuditRow(UUID id, UUID actorId, String action, String result, String resourceType,
                           String resourceId, String ipAddressMasked, Instant occurredAt) {}
    public record OutboxRow(UUID eventId, String eventType, UUID aggregateId, long aggregateVersion,
                            UUID correlationId, UUID causationId, String payload, Instant occurredAt) {}
}
