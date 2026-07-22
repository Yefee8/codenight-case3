package com.fraudcell.gamification.messaging;

import com.fasterxml.jackson.annotation.JsonProperty;
import tools.jackson.databind.JsonNode;
import java.time.Instant;
import java.util.UUID;

public record EventEnvelope(
        @JsonProperty("event_id") UUID eventId,
        @JsonProperty("event_type") String eventType,
        @JsonProperty("event_version") int eventVersion,
        String producer,
        @JsonProperty("occurred_at") Instant occurredAt,
        @JsonProperty("aggregate_id") UUID aggregateId,
        @JsonProperty("aggregate_version") long aggregateVersion,
        @JsonProperty("correlation_id") UUID correlationId,
        @JsonProperty("causation_id") UUID causationId,
        JsonNode payload) {

    public EventEnvelope {
        if (eventId == null || eventType == null || eventType.isBlank() || eventVersion != 1
                || producer == null || occurredAt == null || aggregateId == null
                || aggregateVersion < 0 || correlationId == null || payload == null || !payload.isObject()) {
            throw new IllegalArgumentException("invalid event envelope");
        }
    }
}
