package com.fraudcell.gateway.filter;

import static org.assertj.core.api.Assertions.assertThat;

import com.fraudcell.gateway.error.GatewayErrorWriter;
import com.fraudcell.gateway.security.FraudcellJwtValidatorTest;
import com.fraudcell.gateway.security.RateLimitDecision;
import com.fraudcell.gateway.security.RateLimitPolicy;
import com.fraudcell.gateway.security.SecurityStateStore;
import com.fraudcell.gateway.security.SecurityStoreUnavailableException;
import com.fraudcell.gateway.security.SessionDecision;
import java.time.Duration;
import java.time.Instant;
import java.util.concurrent.atomic.AtomicInteger;
import org.junit.jupiter.api.Test;
import org.springframework.cloud.gateway.filter.GatewayFilterChain;
import org.springframework.http.HttpStatus;
import org.springframework.mock.http.server.reactive.MockServerHttpRequest;
import org.springframework.mock.web.server.MockServerWebExchange;
import org.springframework.security.oauth2.server.resource.authentication.JwtAuthenticationToken;
import org.springframework.web.server.ServerWebExchange;
import reactor.core.publisher.Mono;
import tools.jackson.databind.ObjectMapper;

class GatewaySecurityStateFilterTest {

    @Test
    void authenticatedRevokedSessionNeverReachesDestination() {
        FakeStore store = new FakeStore();
        store.sessionDecision = SessionDecision.REVOKED;
        GatewaySecurityStateFilter filter = filter(store);
        AtomicInteger routed = new AtomicInteger();

        ServerWebExchange exchange = authenticatedExchange("/api/v1/cases");
        filter.filter(exchange, countingChain(routed)).block();

        assertThat(routed).hasValue(0);
        assertThat(exchange.getResponse().getStatusCode()).isEqualTo(HttpStatus.UNAUTHORIZED);
        assertThat(store.sessionChecks).hasValue(1);
    }

    @Test
    void authenticatedAllowedRequestIsRoutedExactlyOnce() {
        FakeStore store = new FakeStore();
        GatewaySecurityStateFilter filter = filter(store);
        AtomicInteger routed = new AtomicInteger();

        ServerWebExchange exchange = authenticatedExchange("/api/v1/cases");
        filter.filter(exchange, countingChain(routed)).block();

        assertThat(routed).hasValue(1);
        assertThat(store.sessionChecks).hasValue(1);
        assertThat(store.rateChecks).hasValue(1);
    }

    @Test
    void rateLimitedPublicLoginDoesNotContinueAfterWriting429() {
        FakeStore store = new FakeStore();
        store.rateAllowed = false;
        GatewaySecurityStateFilter filter = filter(store);
        AtomicInteger routed = new AtomicInteger();
        MockServerWebExchange exchange = MockServerWebExchange.from(MockServerHttpRequest
                .post("/api/v1/auth/staff/login")
                .header("X-Request-ID", "00000000-0000-0000-0000-000000000099")
                .body("{\"email\":\"a@example.com\",\"password\":\"secret\"}"));

        filter.filter(exchange, countingChain(routed)).block();

        assertThat(routed).hasValue(0);
        assertThat(exchange.getResponse().getStatusCode()).isEqualTo(HttpStatus.TOO_MANY_REQUESTS);
        assertThat(exchange.getResponse().getHeaders().getFirst("Retry-After")).isNotBlank();
    }

    @Test
    void securityRedisFailureIsFailClosed() {
        FakeStore store = new FakeStore();
        store.fail = true;
        GatewaySecurityStateFilter filter = filter(store);
        AtomicInteger routed = new AtomicInteger();
        ServerWebExchange exchange = authenticatedExchange("/api/v1/cases");

        filter.filter(exchange, countingChain(routed)).block();

        assertThat(routed).hasValue(0);
        assertThat(exchange.getResponse().getStatusCode()).isEqualTo(HttpStatus.SERVICE_UNAVAILABLE);
    }

    private static GatewaySecurityStateFilter filter(FakeStore store) {
        return new GatewaySecurityStateFilter(store, new RequestBodyCache(new ObjectMapper()), new GatewayErrorWriter());
    }

    private static GatewayFilterChain countingChain(AtomicInteger calls) {
        return exchange -> {
            calls.incrementAndGet();
            return Mono.empty();
        };
    }

    private static ServerWebExchange authenticatedExchange(String path) {
        MockServerWebExchange exchange = MockServerWebExchange.from(MockServerHttpRequest
                .get(path)
                .header("X-Request-ID", "00000000-0000-0000-0000-000000000099")
                .build());
        JwtAuthenticationToken authentication = new JwtAuthenticationToken(FraudcellJwtValidatorTest.token(builder -> {}));
        return exchange.mutate().principal(Mono.just(authentication)).build();
    }

    private static final class FakeStore implements SecurityStateStore {
        private final AtomicInteger sessionChecks = new AtomicInteger();
        private final AtomicInteger rateChecks = new AtomicInteger();
        private SessionDecision sessionDecision = SessionDecision.VALID;
        private boolean rateAllowed = true;
        private boolean fail;

        @Override
        public Mono<RateLimitDecision> consume(RateLimitPolicy policy, String identifier) {
            rateChecks.incrementAndGet();
            return fail
                    ? Mono.error(new SecurityStoreUnavailableException("offline"))
                    : Mono.just(new RateLimitDecision(rateAllowed, rateAllowed ? 1 : policy.limit() + 1L,
                            policy.limit(), policy.window()));
        }

        @Override
        public Mono<SessionDecision> validateSession(String userId, String jti, long tokenEpoch, Instant tokenExpiresAt) {
            sessionChecks.incrementAndGet();
            return fail
                    ? Mono.error(new SecurityStoreUnavailableException("offline"))
                    : Mono.just(sessionDecision);
        }

        @Override
        public Mono<Void> projectSessionEpoch(String userId, long epoch, Duration retention) {
            return Mono.empty();
        }
    }
}
