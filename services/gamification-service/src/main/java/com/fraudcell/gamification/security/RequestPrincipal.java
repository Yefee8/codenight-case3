package com.fraudcell.gamification.security;

import java.util.Locale;
import java.util.UUID;
import org.springframework.security.core.Authentication;
import org.springframework.security.oauth2.server.resource.authentication.JwtAuthenticationToken;

public record RequestPrincipal(UUID userId, String role) {
    private static final java.util.Set<String> ALLOWED =
            java.util.Set.of("ANALYST", "SUPERVISOR", "ADMIN");

    public static RequestPrincipal from(Authentication authentication) {
        if (!(authentication instanceof JwtAuthenticationToken jwt)) {
            throw new IllegalArgumentException("JWT principal is required");
        }
        UUID userId = UUID.fromString(jwt.getToken().getSubject());
        String role = jwt.getToken().getClaimAsString("role").toUpperCase(Locale.ROOT);
        if (!ALLOWED.contains(role)) {
            throw new IllegalArgumentException("unsupported role");
        }
        return new RequestPrincipal(userId, role);
    }
}
