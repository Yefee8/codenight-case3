package com.fraudcell.identity.security;

import com.fraudcell.identity.api.ApiSupport;
import com.fraudcell.identity.application.AuditService;
import com.fraudcell.identity.persistence.RlsExecutor;
import jakarta.servlet.http.HttpServletRequest;
import java.util.Map;
import java.util.UUID;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.http.MediaType;
import org.springframework.security.config.Customizer;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.config.http.SessionCreationPolicy;
import org.springframework.security.core.Authentication;
import org.springframework.security.crypto.argon2.Argon2PasswordEncoder;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.security.oauth2.server.resource.authentication.JwtAuthenticationConverter;
import org.springframework.security.oauth2.server.resource.authentication.JwtGrantedAuthoritiesConverter;
import org.springframework.security.web.SecurityFilterChain;
import tools.jackson.databind.ObjectMapper;

@Configuration
public class SecurityConfig {
    @Bean
    PasswordEncoder passwordEncoder() {
        return new Argon2PasswordEncoder(16, 32, 1, 19 * 1024, 2);
    }

    @Bean
    SecurityFilterChain securityFilterChain(HttpSecurity http, ObjectMapper mapper,
                                            RlsExecutor rls, AuditService audit) throws Exception {
        JwtGrantedAuthoritiesConverter authorities = new JwtGrantedAuthoritiesConverter();
        authorities.setAuthoritiesClaimName("role");
        authorities.setAuthorityPrefix("ROLE_");
        JwtAuthenticationConverter converter = new JwtAuthenticationConverter();
        converter.setJwtGrantedAuthoritiesConverter(authorities);

        http.csrf(csrf -> csrf.disable())
                .sessionManagement(session -> session.sessionCreationPolicy(SessionCreationPolicy.STATELESS))
                .authorizeHttpRequests(auth -> auth
                        .requestMatchers("/.well-known/jwks.json", "/api/v1/auth/**", "/actuator/health/**").permitAll()
                        .requestMatchers("/api/v1/admin/**").hasRole("ADMIN")
                        .requestMatchers("/api/v1/staff/**").hasAnyRole("SUPERVISOR", "ADMIN")
                        .requestMatchers("/api/v1/users/**").authenticated()
                        .anyRequest().denyAll())
                .oauth2ResourceServer(oauth -> oauth.jwt(jwt -> jwt.jwtAuthenticationConverter(converter)))
                .exceptionHandling(errors -> errors
                        .authenticationEntryPoint((request, response, exception) -> {
                            response.setStatus(401);
                            response.setContentType(MediaType.APPLICATION_JSON_VALUE);
                            mapper.writeValue(response.getOutputStream(), ApiSupport.ApiEnvelope.error(
                                    "UNAUTHORIZED", "Kimlik doğrulama gereklidir.", Map.of(), ApiSupport.requestId(request)));
                        })
                        .accessDeniedHandler((request, response, exception) -> {
                            Authentication authentication = org.springframework.security.core.context.SecurityContextHolder
                                    .getContext().getAuthentication();
                            UUID actor = actorId(authentication);
                            String role = actorRole(authentication);
                            try {
                                rls.system(() -> audit.write(actor, role, "AUTHORIZATION_DENIED", "DENIED",
                                        "HTTP_PATH", request.getRequestURI(), request));
                            } catch (RuntimeException ignored) {
                                // Denial must still be returned if the audit database is unavailable.
                            }
                            response.setStatus(403);
                            response.setContentType(MediaType.APPLICATION_JSON_VALUE);
                            mapper.writeValue(response.getOutputStream(), ApiSupport.ApiEnvelope.error(
                                    "FORBIDDEN", "Bu işlem için yetkiniz yok.", Map.of(), ApiSupport.requestId(request)));
                        }));
        return http.build();
    }

    private static UUID actorId(Authentication authentication) {
        try { return UUID.fromString(authentication.getName()); }
        catch (RuntimeException ignored) { return null; }
    }

    private static String actorRole(Authentication authentication) {
        if (authentication == null) return "ANONYMOUS";
        return authentication.getAuthorities().stream().findFirst()
                .map(value -> value.getAuthority().replace("ROLE_", "")).orElse("UNKNOWN");
    }
}
