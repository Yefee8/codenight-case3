package com.fraudcell.gateway.security;

import java.time.Duration;

public record RateLimitPolicy(String name, String dimension, int limit, Duration window) {
    public RateLimitPolicy {
        if (name == null || name.isBlank() || dimension == null || dimension.isBlank()) {
            throw new IllegalArgumentException("Rate limit adı ve boyutu zorunludur.");
        }
        if (limit < 1 || window == null || window.isZero() || window.isNegative()) {
            throw new IllegalArgumentException("Rate limit ve pencere pozitif olmalıdır.");
        }
    }
}
