package com.fraudcell.gateway.filter;

import com.fraudcell.gateway.error.GatewayErrorWriter;
import com.fraudcell.gateway.security.RateLimitDecision;
import com.fraudcell.gateway.security.RateLimitPolicy;
import com.fraudcell.gateway.security.SecurityStateStore;
import com.fraudcell.gateway.security.SecurityStoreUnavailableException;
import com.fraudcell.gateway.security.SessionDecision;
import java.net.InetSocketAddress;
import java.time.Duration;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.Optional;
import org.springframework.cloud.gateway.filter.GatewayFilterChain;
import org.springframework.cloud.gateway.filter.GlobalFilter;
import org.springframework.core.Ordered;
import org.springframework.core.io.buffer.DataBufferLimitException;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpMethod;
import org.springframework.http.HttpStatus;
import org.springframework.security.oauth2.server.resource.authentication.JwtAuthenticationToken;
import org.springframework.stereotype.Component;
import org.springframework.web.server.ServerWebExchange;
import reactor.core.publisher.Flux;
import reactor.core.publisher.Mono;

@Component
public class GatewaySecurityStateFilter implements GlobalFilter, Ordered {
    private static final RateLimitPolicy GENERAL_AUTHENTICATED =
            new RateLimitPolicy("general", "user", 120, Duration.ofMinutes(1));
    private static final RateLimitPolicy TRANSACTION_CREATE =
            new RateLimitPolicy("transaction-create", "user", 10, Duration.ofMinutes(1));
    private static final RateLimitPolicy PRIVILEGED_MUTATION =
            new RateLimitPolicy("privileged-mutation", "user", 30, Duration.ofMinutes(1));
    private static final RateLimitPolicy AUTH_IP =
            new RateLimitPolicy("login", "ip", 20, Duration.ofMinutes(15));
    private static final RateLimitPolicy AUTH_ACCOUNT =
            new RateLimitPolicy("login", "account", 5, Duration.ofMinutes(15));
    private static final RateLimitPolicy OTP_IP =
            new RateLimitPolicy("otp-request", "ip", 10, Duration.ofHours(1));
    private static final RateLimitPolicy OTP_ACCOUNT =
            new RateLimitPolicy("otp-request", "account", 3, Duration.ofMinutes(5));
    private static final RateLimitPolicy REFRESH_SESSION =
            new RateLimitPolicy("refresh", "session", 30, Duration.ofMinutes(15));

    private final SecurityStateStore stateStore;
    private final RequestBodyCache requestBodyCache;
    private final GatewayErrorWriter errorWriter;

    public GatewaySecurityStateFilter(
            SecurityStateStore stateStore,
            RequestBodyCache requestBodyCache,
            GatewayErrorWriter errorWriter) {
        this.stateStore = stateStore;
        this.requestBodyCache = requestBodyCache;
        this.errorWriter = errorWriter;
    }

    @Override
    public Mono<Void> filter(ServerWebExchange original, GatewayFilterChain chain) {
        return requestBodyCache.inspect(original)
                .flatMap(inspected -> inspected.exchange().getPrincipal()
                        .ofType(JwtAuthenticationToken.class)
                        .map(Optional::of)
                        .defaultIfEmpty(Optional.empty())
                        .flatMap(authentication -> authentication.isPresent()
                                ? authenticated(inspected, authentication.orElseThrow(), chain)
                                : publicRequest(inspected, chain)))
                .onErrorResume(RequestBodyCache.RequestBodyTooLargeException.class,
                        error -> errorWriter.write(original, HttpStatus.CONTENT_TOO_LARGE,
                                "PAYLOAD_TOO_LARGE", "İstek gövdesi 64 KiB sınırını aşıyor."))
                .onErrorResume(DataBufferLimitException.class,
                        error -> errorWriter.write(original, HttpStatus.CONTENT_TOO_LARGE,
                                "PAYLOAD_TOO_LARGE", "İstek gövdesi 64 KiB sınırını aşıyor."))
                .onErrorResume(SecurityStoreUnavailableException.class,
                        error -> errorWriter.write(original, HttpStatus.SERVICE_UNAVAILABLE,
                                "SECURITY_STATE_UNAVAILABLE", "Güvenlik durumu geçici olarak doğrulanamıyor."));
    }

    private Mono<Void> authenticated(
            RequestBodyCache.InspectedRequest inspected,
            JwtAuthenticationToken authentication,
            GatewayFilterChain chain) {
        var jwt = authentication.getToken();
        long epoch = ((Number) jwt.getClaims().get("session_epoch")).longValue();
        return stateStore.validateSession(jwt.getSubject(), jwt.getId(), epoch, jwt.getExpiresAt())
                .flatMap(decision -> decision == SessionDecision.REVOKED
                        ? errorWriter.write(inspected.exchange(), HttpStatus.UNAUTHORIZED,
                                "SESSION_REVOKED", "Oturum artık geçerli değil.")
                        : applyLimits(inspected.exchange(), chain,
                                authenticatedLimits(inspected.exchange(), jwt.getSubject())));
    }

    private Mono<Void> publicRequest(RequestBodyCache.InspectedRequest inspected, GatewayFilterChain chain) {
        String path = inspected.exchange().getRequest().getPath().value();
        if (!path.startsWith("/api/v1/auth/")) {
            return chain.filter(inspected.exchange());
        }
        List<LimitWithIdentifier> limits = new ArrayList<>();
        String ip = remoteIp(inspected.exchange());
        if (path.equals("/api/v1/auth/otp/challenges")) {
            limits.add(new LimitWithIdentifier(OTP_IP, ip));
            if (inspected.accountIdentifier() != null) {
                limits.add(new LimitWithIdentifier(OTP_ACCOUNT, inspected.accountIdentifier()));
            }
        } else if (path.equals("/api/v1/auth/refresh")) {
            limits.add(new LimitWithIdentifier(AUTH_IP, ip));
            String refresh = refreshToken(inspected.exchange());
            if (refresh != null) {
                limits.add(new LimitWithIdentifier(REFRESH_SESSION, refresh));
            }
        } else {
            limits.add(new LimitWithIdentifier(AUTH_IP, ip));
            if (inspected.accountIdentifier() != null) {
                limits.add(new LimitWithIdentifier(AUTH_ACCOUNT, inspected.accountIdentifier()));
            }
        }
        return applyLimits(inspected.exchange(), chain, limits);
    }

    private List<LimitWithIdentifier> authenticatedLimits(ServerWebExchange exchange, String userId) {
        List<LimitWithIdentifier> limits = new ArrayList<>();
        limits.add(new LimitWithIdentifier(GENERAL_AUTHENTICATED, userId));
        String path = exchange.getRequest().getPath().value();
        HttpMethod method = exchange.getRequest().getMethod();
        if (method == HttpMethod.POST && path.equals("/api/v1/transactions")) {
            limits.add(new LimitWithIdentifier(TRANSACTION_CREATE, userId));
        }
        if (isMutation(method) && (path.startsWith("/api/v1/admin/")
                || path.contains("/decision") || path.contains("/assignments")
                || path.contains("/ground-truth") || path.contains("/risk-level")
                || path.contains("/fraud-type"))) {
            limits.add(new LimitWithIdentifier(PRIVILEGED_MUTATION, userId));
        }
        return limits;
    }

    private Mono<Void> applyLimits(
            ServerWebExchange exchange,
            GatewayFilterChain chain,
            List<LimitWithIdentifier> limits) {
        return Flux.fromIterable(limits)
                .concatMap(item -> stateStore.consume(item.policy(), item.identifier()))
                .filter(decision -> !decision.allowed())
                .next()
                .map(Optional::of)
                .defaultIfEmpty(Optional.empty())
                .flatMap(decision -> decision.isPresent()
                        ? rateLimited(exchange, decision.orElseThrow())
                        : chain.filter(exchange));
    }

    private Mono<Void> rateLimited(ServerWebExchange exchange, RateLimitDecision decision) {
        exchange.getResponse().getHeaders().set(HttpHeaders.RETRY_AFTER,
                Long.toString(Math.max(1, decision.retryAfter().toSeconds())));
        return errorWriter.write(exchange, HttpStatus.TOO_MANY_REQUESTS,
                "RATE_LIMIT_EXCEEDED", "İstek sınırı aşıldı; daha sonra tekrar deneyin.");
    }

    private static String remoteIp(ServerWebExchange exchange) {
        InetSocketAddress address = exchange.getRequest().getRemoteAddress();
        return address == null || address.getAddress() == null
                ? "unknown" : address.getAddress().getHostAddress().toLowerCase(Locale.ROOT);
    }

    private static String refreshToken(ServerWebExchange exchange) {
        for (String name : List.of("refresh_token", "fraudcell_refresh", "refreshToken")) {
            var cookie = exchange.getRequest().getCookies().getFirst(name);
            if (cookie != null && !cookie.getValue().isBlank()) {
                return cookie.getValue();
            }
        }
        return null;
    }

    private static boolean isMutation(HttpMethod method) {
        return method == HttpMethod.POST || method == HttpMethod.PUT
                || method == HttpMethod.PATCH || method == HttpMethod.DELETE;
    }

    @Override
    public int getOrder() {
        return -100;
    }

    private record LimitWithIdentifier(RateLimitPolicy policy, String identifier) {
    }
}
