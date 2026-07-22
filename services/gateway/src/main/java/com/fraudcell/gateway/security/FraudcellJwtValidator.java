package com.fraudcell.gateway.security;

import com.fraudcell.gateway.config.GatewayProperties;
import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.Set;
import org.springframework.security.oauth2.core.OAuth2Error;
import org.springframework.security.oauth2.core.OAuth2TokenValidator;
import org.springframework.security.oauth2.core.OAuth2TokenValidatorResult;
import org.springframework.security.oauth2.jwt.Jwt;

public final class FraudcellJwtValidator implements OAuth2TokenValidator<Jwt> {
    private static final OAuth2Error INVALID = new OAuth2Error(
            "invalid_token", "Token gerekli FraudCell claim sözleşmesini karşılamıyor.", null);
    private static final Set<String> ROLES = Set.of("CUSTOMER", "ANALYST", "SUPERVISOR", "ADMIN");

    private final String audience;
    private final Duration maximumTtl;

    public FraudcellJwtValidator(GatewayProperties properties) {
        this.audience = properties.audience();
        this.maximumTtl = properties.accessTokenMaximumTtl();
    }

    @Override
    public OAuth2TokenValidatorResult validate(Jwt jwt) {
        Instant issuedAt = jwt.getIssuedAt();
        Instant expiresAt = jwt.getExpiresAt();
        String subject = jwt.getSubject();
        String jti = jwt.getId();
        String sessionId = jwt.getClaimAsString("session_id");
        String role = jwt.getClaimAsString("role");
        Long epoch = claimAsNonNegativeLong(jwt, "session_epoch");
        List<String> audiences = jwt.getAudience();

        boolean invalid = issuedAt == null || expiresAt == null || !expiresAt.isAfter(issuedAt)
                || issuedAt.isAfter(Instant.now().plusSeconds(60))
                || Duration.between(issuedAt, expiresAt).compareTo(maximumTtl) > 0
                || subject == null || subject.isBlank()
                || jti == null || jti.isBlank()
                || sessionId == null || sessionId.isBlank()
                || role == null || !ROLES.contains(role)
                || epoch == null
                || audiences == null || !audiences.contains(audience);
        return invalid ? OAuth2TokenValidatorResult.failure(INVALID) : OAuth2TokenValidatorResult.success();
    }

    private static Long claimAsNonNegativeLong(Jwt jwt, String name) {
        Object value = jwt.getClaims().get(name);
        if (!(value instanceof Number number)) {
            return null;
        }
        long parsed = number.longValue();
        return parsed >= 0 ? parsed : null;
    }
}
