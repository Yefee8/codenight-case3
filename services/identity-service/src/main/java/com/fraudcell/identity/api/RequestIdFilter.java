package com.fraudcell.identity.api;

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
    @Override
    protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response, FilterChain chain)
            throws ServletException, IOException {
        UUID requestId;
        try {
            requestId = UUID.fromString(request.getHeader("X-Request-ID"));
        } catch (RuntimeException ignored) {
            requestId = UUID.randomUUID();
        }
        request.setAttribute(ApiSupport.REQUEST_ID, requestId);
        response.setHeader("X-Request-ID", requestId.toString());
        MDC.put("request_id", requestId.toString());
        try {
            chain.doFilter(request, response);
        } finally {
            MDC.remove("request_id");
        }
    }
}
