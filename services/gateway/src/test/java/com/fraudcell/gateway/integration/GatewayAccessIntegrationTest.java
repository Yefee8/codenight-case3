package com.fraudcell.gateway.integration;

import static org.assertj.core.api.Assertions.assertThat;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.context.ApplicationContext;
import org.springframework.test.web.reactive.server.WebTestClient;

@SpringBootTest(
        webEnvironment = SpringBootTest.WebEnvironment.MOCK,
        properties = {
            "spring.rabbitmq.listener.simple.auto-startup=false",
            "management.health.redis.enabled=false",
            "management.health.rabbit.enabled=false"
        })
class GatewayAccessIntegrationTest {
    @Autowired
    private ApplicationContext context;
    private WebTestClient client;

    @BeforeEach
    void bindClient() {
        client = WebTestClient.bindToApplicationContext(context).configureClient().build();
    }

    @Test
    void internalAiRouteIsNotPublishedEvenWithoutAuthentication() {
        client.post().uri("/internal/v1/score")
                .header("X-Request-ID", "not-trusted")
                .exchange()
                .expectStatus().isNotFound()
                .expectHeader().value("X-Request-ID", value ->
                        assertThat(value).matches("[0-9a-f-]{36}"));
    }

    @Test
    void protectedApiReturnsCanonicalUnauthorizedEnvelope() {
        client.get().uri("/api/v1/cases")
                .exchange()
                .expectStatus().isUnauthorized()
                .expectHeader().valueEquals("Cache-Control", "no-store")
                .expectBody()
                .jsonPath("$.success").isEqualTo(false)
                .jsonPath("$.error.code").isEqualTo("AUTHENTICATION_REQUIRED")
                .jsonPath("$.request_id").value(value ->
                        assertThat(String.valueOf(value)).matches("[0-9a-f-]{36}"));
    }

    @Test
    void preflightUsesExplicitOriginAllowlist() {
        client.options().uri("/api/v1/auth/staff/login")
                .header("Origin", "https://evil.example")
                .header("Access-Control-Request-Method", "POST")
                .exchange()
                .expectStatus().isForbidden()
                .expectHeader().doesNotExist("Access-Control-Allow-Origin");
    }
}
