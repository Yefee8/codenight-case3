package com.fraudcell.transaction.security;

import java.util.Locale;
import java.util.Set;
import java.util.UUID;
import org.springframework.security.core.Authentication;
import org.springframework.security.oauth2.server.resource.authentication.JwtAuthenticationToken;

public record RequestPrincipal(UUID userId, String role) {
    private static final Set<String> ROLES = Set.of("CUSTOMER", "ANALYST", "SUPERVISOR", "ADMIN");
    public static RequestPrincipal from(Authentication authentication) {
        if (!(authentication instanceof JwtAuthenticationToken jwt)) throw new IllegalArgumentException("JWT required");
        UUID id = UUID.fromString(jwt.getToken().getSubject());
        String role = jwt.getToken().getClaimAsString("role").toUpperCase(Locale.ROOT);
        if (!ROLES.contains(role)) throw new IllegalArgumentException("unsupported role");
        return new RequestPrincipal(id, role);
    }
}
