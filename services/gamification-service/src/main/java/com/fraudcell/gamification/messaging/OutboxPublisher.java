package com.fraudcell.gamification.messaging;

import tools.jackson.databind.json.JsonMapper;
import tools.jackson.databind.node.ObjectNode;
import com.fraudcell.gamification.security.RlsContext;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.util.List;
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

@Component
public class OutboxPublisher {
    private static final Logger LOG = LoggerFactory.getLogger(OutboxPublisher.class);
    private static final List<String> DELAYS = List.of("5 seconds", "30 seconds", "2 minutes", "10 minutes", "30 minutes");
    private final JdbcTemplate jdbc;
    private final JsonMapper objectMapper;
    private final RabbitTemplate rabbit;
    private final RlsContext rls;

    public OutboxPublisher(JdbcTemplate jdbc, JsonMapper objectMapper, RabbitTemplate rabbit, RlsContext rls) {
        this.jdbc = jdbc;
        this.objectMapper = objectMapper;
        this.rabbit = rabbit;
        this.rls = rls;
    }

    @Scheduled(fixedDelayString = "${fraudcell.outbox.poll-ms:1000}")
    @Transactional
    public void publishBatch() {
        rls.applyService();
        var events = jdbc.query("""
                SELECT event_id, event_type, event_version, aggregate_id, aggregate_version,
                       correlation_id, causation_id, payload::text, occurred_at, attempt_count
                  FROM outbox_events
                 WHERE published_at IS NULL AND next_attempt_at <= now()
                 ORDER BY occurred_at FOR UPDATE SKIP LOCKED LIMIT 50
                """, (rs, rowNum) -> new PendingEvent(
                        rs.getObject("event_id", UUID.class), rs.getString("event_type"), rs.getInt("event_version"),
                        rs.getObject("aggregate_id", UUID.class), rs.getLong("aggregate_version"),
                        rs.getObject("correlation_id", UUID.class), rs.getObject("causation_id", UUID.class),
                        rs.getString("payload"), rs.getTimestamp("occurred_at").toInstant(), rs.getInt("attempt_count")));
        for (var event : events) {
            try {
                publish(event);
                jdbc.update("UPDATE outbox_events SET published_at = now() WHERE event_id = ?", event.id());
            } catch (Exception failure) {
                String delay = DELAYS.get(Math.min(event.attempts(), DELAYS.size() - 1));
                jdbc.update("""
                        UPDATE outbox_events SET attempt_count = attempt_count + 1,
                               next_attempt_at = now() + CAST(? AS interval)
                         WHERE event_id = ?
                        """, delay, event.id());
                LOG.warn("outbox publish deferred; event_id={} type={}", event.id(), event.type());
            }
        }
    }

    private void publish(PendingEvent event) throws Exception {
        ObjectNode envelope = objectMapper.createObjectNode();
        envelope.put("event_id", event.id().toString());
        envelope.put("event_type", event.type());
        envelope.put("event_version", event.version());
        envelope.put("producer", "gamification-service");
        envelope.put("occurred_at", event.occurredAt().toString());
        envelope.put("aggregate_id", event.aggregateId().toString());
        envelope.put("aggregate_version", event.aggregateVersion());
        envelope.put("correlation_id", event.correlationId().toString());
        if (event.causationId() == null) envelope.putNull("causation_id");
        else envelope.put("causation_id", event.causationId().toString());
        envelope.set("payload", objectMapper.readTree(event.payload()));
        byte[] bytes = objectMapper.writeValueAsString(envelope).getBytes(StandardCharsets.UTF_8);
        var message = MessageBuilder.withBody(bytes)
                .setContentType("application/json")
                .setMessageId(event.id().toString())
                .setDeliveryMode(MessageDeliveryMode.PERSISTENT)
                .build();
        var correlation = new CorrelationData(event.id().toString());
        rabbit.send("fraudcell.events.v1", event.type(), message, correlation);
        var confirmation = correlation.getFuture().get(5, TimeUnit.SECONDS);
        if (!confirmation.isAck() || correlation.getReturned() != null) {
            throw new IllegalStateException("broker did not confirm mandatory publish");
        }
    }

    private record PendingEvent(UUID id, String type, int version, UUID aggregateId, long aggregateVersion,
                                UUID correlationId, UUID causationId, String payload, Instant occurredAt, int attempts) {}
}
