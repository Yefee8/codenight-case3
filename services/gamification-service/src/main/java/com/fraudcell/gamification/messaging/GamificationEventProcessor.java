package com.fraudcell.gamification.messaging;

import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;
import com.fraudcell.gamification.application.LedgerService;
import com.fraudcell.gamification.domain.PointReason;
import com.fraudcell.gamification.security.RlsContext;
import java.io.IOException;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Timestamp;
import java.time.Duration;
import java.time.Instant;
import java.util.Map;
import java.util.UUID;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class GamificationEventProcessor {
    private final JsonMapper objectMapper;
    private final JdbcTemplate jdbc;
    private final RlsContext rls;
    private final LedgerService ledger;

    public GamificationEventProcessor(JsonMapper objectMapper, JdbcTemplate jdbc, RlsContext rls, LedgerService ledger) {
        this.objectMapper = objectMapper;
        this.jdbc = jdbc;
        this.rls = rls;
        this.ledger = ledger;
    }

    @Transactional
    public boolean process(byte[] body) throws IOException {
        rls.applyService();
        EventEnvelope event = objectMapper.readValue(body, EventEnvelope.class);
        String hash = EventHash.sha256(body);
        int inserted = jdbc.update("""
                INSERT INTO inbox_events
                    (event_id, event_type, aggregate_id, aggregate_version, payload_hash)
                VALUES (?, ?, ?, ?, ?) ON CONFLICT (event_id) DO NOTHING
                """, event.eventId(), event.eventType(), event.aggregateId(), event.aggregateVersion(), hash);
        if (inserted == 0) {
            String existing = jdbc.queryForObject(
                    "SELECT payload_hash FROM inbox_events WHERE event_id = ?", String.class, event.eventId());
            if (!hash.equals(existing)) throw new IllegalArgumentException("event id reused with another payload");
            return false;
        }

        switch (event.eventType()) {
            case "staff.created" -> staffCreated(event);
            case "staff.profile-updated" -> staffProfileUpdated(event);
            case "staff.status-changed" -> staffStatusChanged(event);
            case "case.created" -> caseCreated(event);
            case "case.assigned" -> caseAssigned(event);
            case "case.status-changed" -> caseStatusChanged(event);
            case "case.risk-level-overridden" -> riskChanged(event);
            case "case.decision-recorded" -> decisionRecorded(event);
            case "case.sla-breached" -> slaBreached(event);
            case "case.ground-truth-set" -> groundTruthSet(event);
            case "case.feedback-submitted" -> feedbackSubmitted(event);
            default -> { /* Routed catalog events with no game effect remain deduplicated. */ }
        }
        return true;
    }

    private void staffCreated(EventEnvelope event) {
        JsonNode payload = event.payload();
        if (!hasRole(payload.get("role"), "ANALYST")) return;
        UUID analystId = uuid(payload, "staff_id");
        ledger.ensureAnalyst(analystId, textOr(payload, "display_name", "Analist-" + analystId.toString().substring(0, 8)));
    }

    private void staffProfileUpdated(EventEnvelope event) {
        JsonNode payload = event.payload();
        if (!payload.hasNonNull("display_name")) return;
        jdbc.update("UPDATE analyst_profiles SET display_name = ?, updated_at = now() WHERE analyst_id = ?",
                text(payload, "display_name"), uuid(payload, "staff_id"));
    }

    private void staffStatusChanged(EventEnvelope event) {
        jdbc.update("UPDATE analyst_profiles SET status = ?, updated_at = now() WHERE analyst_id = ?",
                text(event.payload(), "status"), uuid(event.payload(), "staff_id"));
    }

    private void caseCreated(EventEnvelope event) {
        JsonNode payload = event.payload();
        UUID caseId = uuid(payload, "case_id");
        jdbc.update("""
                INSERT INTO case_facts (case_id, analyst_id, aggregate_version, risk_level, sla_due_at)
                VALUES (?, NULL, ?, ?, ?) ON CONFLICT (case_id) DO UPDATE
                   SET aggregate_version = GREATEST(case_facts.aggregate_version, EXCLUDED.aggregate_version),
                       risk_level = CASE WHEN EXCLUDED.aggregate_version >= case_facts.aggregate_version
                                         THEN EXCLUDED.risk_level ELSE case_facts.risk_level END,
                       sla_due_at = COALESCE(case_facts.sla_due_at, EXCLUDED.sla_due_at), updated_at = now()
                """, caseId, event.aggregateVersion(), text(payload, "risk_level"), db(instant(payload, "due_at")));
    }

    private void caseAssigned(EventEnvelope event) {
        JsonNode payload = event.payload();
        UUID caseId = uuid(payload, "case_id");
        UUID analystId = uuid(payload, "analyst_id");
        ledger.ensureAnalyst(analystId, "Analist-" + analystId.toString().substring(0, 8));
        jdbc.update("""
                INSERT INTO case_facts (case_id, analyst_id, aggregate_version)
                VALUES (?, ?, ?) ON CONFLICT (case_id) DO UPDATE
                   SET analyst_id = CASE WHEN EXCLUDED.aggregate_version >= case_facts.aggregate_version
                                         THEN EXCLUDED.analyst_id ELSE case_facts.analyst_id END,
                       aggregate_version = GREATEST(case_facts.aggregate_version, EXCLUDED.aggregate_version),
                       updated_at = now()
                """, caseId, analystId, event.aggregateVersion());
        reconcile(event, caseId);
    }

    private void caseStatusChanged(EventEnvelope event) {
        JsonNode payload = event.payload();
        if (!"INCELENIYOR".equals(text(payload, "to_status"))) return;
        UUID caseId = uuid(payload, "case_id");
        jdbc.update("""
                UPDATE case_facts SET review_started_at = COALESCE(review_started_at, ?),
                       aggregate_version = GREATEST(aggregate_version, ?), updated_at = now()
                 WHERE case_id = ?
                """, db(event.occurredAt()), event.aggregateVersion(), caseId);
        reconcile(event, caseId);
    }

    private void riskChanged(EventEnvelope event) {
        UUID caseId = uuid(event.payload(), "case_id");
        jdbc.update("""
                UPDATE case_facts SET risk_level = ?, aggregate_version = GREATEST(aggregate_version, ?), updated_at = now()
                 WHERE case_id = ? AND ? >= aggregate_version
                """, text(event.payload(), "effective_level"), event.aggregateVersion(), caseId, event.aggregateVersion());
        reconcile(event, caseId);
    }

    private void decisionRecorded(EventEnvelope event) {
        JsonNode payload = event.payload();
        UUID caseId = uuid(payload, "case_id");
        UUID analystId = uuid(payload, "analyst_id");
        ledger.ensureAnalyst(analystId, "Analist-" + analystId.toString().substring(0, 8));
        jdbc.update("""
                INSERT INTO case_facts
                    (case_id, analyst_id, aggregate_version, fraud_type, terminal_decision, decided_at, within_sla)
                VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT (case_id) DO UPDATE
                   SET analyst_id = EXCLUDED.analyst_id,
                       fraud_type = COALESCE(EXCLUDED.fraud_type, case_facts.fraud_type),
                       terminal_decision = EXCLUDED.terminal_decision,
                       decided_at = EXCLUDED.decided_at, within_sla = EXCLUDED.within_sla,
                       aggregate_version = GREATEST(case_facts.aggregate_version, EXCLUDED.aggregate_version),
                       updated_at = now()
                 WHERE EXCLUDED.aggregate_version >= case_facts.aggregate_version
                """, caseId, analystId, event.aggregateVersion(), text(payload, "fraud_type"),
                text(payload, "decision"), db(instant(payload, "decided_at")), bool(payload, "within_sla"));
        reconcile(event, caseId);
    }

    private void slaBreached(EventEnvelope event) {
        ledger.award(event, uuid(event.payload(), "analyst_id"), uuid(event.payload(), "case_id"),
                PointReason.SLA_BREACH, Map.of("risk_level", text(event.payload(), "risk_level")));
    }

    private void groundTruthSet(EventEnvelope event) {
        JsonNode payload = event.payload();
        UUID caseId = uuid(payload, "case_id");
        jdbc.update("""
                UPDATE case_facts SET ground_truth = ?, ground_truth_fraud_type = ?,
                       aggregate_version = GREATEST(aggregate_version, ?), updated_at = now()
                 WHERE case_id = ?
                   AND ? >= aggregate_version
                """, text(payload, "truth"), textOr(payload, "fraud_type", null),
                event.aggregateVersion(), caseId, event.aggregateVersion());
        reconcile(event, caseId);
    }

    private void feedbackSubmitted(EventEnvelope event) {
        JsonNode payload = event.payload();
        int score = integer(payload, "score");
        if (score < 1 || score > 5) throw new IllegalArgumentException("feedback score must be 1-5");
        UUID caseId = uuid(payload, "case_id");
        jdbc.update("""
                UPDATE case_facts SET feedback_score = ?,
                       aggregate_version = GREATEST(aggregate_version, ?), updated_at = now()
                 WHERE case_id = ? AND ? >= aggregate_version
                """, score, event.aggregateVersion(), caseId, event.aggregateVersion());
    }

    private void reconcile(EventEnvelope event, UUID caseId) {
        var facts = jdbc.query("""
                SELECT analyst_id, risk_level, fraud_type, terminal_decision, review_started_at,
                       decided_at, within_sla, ground_truth, ground_truth_fraud_type
                  FROM case_facts WHERE case_id = ?
                """, (rs, rowNum) -> new Facts(
                        rs.getObject("analyst_id", UUID.class), rs.getString("risk_level"), rs.getString("fraud_type"),
                        rs.getString("terminal_decision"), instant(rs, "review_started_at"),
                        instant(rs, "decided_at"), rs.getObject("within_sla", Boolean.class),
                        rs.getString("ground_truth"), rs.getString("ground_truth_fraud_type")), caseId);
        if (facts.isEmpty() || facts.getFirst().analystId() == null) return;
        Facts fact = facts.getFirst();
        Map<String, ?> metadata = Map.of("fraud_type", fact.effectiveFraudType());
        if (fact.decision() != null) {
            ledger.award(event, fact.analystId(), caseId, PointReason.TERMINAL_DECISION, metadata);
            if (fact.reviewStarted() != null && fact.decided() != null
                    && !fact.decided().isBefore(fact.reviewStarted())
                    && Duration.between(fact.reviewStarted(), fact.decided()).compareTo(Duration.ofMinutes(15)) < 0) {
                ledger.award(event, fact.analystId(), caseId, PointReason.FAST_REVIEW, metadata);
            }
            if ("KRITIK".equals(fact.risk()) && Boolean.TRUE.equals(fact.withinSla())) {
                ledger.award(event, fact.analystId(), caseId, PointReason.CRITICAL_WITHIN_SLA, metadata);
            }
        }
        if ("FRAUD".equals(fact.groundTruth())) {
            ledger.award(event, fact.analystId(), caseId, PointReason.VERIFIED_FRAUD, metadata);
        } else if ("LEGITIMATE".equals(fact.groundTruth()) && "BLOKLANDI".equals(fact.decision())) {
            ledger.award(event, fact.analystId(), caseId, PointReason.FALSE_BLOCK, metadata);
        }
    }

    private record Facts(UUID analystId, String risk, String fraudType, String decision, Instant reviewStarted,
                         Instant decided, Boolean withinSla, String groundTruth, String groundTruthFraudType) {
        String effectiveFraudType() {
            String value = groundTruthFraudType == null ? fraudType : groundTruthFraudType;
            return value == null ? "UNKNOWN" : value;
        }
    }

    private static String text(JsonNode payload, String field) {
        if (!payload.hasNonNull(field) || !payload.get(field).isTextual() || payload.get(field).asText().isBlank())
            throw new IllegalArgumentException("missing event field: " + field);
        return payload.get(field).asText();
    }

    private static String textOr(JsonNode payload, String field, String fallback) {
        return payload.hasNonNull(field) && payload.get(field).isTextual() ? payload.get(field).asText() : fallback;
    }

    private static UUID uuid(JsonNode payload, String field) { return UUID.fromString(text(payload, field)); }
    private static Instant instant(JsonNode payload, String field) { return Instant.parse(text(payload, field)); }
    private static Timestamp db(Instant value) { return value == null ? null : Timestamp.from(value); }
    private static Instant instant(ResultSet rs, String field) throws SQLException {
        Timestamp value = rs.getTimestamp(field);
        return value == null ? null : value.toInstant();
    }
    private static boolean bool(JsonNode payload, String field) {
        if (!payload.has(field) || !payload.get(field).isBoolean()) throw new IllegalArgumentException("missing event field: " + field);
        return payload.get(field).asBoolean();
    }
    private static int integer(JsonNode payload, String field) {
        if (!payload.has(field) || !payload.get(field).canConvertToInt())
            throw new IllegalArgumentException("missing event field: " + field);
        return payload.get(field).asInt();
    }

    private static boolean hasRole(JsonNode role, String expected) {
        if (role == null) return false;
        if (role.isTextual()) return expected.equals(role.asText());
        if (role.isArray()) for (JsonNode item : role) if (expected.equals(item.asText())) return true;
        return false;
    }
}
