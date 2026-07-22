package com.fraudcell.transaction.security;

import com.fraudcell.transaction.api.ApiEnvelope;
import com.fraudcell.transaction.api.RequestIdFilter;
import jakarta.servlet.http.HttpServletRequest;
import java.io.IOException;
import java.util.List;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.http.MediaType;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.config.http.SessionCreationPolicy;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.security.oauth2.core.DelegatingOAuth2TokenValidator;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.security.oauth2.jwt.JwtClaimValidator;
import org.springframework.security.oauth2.jwt.JwtDecoder;
import org.springframework.security.oauth2.jwt.JwtValidators;
import org.springframework.security.oauth2.jwt.NimbusJwtDecoder;
import org.springframework.security.oauth2.jose.jws.SignatureAlgorithm;
import org.springframework.security.oauth2.server.resource.authentication.JwtAuthenticationConverter;
import org.springframework.security.web.SecurityFilterChain;
import tools.jackson.databind.json.JsonMapper;

@Configuration
public class SecurityConfig {
    @Bean SecurityFilterChain filterChain(HttpSecurity http, JsonMapper json) throws Exception {
        return http.csrf(csrf -> csrf.disable())
                .sessionManagement(session -> session.sessionCreationPolicy(SessionCreationPolicy.STATELESS))
                .authorizeHttpRequests(auth -> auth
                        .requestMatchers("/actuator/health/**", "/v3/api-docs/**", "/openapi.json", "/swagger-ui/**", "/swagger-ui.html").permitAll()
                        .requestMatchers("/api/v1/dashboard/**").hasAnyRole("SUPERVISOR","ADMIN")
                        .requestMatchers(org.springframework.http.HttpMethod.POST, "/api/v1/transactions").hasRole("CUSTOMER")
                        .requestMatchers("/api/v1/cases/*/customer-verification", "/api/v1/cases/*/feedback").hasRole("CUSTOMER")
                        .requestMatchers("/api/v1/cases/*/assignments", "/api/v1/cases/*/risk-level", "/api/v1/cases/*/ground-truth").hasRole("SUPERVISOR")
                        .requestMatchers("/api/**").authenticated().anyRequest().denyAll())
                .oauth2ResourceServer(oauth -> oauth.jwt(jwt -> jwt.jwtAuthenticationConverter(converter()))
                        .authenticationEntryPoint((request, response, error) -> write(json, request, response, 401,
                                "UNAUTHENTICATED", "Geçerli access token gerekli.")))
                .exceptionHandling(errors -> errors.accessDeniedHandler((request, response, error) -> write(
                        json, request, response, 403, "FORBIDDEN", "Bu işlem için yetkiniz yok.")))
                .build();
    }

    @Bean JwtDecoder jwtDecoder(
            @Value("${spring.security.oauth2.resourceserver.jwt.jwk-set-uri}") String jwks,
            @Value("${spring.security.oauth2.resourceserver.jwt.issuer-uri}") String issuer,
            @Value("${JWT_AUDIENCE:fraudcell-api}") String audience) {
        var decoder = NimbusJwtDecoder.withJwkSetUri(jwks).jwsAlgorithm(SignatureAlgorithm.RS256).build();
        decoder.setJwtValidator(new DelegatingOAuth2TokenValidator<>(JwtValidators.createDefaultWithIssuer(issuer),
                new JwtClaimValidator<List<String>>("aud", value -> value != null && value.contains(audience))));
        return decoder;
    }

    private static JwtAuthenticationConverter converter() {
        var converter = new JwtAuthenticationConverter();
        converter.setPrincipalClaimName("sub");
        converter.setJwtGrantedAuthoritiesConverter(jwt -> {
            String role = jwt.getClaimAsString("role");
            return role == null ? List.of() : List.of(new SimpleGrantedAuthority("ROLE_" + role));
        });
        return converter;
    }

    private static void write(JsonMapper json, HttpServletRequest request, jakarta.servlet.http.HttpServletResponse response,
                              int status, String code, String message) throws IOException {
        response.setStatus(status); response.setContentType(MediaType.APPLICATION_JSON_VALUE);
        response.setHeader("Cache-Control", "no-store");
        json.writeValue(response.getOutputStream(), ApiEnvelope.fail(code, message, RequestIdFilter.current(request)));
    }
}
