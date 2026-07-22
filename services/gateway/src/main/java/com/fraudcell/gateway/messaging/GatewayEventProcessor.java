package com.fraudcell.gateway.messaging;

import com.fraudcell.gateway.config.GatewayProperties;
import com.fraudcell.gateway.security.SecurityStateStore;
import java.time.Duration;
import java.time.Instant;
import java.util.Set;
import java.util.UUID;
import org.springframework.stereotype.Component;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;

@Component
public class GatewayEventProcessor {
    private static final Set<String> SUPPORTED = Set.of("sessions.revoked", "role.changed");
    private final ObjectMapper objectMapper;
    private final SecurityStateStore stateStore;
    private final Duration projectionRetention;

    public GatewayEventProcessor(
            ObjectMapper objectMapper,
            SecurityStateStore stateStore,
            GatewayProperties properties) {
        this.objectMapper = objectMapper;
        this.stateStore = stateStore;
        this.projectionRetention = properties.accessTokenMaximumTtl().plusMinutes(5);
    }

    public void process(byte[] body) {
        Projection projection = parse(body);
        stateStore.projectSessionEpoch(projection.userId(), projection.epoch(), projectionRetention)
                .block(Duration.ofSeconds(2));
    }

    private Projection parse(byte[] body) {
        try {
            JsonNode envelope = objectMapper.readTree(body);
            if (envelope == null || !envelope.isObject()) {
                throw invalid("event envelope object olmalıdır");
            }
            UUID eventId = uuid(envelope, "event_id");
            String type = text(envelope, "event_type");
            if (!SUPPORTED.contains(type)) {
                throw invalid("gateway için desteklenmeyen event_type");
            }
            if (integer(envelope, "event_version") != 1L
                    || !"identity-service".equals(text(envelope, "producer"))) {
                throw invalid("event version/producer geçersiz");
            }
            Instant.parse(text(envelope, "occurred_at"));
            UUID aggregateId = uuid(envelope, "aggregate_id");
            if (integer(envelope, "aggregate_version") < 0) {
                throw invalid("aggregate_version negatif olamaz");
            }
            uuid(envelope, "correlation_id");
            JsonNode causation = envelope.get("causation_id");
            if (causation != null && !causation.isNull()) {
                UUID.fromString(causation.asString());
            }
            JsonNode payload = envelope.get("payload");
            if (payload == null || !payload.isObject()) {
                throw invalid("payload object olmalıdır");
            }
            UUID userId = UUID.fromString(text(payload, "user_id"));
            if (!aggregateId.equals(userId)) {
                throw invalid("payload user_id aggregate_id ile uyuşmuyor");
            }
            long epoch = integer(payload, "session_epoch");
            if (epoch < 0) {
                throw invalid("session_epoch negatif olamaz");
            }
            if (type.equals("sessions.revoked") && text(payload, "reason").isBlank()) {
                throw invalid("revoke reason zorunludur");
            }
            if (type.equals("role.changed")) {
                JsonNode roles = payload.get("roles");
                if (roles == null || !roles.isArray()) {
                    throw invalid("roles array zorunludur");
                }
            }
            return new Projection(eventId, userId.toString(), epoch);
        } catch (InvalidGatewayEventException exception) {
            throw exception;
        } catch (RuntimeException exception) {
            throw new InvalidGatewayEventException("Event envelope ayrıştırılamadı.", exception);
        }
    }

    private static String text(JsonNode node, String field) {
        JsonNode value = node.get(field);
        if (value == null || !value.isString() || value.asString().isBlank()) {
            throw invalid(field + " zorunlu string olmalıdır");
        }
        return value.asString();
    }

    private static long integer(JsonNode node, String field) {
        JsonNode value = node.get(field);
        if (value == null || !value.isIntegralNumber()) {
            throw invalid(field + " zorunlu integer olmalıdır");
        }
        return value.longValue();
    }

    private static UUID uuid(JsonNode node, String field) {
        return UUID.fromString(text(node, field));
    }

    private static InvalidGatewayEventException invalid(String message) {
        return new InvalidGatewayEventException(message);
    }

    private record Projection(UUID eventId, String userId, long epoch) {
    }
}
