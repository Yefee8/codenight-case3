package com.fraudcell.identity.messaging;

import com.fraudcell.identity.persistence.IdentityRepository;
import com.fraudcell.identity.persistence.RlsExecutor;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.concurrent.TimeUnit;
import org.springframework.amqp.rabbit.connection.CorrelationData;
import org.springframework.amqp.rabbit.core.RabbitTemplate;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;
import tools.jackson.databind.ObjectMapper;

@Component
public class OutboxPublisher {
    private static final String EXCHANGE = "fraudcell.events.v1";
    private final IdentityRepository repository;
    private final RlsExecutor rls;
    private final RabbitTemplate rabbit;
    private final ObjectMapper mapper;

    public OutboxPublisher(IdentityRepository repository, RlsExecutor rls,
                           RabbitTemplate rabbit, ObjectMapper mapper) {
        this.repository = repository;
        this.rls = rls;
        this.rabbit = rabbit;
        this.mapper = mapper;
        this.rabbit.setMandatory(true);
    }

    @Scheduled(initialDelay = 1000, fixedDelay = 1000)
    public void publish() {
        rls.system(() -> repository.lockOutbox(50).forEach(row -> {
            try {
                Map<String, Object> envelope = new LinkedHashMap<>();
                envelope.put("event_id", row.eventId().toString());
                envelope.put("event_type", row.eventType());
                envelope.put("event_version", 1);
                envelope.put("producer", "identity-service");
                envelope.put("occurred_at", row.occurredAt().toString());
                envelope.put("aggregate_id", row.aggregateId().toString());
                envelope.put("aggregate_version", row.aggregateVersion());
                envelope.put("correlation_id", row.correlationId().toString());
                envelope.put("causation_id", row.causationId() == null ? null : row.causationId().toString());
                envelope.put("payload", mapper.readValue(row.payload(), Map.class));
                CorrelationData confirmation = new CorrelationData(row.eventId().toString());
                byte[] body = mapper.writeValueAsBytes(envelope);
                rabbit.convertAndSend(EXCHANGE, row.eventType(), body, message -> {
                    message.getMessageProperties().setContentType("application/json");
                    message.getMessageProperties().setMessageId(row.eventId().toString());
                    message.getMessageProperties().setDeliveryMode(org.springframework.amqp.core.MessageDeliveryMode.PERSISTENT);
                    return message;
                }, confirmation);
                CorrelationData.Confirm result = confirmation.getFuture().get(5, TimeUnit.SECONDS);
                if (!result.ack()) throw new IllegalStateException("RabbitMQ nack: " + result.reason());
                repository.markPublished(row.eventId());
            } catch (Exception exception) {
                repository.markPublishFailure(row.eventId(), exception.getMessage());
            }
        }));
    }
}
