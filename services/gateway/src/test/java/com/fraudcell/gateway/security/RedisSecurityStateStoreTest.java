package com.fraudcell.gateway.security;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyList;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

import java.time.Duration;
import java.time.Instant;
import org.junit.jupiter.api.Test;
import org.springframework.data.redis.core.ReactiveStringRedisTemplate;
import reactor.core.publisher.Flux;
import reactor.test.StepVerifier;

class RedisSecurityStateStoreTest {
    private final ReactiveStringRedisTemplate redis = mock(ReactiveStringRedisTemplate.class);
    private final RedisSecurityStateStore store = new RedisSecurityStateStore(redis, new KeyHasher(KeyHasherTest.properties()));

    @Test
    void mapsAtomicRateCounterToDecision() {
        when(redis.execute(any(), anyList(), anyList())).thenReturn(Flux.just(3L));

        StepVerifier.create(store.consume(new RateLimitPolicy("login", "account", 3, Duration.ofMinutes(5)), "pii"))
                .assertNext(decision -> {
                    assertThat(decision.allowed()).isTrue();
                    assertThat(decision.observed()).isEqualTo(3L);
                })
                .verifyComplete();
    }

    @Test
    void rejectsRevokedSessionAndFailsClosedOnRedisError() {
        when(redis.execute(any(), anyList(), anyList())).thenReturn(Flux.just(-1L));
        StepVerifier.create(store.validateSession("user", "jti", 0, Instant.now().plusSeconds(900)))
                .expectNext(SessionDecision.REVOKED)
                .verifyComplete();

        when(redis.execute(any(), anyList(), anyList())).thenReturn(Flux.error(new IllegalStateException("offline")));
        StepVerifier.create(store.validateSession("user", "jti", 0, Instant.now().plusSeconds(900)))
                .expectError(SecurityStoreUnavailableException.class)
                .verify();
    }
}
