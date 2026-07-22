package com.fraudcell.gamification.api;

import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;
import java.util.UUID;
import org.slf4j.MDC;
import org.springframework.core.Ordered;
import org.springframework.core.annotation.Order;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;

@Component
@Order(Ordered.HIGHEST_PRECEDENCE)
public class RequestIdFilter extends OncePerRequestFilter {
    public static final String ATTRIBUTE = RequestIdFilter.class.getName() + ".requestId";

    @Override
    protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response, FilterChain chain)
            throws ServletException, IOException {
        UUID requestId = parseOrCreate(request.getHeader("X-Request-ID"));
        request.setAttribute(ATTRIBUTE, requestId);
        response.setHeader("X-Request-ID", requestId.toString());
        response.setHeader("Cache-Control", "no-store");
        try (var ignored = MDC.putCloseable("request_id", requestId.toString())) {
            chain.doFilter(request, response);
        }
    }

    private static UUID parseOrCreate(String value) {
        try {
            return value == null ? UUID.randomUUID() : UUID.fromString(value);
        } catch (IllegalArgumentException ignored) {
            return UUID.randomUUID();
        }
    }

    public static UUID current(HttpServletRequest request) {
        return (UUID) request.getAttribute(ATTRIBUTE);
    }
}
