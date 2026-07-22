package com.fraudcell.gateway.security;

import com.fraudcell.gateway.config.GatewayProperties;
import com.fraudcell.gateway.error.GatewayErrorWriter;
import java.util.List;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.http.HttpMethod;
import org.springframework.security.config.annotation.web.reactive.EnableWebFluxSecurity;
import org.springframework.security.config.web.server.ServerHttpSecurity;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.security.oauth2.core.DelegatingOAuth2TokenValidator;
import org.springframework.security.oauth2.jose.jws.SignatureAlgorithm;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.security.oauth2.jwt.JwtIssuerValidator;
import org.springframework.security.oauth2.jwt.JwtTimestampValidator;
import org.springframework.security.oauth2.jwt.NimbusReactiveJwtDecoder;
import org.springframework.security.oauth2.server.resource.authentication.JwtAuthenticationToken;
import org.springframework.security.oauth2.server.resource.authentication.ReactiveJwtAuthenticationConverter;
import org.springframework.security.oauth2.server.resource.web.server.authentication.ServerBearerTokenAuthenticationConverter;
import org.springframework.security.web.server.SecurityWebFilterChain;
import reactor.core.publisher.Flux;

@Configuration
@EnableWebFluxSecurity
public class SecurityConfig {

    @Bean
    SecurityWebFilterChain securityWebFilterChain(
            ServerHttpSecurity http,
            GatewayErrorWriter errorWriter,
            ReactiveJwtAuthenticationConverter jwtAuthenticationConverter) {
        return http
                .csrf(ServerHttpSecurity.CsrfSpec::disable)
                .cors(ServerHttpSecurity.CorsSpec::disable)
                .httpBasic(ServerHttpSecurity.HttpBasicSpec::disable)
                .formLogin(ServerHttpSecurity.FormLoginSpec::disable)
                .logout(ServerHttpSecurity.LogoutSpec::disable)
                .authorizeExchange(exchanges -> exchanges
                        .pathMatchers(HttpMethod.OPTIONS, "/**").permitAll()
                        .pathMatchers("/actuator/health", "/actuator/health/**").permitAll()
                        .pathMatchers("/internal/**").permitAll()
                        .pathMatchers(HttpMethod.POST,
                                "/api/v1/auth/otp/challenges",
                                "/api/v1/auth/customers/register",
                                "/api/v1/auth/customers/login",
                                "/api/v1/auth/staff/login",
                                "/api/v1/auth/refresh",
                                "/api/v1/auth/logout").permitAll()
                        .pathMatchers("/api/v1/admin/**").hasRole("ADMIN")
                        .pathMatchers("/api/v1/ai/**").hasAnyRole("SUPERVISOR", "ADMIN")
                        .pathMatchers("/api/v1/game/**").hasAnyRole("ANALYST", "SUPERVISOR", "ADMIN")
                        .pathMatchers("/api/v1/staff/**").hasAnyRole("ANALYST", "SUPERVISOR", "ADMIN")
                        .pathMatchers("/actuator/prometheus").hasRole("ADMIN")
                        .pathMatchers("/api/**").authenticated()
                        .anyExchange().permitAll())
                .exceptionHandling(errors -> errors
                        .authenticationEntryPoint((exchange, exception) -> errorWriter.write(
                                exchange, org.springframework.http.HttpStatus.UNAUTHORIZED,
                                "AUTHENTICATION_REQUIRED", "Geçerli kimlik doğrulaması gerekli."))
                        .accessDeniedHandler((exchange, exception) -> errorWriter.write(
                                exchange, org.springframework.http.HttpStatus.FORBIDDEN,
                                "ACCESS_DENIED", "Bu işlem için yetkiniz yok.")))
                .oauth2ResourceServer(resource -> resource
                        .bearerTokenConverter(new ServerBearerTokenAuthenticationConverter())
                        .jwt(jwt -> jwt.jwtAuthenticationConverter(jwtAuthenticationConverter))
                        .authenticationEntryPoint((exchange, exception) -> errorWriter.write(
                                exchange, org.springframework.http.HttpStatus.UNAUTHORIZED,
                                "INVALID_ACCESS_TOKEN", "Access token geçersiz veya süresi dolmuş.")))
                .build();
    }

    @Bean
    NimbusReactiveJwtDecoder jwtDecoder(GatewayProperties properties) {
        NimbusReactiveJwtDecoder decoder = NimbusReactiveJwtDecoder.withJwkSetUri(properties.jwksUri())
                .jwsAlgorithm(SignatureAlgorithm.RS256)
                .build();
        decoder.setJwtValidator(new DelegatingOAuth2TokenValidator<>(
                new JwtTimestampValidator(),
                new JwtIssuerValidator(properties.issuer()),
                new FraudcellJwtValidator(properties)));
        return decoder;
    }

    @Bean
    ReactiveJwtAuthenticationConverter jwtAuthenticationConverter() {
        ReactiveJwtAuthenticationConverter converter = new ReactiveJwtAuthenticationConverter();
        converter.setJwtGrantedAuthoritiesConverter(jwt -> {
            String role = jwt.getClaimAsString("role");
            return role == null
                    ? Flux.empty()
                    : Flux.just(new SimpleGrantedAuthority("ROLE_" + role));
        });
        converter.setPrincipalClaimName("sub");
        return converter;
    }
}
