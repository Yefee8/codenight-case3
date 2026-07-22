package com.fraudcell.transaction.api;

import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;
import java.util.UUID;
import org.slf4j.MDC;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;

@Component
public class RequestIdFilter extends OncePerRequestFilter {
    public static final String ATTRIBUTE = "fraudcell.request-id";

    @Override protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response,
                                               FilterChain chain) throws ServletException, IOException {
        UUID id;
        try { id = UUID.fromString(request.getHeader("X-Request-ID")); }
        catch (Exception ignored) { id = UUID.randomUUID(); }
        request.setAttribute(ATTRIBUTE, id);
        response.setHeader("X-Request-ID", id.toString());
        response.setHeader("Cache-Control", "no-store");
        MDC.put("request_id", id.toString());
        try { chain.doFilter(request, response); } finally { MDC.remove("request_id"); }
    }

    public static UUID current(HttpServletRequest request) {
        Object value = request.getAttribute(ATTRIBUTE);
        return value instanceof UUID id ? id : UUID.randomUUID();
    }
}
