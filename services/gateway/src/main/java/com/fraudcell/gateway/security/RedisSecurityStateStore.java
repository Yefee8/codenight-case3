package com.fraudcell.gateway.security;

import java.time.Duration;
import java.time.Instant;
import java.util.List;
import org.springframework.data.redis.core.ReactiveStringRedisTemplate;
import org.springframework.data.redis.core.script.DefaultRedisScript;
import org.springframework.stereotype.Component;
import reactor.core.publisher.Mono;

@Component
public class RedisSecurityStateStore implements SecurityStateStore {
    private static final String PREFIX = "fraudcell:gateway:";
    private static final Duration COMMAND_TIMEOUT = Duration.ofMillis(1200);
    private static final DefaultRedisScript<Long> RATE_SCRIPT = new DefaultRedisScript<>("""
            local current = redis.call('INCR', KEYS[1])
            if current == 1 then
              redis.call('EXPIRE', KEYS[1], ARGV[1])
            end
            return current
            """, Long.class);
    private static final DefaultRedisScript<Long> SESSION_SCRIPT = new DefaultRedisScript<>("""
            if redis.call('EXISTS', KEYS[2]) == 1 then
              return -1
            end
            local supplied = tonumber(ARGV[1])
            local currentRaw = redis.call('GET', KEYS[1])
            if currentRaw then
              local current = tonumber(currentRaw)
              if supplied < current then
                return -1
              end
              if supplied > current then
                redis.call('SET', KEYS[1], supplied, 'EX', ARGV[2])
              else
                redis.call('EXPIRE', KEYS[1], ARGV[2])
              end
            else
              redis.call('SET', KEYS[1], supplied, 'EX', ARGV[2])
            end
            return 1
            """, Long.class);
    private static final DefaultRedisScript<Long> PROJECT_EPOCH_SCRIPT = new DefaultRedisScript<>("""
            local supplied = tonumber(ARGV[1])
            local currentRaw = redis.call('GET', KEYS[1])
            if (not currentRaw) or supplied > tonumber(currentRaw) then
              redis.call('SET', KEYS[1], supplied, 'EX', ARGV[2])
            else
              redis.call('EXPIRE', KEYS[1], ARGV[2])
            end
            return 1
            """, Long.class);

    private final ReactiveStringRedisTemplate redis;
    private final KeyHasher hasher;

    public RedisSecurityStateStore(ReactiveStringRedisTemplate redis, KeyHasher hasher) {
        this.redis = redis;
        this.hasher = hasher;
    }

    @Override
    public Mono<RateLimitDecision> consume(RateLimitPolicy policy, String identifier) {
        long bucket = Instant.now().getEpochSecond() / policy.window().toSeconds();
        String key = PREFIX + "rl:" + policy.dimension() + ":" + hasher.hash(identifier)
                + ":" + policy.name() + ":" + bucket;
        return redis.execute(RATE_SCRIPT, List.of(key), List.of(Long.toString(policy.window().toSeconds())))
                .next()
                .switchIfEmpty(Mono.error(new SecurityStoreUnavailableException("Redis rate sonucu boş döndü.")))
                .map(observed -> new RateLimitDecision(
                        observed <= policy.limit(), observed, policy.limit(), policy.window()))
                .timeout(COMMAND_TIMEOUT)
                .onErrorMap(error -> error instanceof SecurityStoreUnavailableException
                        ? error : new SecurityStoreUnavailableException(error));
    }

    @Override
    public Mono<SessionDecision> validateSession(
            String userId, String jti, long tokenEpoch, Instant tokenExpiresAt) {
        long retentionSeconds = Math.max(60, Duration.between(Instant.now(), tokenExpiresAt).plusSeconds(60).toSeconds());
        String epochKey = PREFIX + "session-epoch:" + hasher.hash(userId);
        String jtiKey = PREFIX + "revoked-jti:" + hasher.hash(jti);
        return redis.execute(SESSION_SCRIPT, List.of(epochKey, jtiKey),
                        List.of(Long.toString(tokenEpoch), Long.toString(retentionSeconds)))
                .next()
                .switchIfEmpty(Mono.error(new SecurityStoreUnavailableException("Redis session sonucu boş döndü.")))
                .map(result -> result == 1 ? SessionDecision.VALID : SessionDecision.REVOKED)
                .timeout(COMMAND_TIMEOUT)
                .onErrorMap(error -> error instanceof SecurityStoreUnavailableException
                        ? error : new SecurityStoreUnavailableException(error));
    }

    @Override
    public Mono<Void> projectSessionEpoch(String userId, long epoch, Duration retention) {
        if (epoch < 0 || retention.isNegative() || retention.isZero()) {
            return Mono.error(new IllegalArgumentException("Session projection alanları geçersiz."));
        }
        String key = PREFIX + "session-epoch:" + hasher.hash(userId);
        return redis.execute(PROJECT_EPOCH_SCRIPT, List.of(key),
                        List.of(Long.toString(epoch), Long.toString(retention.toSeconds())))
                .next()
                .switchIfEmpty(Mono.error(new SecurityStoreUnavailableException("Redis projection sonucu boş döndü.")))
                .timeout(COMMAND_TIMEOUT)
                .onErrorMap(error -> error instanceof SecurityStoreUnavailableException
                        ? error : new SecurityStoreUnavailableException(error))
                .then();
    }
}
