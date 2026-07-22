package com.fraudcell.transaction.messaging;

import com.fraudcell.transaction.security.RlsContext;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.util.List;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.TimeUnit;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.amqp.core.MessageBuilder;
import org.springframework.amqp.core.MessageDeliveryMode;
import org.springframework.amqp.rabbit.connection.CorrelationData;
import org.springframework.amqp.rabbit.core.RabbitTemplate;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;
import tools.jackson.databind.json.JsonMapper;

@Component
public class EventOutbox {
    private static final Logger LOG = LoggerFactory.getLogger(EventOutbox.class);
    private static final List<String> DELAYS = List.of("5 seconds","30 seconds","2 minutes","10 minutes","30 minutes");
    private final JdbcTemplate jdbc;
    private final JsonMapper json;
    private final RabbitTemplate rabbit;
    private final RlsContext rls;

    public EventOutbox(JdbcTemplate jdbc, JsonMapper json, RabbitTemplate rabbit, RlsContext rls) {
        this.jdbc = jdbc; this.json = json; this.rabbit = rabbit; this.rls = rls;
        rabbit.setMandatory(true);
    }

    public UUID enqueue(String type, UUID aggregateId, long version, UUID correlationId,
                        UUID causationId, Map<String, ?> payload) {
        UUID eventId = UUID.randomUUID();
        try {
            jdbc.update("""
                    INSERT INTO outbox_events(event_id,event_type,aggregate_id,aggregate_version,
                      correlation_id,causation_id,payload) VALUES (?,?,?,?,?,?,CAST(? AS jsonb))
                    """, eventId, type, aggregateId, version, correlationId, causationId,
                    json.writeValueAsString(payload));
            return eventId;
        } catch (Exception error) { throw new IllegalStateException("event serialization failed", error); }
    }

    @Scheduled(fixedDelayString = "${fraudcell.outbox.poll-ms:1000}")
    @Transactional
    public void publish() {
        rls.service();
        var rows = jdbc.query("""
                SELECT event_id,event_type,event_version,aggregate_id,aggregate_version,
                       correlation_id,causation_id,payload::text,occurred_at,attempt_count
                  FROM outbox_events WHERE published_at IS NULL AND failed_at IS NULL
                   AND next_attempt_at <= now() ORDER BY occurred_at
                 FOR UPDATE SKIP LOCKED LIMIT 50
                """, (rs, row) -> new Pending(
                rs.getObject(1,UUID.class),rs.getString(2),rs.getInt(3),rs.getObject(4,UUID.class),
                rs.getLong(5),rs.getObject(6,UUID.class),rs.getObject(7,UUID.class),rs.getString(8),
                rs.getObject(9,OffsetDateTime.class).toInstant(),rs.getInt(10)));
        for (Pending value : rows) {
            try {
                Map<String,Object> envelopeValues = new LinkedHashMap<>();
                envelopeValues.put("event_id", value.id());
                envelopeValues.put("event_type", value.type());
                envelopeValues.put("event_version", value.eventVersion());
                envelopeValues.put("producer", "transaction-service");
                envelopeValues.put("occurred_at", value.occurredAt());
                envelopeValues.put("aggregate_id", value.aggregateId());
                envelopeValues.put("aggregate_version", value.aggregateVersion());
                envelopeValues.put("correlation_id", value.correlationId());
                envelopeValues.put("causation_id", value.causationId());
                envelopeValues.put("payload", json.readTree(value.payload()));
                String envelope = json.writeValueAsString(envelopeValues);
                var message = MessageBuilder.withBody(envelope.getBytes(StandardCharsets.UTF_8))
                        .setContentType("application/json").setMessageId(value.id().toString())
                        .setDeliveryMode(MessageDeliveryMode.PERSISTENT).build();
                var correlation = new CorrelationData(value.id().toString());
                rabbit.send("fraudcell.events.v1", value.type(), message, correlation);
                var confirmation = correlation.getFuture().get(5, TimeUnit.SECONDS);
                if (!confirmation.isAck() || correlation.getReturned() != null)
                    throw new IllegalStateException("publish not confirmed");
                jdbc.update("UPDATE outbox_events SET published_at=now() WHERE event_id=?", value.id());
            } catch (Exception error) {
                int attempt = value.attempts() + 1;
                if (attempt > DELAYS.size()) jdbc.update(
                        "UPDATE outbox_events SET attempt_count=?,failed_at=now(),failure_code=? WHERE event_id=?",
                        attempt, error.getClass().getSimpleName(), value.id());
                else jdbc.update("UPDATE outbox_events SET attempt_count=?,next_attempt_at=now()+CAST(? AS interval),failure_code=? WHERE event_id=?",
                        attempt, DELAYS.get(attempt-1), error.getClass().getSimpleName(), value.id());
                LOG.warn("transaction outbox publish deferred; event_id={}", value.id());
                break;
            }
        }
    }

    private record Pending(UUID id,String type,int eventVersion,UUID aggregateId,long aggregateVersion,
                           UUID correlationId,UUID causationId,String payload,Instant occurredAt,int attempts) {}
}
