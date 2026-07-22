package com.fraudcell.gateway.security;

import java.time.Duration;
import java.time.Instant;
import reactor.core.publisher.Mono;

public interface SecurityStateStore {
    Mono<RateLimitDecision> consume(RateLimitPolicy policy, String identifier);

    Mono<SessionDecision> validateSession(
            String userId, String jti, long tokenEpoch, Instant tokenExpiresAt);

    Mono<Void> projectSessionEpoch(String userId, long epoch, Duration retention);
}
