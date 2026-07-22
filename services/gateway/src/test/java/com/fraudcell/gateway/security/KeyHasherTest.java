package com.fraudcell.gateway.security;

import static org.assertj.core.api.Assertions.assertThat;

import com.fraudcell.gateway.config.GatewayProperties;
import java.time.Duration;
import java.util.List;
import org.junit.jupiter.api.Test;

public class KeyHasherTest {
    private final KeyHasher hasher = new KeyHasher(properties());

    @Test
    void createsStableOpaqueHmacWithoutLeakingIdentifier() {
        String first = hasher.hash("analyst@example.com");
        String second = hasher.hash("analyst@example.com");

        assertThat(first).isEqualTo(second).hasSize(64).matches("[0-9a-f]{64}");
        assertThat(first).doesNotContain("analyst", "example.com");
        assertThat(hasher.hash("other@example.com")).isNotEqualTo(first);
    }

    public static GatewayProperties properties() {
        return new GatewayProperties(
                "http://identity", "http://transaction", "http://ai", "http://game",
                "https://issuer", "fraudcell-api", "http://identity/jwks",
                "01234567890123456789012345678901", List.of("http://localhost:3000"), Duration.ofMinutes(20));
    }
}
