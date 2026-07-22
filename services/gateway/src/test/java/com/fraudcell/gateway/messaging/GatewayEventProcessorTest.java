package com.fraudcell.gateway.messaging;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.fraudcell.gateway.security.KeyHasherTest;
import com.fraudcell.gateway.security.RateLimitDecision;
import com.fraudcell.gateway.security.RateLimitPolicy;
import com.fraudcell.gateway.security.SecurityStateStore;
import com.fraudcell.gateway.security.SessionDecision;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.time.Instant;
import org.junit.jupiter.api.Test;
import reactor.core.publisher.Mono;
import tools.jackson.databind.ObjectMapper;

class GatewayEventProcessorTest {
    private static final String USER_ID = "00000000-0000-0000-0000-000000000011";
    private final RecordingStore store = new RecordingStore();
    private final GatewayEventProcessor processor =
            new GatewayEventProcessor(new ObjectMapper(), store, KeyHasherTest.properties());

    @Test
    void projectsValidatedRevocationEpoch() {
        processor.process(event("sessions.revoked", USER_ID,
                "{\"user_id\":\"" + USER_ID + "\",\"session_epoch\":4,\"reason\":\"logout-all\"}"));

        assertThat(store.userId).isEqualTo(USER_ID);
        assertThat(store.epoch).isEqualTo(4L);
        assertThat(store.retention).isEqualTo(Duration.ofMinutes(25));
    }

    @Test
    void projectsRoleChangeAndRejectsAggregateSpoofing() {
        processor.process(event("role.changed", USER_ID,
                "{\"user_id\":\"" + USER_ID + "\",\"session_epoch\":5,\"roles\":[\"ANALYST\"]}"));
        assertThat(store.epoch).isEqualTo(5L);

        byte[] spoofed = event("sessions.revoked", "00000000-0000-0000-0000-000000000012",
                "{\"user_id\":\"" + USER_ID + "\",\"session_epoch\":6,\"reason\":\"role-change\"}");
        assertThatThrownBy(() -> processor.process(spoofed))
                .isInstanceOf(InvalidGatewayEventException.class);
        assertThat(store.epoch).isEqualTo(5L);
    }

    @Test
    void rejectsWrongProducerUnsupportedTypeAndNegativeEpoch() {
        String wrongProducer = new String(event("sessions.revoked", USER_ID,
                "{\"user_id\":\"" + USER_ID + "\",\"session_epoch\":1,\"reason\":\"x\"}"),
                StandardCharsets.UTF_8).replace("identity-service", "transaction-service");
        assertThatThrownBy(() -> processor.process(wrongProducer.getBytes(StandardCharsets.UTF_8)))
                .isInstanceOf(InvalidGatewayEventException.class);
        assertThatThrownBy(() -> processor.process(event("case.closed", USER_ID, "{}")))
                .isInstanceOf(InvalidGatewayEventException.class);
        assertThatThrownBy(() -> processor.process(event("sessions.revoked", USER_ID,
                "{\"user_id\":\"" + USER_ID + "\",\"session_epoch\":-1,\"reason\":\"x\"}")))
                .isInstanceOf(InvalidGatewayEventException.class);
    }

    private static byte[] event(String type, String aggregateId, String payload) {
        String json = """
                {"event_id":"00000000-0000-0000-0000-000000000001",
                 "event_type":"%s","event_version":1,"producer":"identity-service",
                 "occurred_at":"2026-07-22T12:00:00Z","aggregate_id":"%s","aggregate_version":3,
                 "correlation_id":"00000000-0000-0000-0000-000000000002","causation_id":null,
                 "payload":%s}
                """.formatted(type, aggregateId, payload);
        return json.getBytes(StandardCharsets.UTF_8);
    }

    private static final class RecordingStore implements SecurityStateStore {
        private String userId;
        private long epoch = -1;
        private Duration retention;

        @Override
        public Mono<RateLimitDecision> consume(RateLimitPolicy policy, String identifier) {
            throw new UnsupportedOperationException();
        }

        @Override
        public Mono<SessionDecision> validateSession(String userId, String jti, long tokenEpoch, Instant tokenExpiresAt) {
            throw new UnsupportedOperationException();
        }

        @Override
        public Mono<Void> projectSessionEpoch(String userId, long epoch, Duration retention) {
            this.userId = userId;
            this.epoch = epoch;
            this.retention = retention;
            return Mono.empty();
        }
    }
}
