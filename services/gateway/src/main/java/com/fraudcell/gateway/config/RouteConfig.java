package com.fraudcell.gateway.config;

import java.util.List;
import org.springframework.cloud.gateway.route.RouteLocator;
import org.springframework.cloud.gateway.route.builder.RouteLocatorBuilder;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpMethod;
import org.springframework.web.cors.CorsConfiguration;
import org.springframework.web.cors.reactive.CorsWebFilter;
import org.springframework.web.cors.reactive.UrlBasedCorsConfigurationSource;

@Configuration
public class RouteConfig {

    @Bean
    RouteLocator fraudcellRoutes(RouteLocatorBuilder builder, GatewayProperties properties) {
        return builder.routes()
                .route("identity-api", route -> route
                        .path("/api/v1/auth/**", "/api/v1/users/**", "/api/v1/staff/**", "/api/v1/admin/**")
                        .uri(properties.identityBaseUrl()))
                .route("transaction-api", route -> route
                        .path("/api/v1/transactions/**", "/api/v1/cases/**",
                                "/api/v1/dashboard/**", "/api/v1/notifications/**")
                        .uri(properties.transactionBaseUrl()))
                .route("ai-public-api", route -> route
                        .path("/api/v1/ai/model", "/api/v1/ai/metrics", "/api/v1/ai/metrics/**")
                        .uri(properties.aiBaseUrl()))
                .route("gamification-api", route -> route
                        .path("/api/v1/game/**")
                        .uri(properties.gamificationBaseUrl()))
                .build();
    }

    @Bean
    CorsWebFilter corsWebFilter(GatewayProperties properties) {
        CorsConfiguration configuration = corsConfiguration(properties);
        UrlBasedCorsConfigurationSource source = new UrlBasedCorsConfigurationSource();
        source.registerCorsConfiguration("/api/**", configuration);
        return new CorsWebFilter(source);
    }

    CorsConfiguration corsConfiguration(GatewayProperties properties) {
        CorsConfiguration configuration = new CorsConfiguration();
        configuration.setAllowedOrigins(properties.allowedOrigins());
        configuration.setAllowedMethods(List.of(
                HttpMethod.GET.name(), HttpMethod.POST.name(), HttpMethod.PATCH.name(),
                HttpMethod.PUT.name(), HttpMethod.DELETE.name(), HttpMethod.OPTIONS.name()));
        configuration.setAllowedHeaders(List.of(
                HttpHeaders.AUTHORIZATION, HttpHeaders.CONTENT_TYPE, HttpHeaders.ACCEPT,
                "Idempotency-Key", HttpHeaders.IF_MATCH, "Last-Event-ID", "X-CSRF-Token",
                "X-Request-ID", HttpHeaders.CACHE_CONTROL, HttpHeaders.PRAGMA));
        configuration.setExposedHeaders(List.of("X-Request-ID", HttpHeaders.RETRY_AFTER, HttpHeaders.ETAG));
        configuration.setAllowCredentials(true);
        configuration.setMaxAge(600L);
        return configuration;
    }
}
