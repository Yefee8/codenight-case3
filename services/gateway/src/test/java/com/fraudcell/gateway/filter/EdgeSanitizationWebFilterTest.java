package com.fraudcell.gateway.filter;

import static org.assertj.core.api.Assertions.assertThat;

import com.fraudcell.gateway.error.GatewayErrorWriter;
import com.fraudcell.gateway.security.KeyHasherTest;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicReference;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpStatus;
import org.springframework.mock.http.server.reactive.MockServerHttpRequest;
import org.springframework.mock.web.server.MockServerWebExchange;
import org.springframework.web.server.ServerWebExchange;
import reactor.core.publisher.Mono;

class EdgeSanitizationWebFilterTest {
    private final EdgeSanitizationWebFilter filter =
            new EdgeSanitizationWebFilter(KeyHasherTest.properties(), new GatewayErrorWriter());

    @Test
    void removesSpoofableHeadersAndReplacesInvalidRequestId() {
        MockServerWebExchange exchange = MockServerWebExchange.from(MockServerHttpRequest
                .get("/api/v1/cases")
                .header("X-Request-ID", "not-a-uuid")
                .header("X-User-Id", "admin")
                .header("X-Actor-Role", "ADMIN")
                .header("X-Forwarded-For", "203.0.113.5")
                .header("Forwarded", "for=203.0.113.5")
                .build());
        AtomicReference<ServerWebExchange> forwarded = new AtomicReference<>();

        filter.filter(exchange, sanitized -> {
            forwarded.set(sanitized);
            return Mono.empty();
        }).block();

        var headers = forwarded.get().getRequest().getHeaders();
        assertThat(headers.getFirst("X-User-Id")).isNull();
        assertThat(headers.getFirst("X-Actor-Role")).isNull();
        assertThat(headers.getFirst("X-Forwarded-For")).isNull();
        assertThat(headers.getFirst("Forwarded")).isNull();
        assertThatCodeIsUuid(headers.getFirst("X-Request-ID"));
        assertThat(exchange.getResponse().getHeaders().getCacheControl()).isEqualTo("no-store");
        assertThat(exchange.getResponse().getHeaders().getFirst("X-Frame-Options")).isEqualTo("DENY");
    }

    @Test
    void rejectsCrossSiteRefreshBeforeRouting() {
        MockServerWebExchange exchange = MockServerWebExchange.from(MockServerHttpRequest
                .post("/api/v1/auth/refresh")
                .header("Origin", "https://evil.example")
                .header("Sec-Fetch-Site", "cross-site")
                .build());
        AtomicInteger calls = new AtomicInteger();

        filter.filter(exchange, ignored -> {
            calls.incrementAndGet();
            return Mono.empty();
        }).block();

        assertThat(calls).hasValue(0);
        assertThat(exchange.getResponse().getStatusCode()).isEqualTo(HttpStatus.FORBIDDEN);
    }

    private static void assertThatCodeIsUuid(String value) {
        assertThat(value).isNotBlank();
        assertThat(java.util.UUID.fromString(value).toString()).isEqualTo(value);
    }
}
