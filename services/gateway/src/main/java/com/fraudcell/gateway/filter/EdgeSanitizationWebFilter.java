package com.fraudcell.gateway.filter;

import com.fraudcell.gateway.config.GatewayProperties;
import com.fraudcell.gateway.error.GatewayErrorWriter;
import java.net.URI;
import java.util.List;
import java.util.Locale;
import java.util.Set;
import java.util.UUID;
import org.springframework.core.Ordered;
import org.springframework.core.annotation.Order;
import org.springframework.http.CacheControl;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpMethod;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Component;
import org.springframework.web.server.ServerWebExchange;
import org.springframework.web.server.WebFilter;
import org.springframework.web.server.WebFilterChain;
import reactor.core.publisher.Mono;

@Component
@Order(Ordered.HIGHEST_PRECEDENCE)
public class EdgeSanitizationWebFilter implements WebFilter {
    private static final Set<String> EXACT_UNTRUSTED_HEADERS = Set.of(
            "forwarded", "x-request-id", "x-real-ip", "x-internal-token");

    private final Set<String> allowedOrigins;
    private final GatewayErrorWriter errorWriter;

    public EdgeSanitizationWebFilter(GatewayProperties properties, GatewayErrorWriter errorWriter) {
        this.allowedOrigins = Set.copyOf(properties.allowedOrigins());
        this.errorWriter = errorWriter;
    }

    @Override
    public Mono<Void> filter(ServerWebExchange exchange, WebFilterChain chain) {
        String requestId = normalizedRequestId(exchange.getRequest().getHeaders().getFirst("X-Request-ID"));
        ServerWebExchange sanitized = exchange.mutate().request(request -> request.headers(headers -> {
            List.copyOf(headers.headerNames()).stream()
                    .filter(EdgeSanitizationWebFilter::isUntrustedHeader)
                    .forEach(headers::remove);
            headers.set("X-Request-ID", requestId);
        })).build();

        addSecurityHeaders(sanitized);
        if (isCrossSiteCookieMutation(sanitized)) {
            return errorWriter.write(sanitized, HttpStatus.FORBIDDEN,
                    "CROSS_SITE_REQUEST_REJECTED", "İzin verilmeyen çapraz kaynak isteği.");
        }
        return chain.filter(sanitized);
    }

    private boolean isCrossSiteCookieMutation(ServerWebExchange exchange) {
        if (exchange.getRequest().getMethod() != HttpMethod.POST) {
            return false;
        }
        String path = exchange.getRequest().getPath().value();
        if (!path.equals("/api/v1/auth/refresh") && !path.equals("/api/v1/auth/logout")) {
            return false;
        }
        String fetchSite = exchange.getRequest().getHeaders().getFirst("Sec-Fetch-Site");
        if (fetchSite != null && fetchSite.equalsIgnoreCase("cross-site")) {
            return true;
        }
        String origin = exchange.getRequest().getHeaders().getOrigin();
        if (origin == null) {
            return false;
        }
        try {
            return !allowedOrigins.contains(URI.create(origin).toString());
        } catch (IllegalArgumentException exception) {
            return true;
        }
    }

    private static boolean isUntrustedHeader(String header) {
        String lower = header.toLowerCase(Locale.ROOT);
        return EXACT_UNTRUSTED_HEADERS.contains(lower)
                || lower.startsWith("x-forwarded-")
                || lower.startsWith("x-user-")
                || lower.startsWith("x-actor-")
                || lower.startsWith("x-service-");
    }

    private static String normalizedRequestId(String candidate) {
        try {
            return candidate == null ? UUID.randomUUID().toString() : UUID.fromString(candidate).toString();
        } catch (IllegalArgumentException exception) {
            return UUID.randomUUID().toString();
        }
    }

    private static void addSecurityHeaders(ServerWebExchange exchange) {
        HttpHeaders headers = exchange.getResponse().getHeaders();
        headers.set("X-Content-Type-Options", "nosniff");
        headers.set("X-Frame-Options", "DENY");
        headers.set("Referrer-Policy", "no-referrer");
        headers.set("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
        headers.set("Content-Security-Policy", "default-src 'none'; frame-ancestors 'none'; base-uri 'none'");
        headers.set("X-Request-ID", exchange.getRequest().getHeaders().getFirst("X-Request-ID"));
        if (exchange.getRequest().getPath().value().startsWith("/api/")) {
            headers.setCacheControl(CacheControl.noStore());
        }
    }
}
