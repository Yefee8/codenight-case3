package com.fraudcell.gateway.config;

import static org.assertj.core.api.Assertions.assertThat;

import java.time.Duration;
import java.util.List;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpMethod;

class RouteConfigCorsTest {

    @Test
    void browserClientHeadersPassPreflight() {
        GatewayProperties properties = new GatewayProperties(
                "http://identity", "http://transaction", "http://ai", "http://game",
                "issuer", "audience", "http://identity/jwks", "x".repeat(32),
                List.of("http://localhost:3000"), Duration.ofMinutes(20));
        var configuration = new RouteConfig().corsConfiguration(properties);

        assertThat(configuration.checkOrigin("http://localhost:3000"))
                .isEqualTo("http://localhost:3000");
        assertThat(configuration.checkHttpMethod(HttpMethod.POST)).contains(HttpMethod.POST);
        assertThat(configuration.checkHeaders(List.of(
                "authorization", "x-request-id", "cache-control", "pragma")))
                .containsExactly("authorization", "x-request-id", "cache-control", "pragma");
    }
}
