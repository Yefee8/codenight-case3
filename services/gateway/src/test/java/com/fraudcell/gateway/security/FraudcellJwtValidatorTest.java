package com.fraudcell.gateway.security;

import static org.assertj.core.api.Assertions.assertThat;

import java.time.Instant;
import java.util.List;
import java.util.function.Consumer;
import org.junit.jupiter.api.Test;
import org.springframework.security.oauth2.jwt.Jwt;

public class FraudcellJwtValidatorTest {
    private final FraudcellJwtValidator validator = new FraudcellJwtValidator(KeyHasherTest.properties());

    @Test
    void acceptsCompleteRs256ClaimContract() {
        assertThat(validator.validate(token(builder -> {})).getErrors()).isEmpty();
    }

    @Test
    void rejectsWrongAudienceMissingSessionAndOversizedTtl() {
        assertThat(validator.validate(token(builder -> builder.audience(List.of("wrong-api")))).getErrors()).isNotEmpty();
        assertThat(validator.validate(token(builder -> builder.claim("session_id", ""))).getErrors()).isNotEmpty();
        assertThat(validator.validate(token(builder -> builder.expiresAt(Instant.now().plusSeconds(3600)))).getErrors())
                .isNotEmpty();
    }

    @Test
    void rejectsUnknownRoleNegativeEpochAndStringEpoch() {
        assertThat(validator.validate(token(builder -> builder.claim("role", "ROOT"))).getErrors()).isNotEmpty();
        assertThat(validator.validate(token(builder -> builder.claim("session_epoch", -1L))).getErrors()).isNotEmpty();
        assertThat(validator.validate(token(builder -> builder.claim("session_epoch", "0"))).getErrors()).isNotEmpty();
    }

    public static Jwt token(Consumer<Jwt.Builder> mutation) {
        Instant now = Instant.now();
        Jwt.Builder builder = Jwt.withTokenValue("signed-token")
                .header("alg", "RS256")
                .header("kid", "test-key")
                .issuer("https://issuer")
                .subject("00000000-0000-0000-0000-000000000001")
                .audience(List.of("fraudcell-api"))
                .issuedAt(now)
                .expiresAt(now.plusSeconds(900))
                .jti("jti-1")
                .claim("role", "CUSTOMER")
                .claim("session_id", "session-1")
                .claim("session_epoch", 0L)
                .claim("specialties", java.util.List.of())
                .claim("regions", java.util.List.of());
        mutation.accept(builder);
        return builder.build();
    }
}
