package com.fraudcell.gateway.filter;

import static org.assertj.core.api.Assertions.assertThat;

import java.nio.charset.StandardCharsets;
import org.junit.jupiter.api.Test;
import org.springframework.core.io.buffer.DataBufferUtils;
import org.springframework.http.MediaType;
import org.springframework.mock.http.server.reactive.MockServerHttpRequest;
import org.springframework.mock.web.server.MockServerWebExchange;
import reactor.core.publisher.Mono;
import reactor.test.StepVerifier;
import tools.jackson.databind.ObjectMapper;

class RequestBodyCacheTest {
    private final RequestBodyCache cache = new RequestBodyCache(new ObjectMapper());

    @Test
    void extractsNormalizedAccountAndLeavesBodyReadableDownstream() {
        String json = "{\"email\":\" Analyst@Example.COM \",\"password\":\"never-log-me\"}";
        MockServerWebExchange exchange = MockServerWebExchange.from(MockServerHttpRequest
                .post("/api/v1/auth/staff/login")
                .contentType(MediaType.APPLICATION_JSON)
                .body(json));

        RequestBodyCache.InspectedRequest inspected = cache.inspect(exchange).block();
        assertThat(inspected).isNotNull();
        assertThat(inspected.accountIdentifier()).isEqualTo("analyst@example.com");
        String replayed = DataBufferUtils.join(inspected.exchange().getRequest().getBody())
                .map(buffer -> {
                    byte[] bytes = new byte[buffer.readableByteCount()];
                    buffer.read(bytes);
                    DataBufferUtils.release(buffer);
                    return new String(bytes, StandardCharsets.UTF_8);
                }).block();
        assertThat(replayed).isEqualTo(json);
    }

    @Test
    void rejectsBodyLargerThanSixtyFourKib() {
        String body = "x".repeat(RequestBodyCache.MAX_BODY_BYTES + 1);
        MockServerWebExchange exchange = MockServerWebExchange.from(MockServerHttpRequest
                .post("/api/v1/transactions").body(body));

        StepVerifier.create(cache.inspect(exchange))
                .expectErrorMatches(error -> error instanceof RequestBodyCache.RequestBodyTooLargeException
                        || error instanceof org.springframework.core.io.buffer.DataBufferLimitException)
                .verify();
    }

    @Test
    void leavesGetRequestUntouched() {
        MockServerWebExchange exchange = MockServerWebExchange.from(
                MockServerHttpRequest.get("/api/v1/cases").build());
        StepVerifier.create(cache.inspect(exchange))
                .assertNext(inspected -> {
                    assertThat(inspected.exchange()).isSameAs(exchange);
                    assertThat(inspected.accountIdentifier()).isNull();
                })
                .verifyComplete();
    }
}
