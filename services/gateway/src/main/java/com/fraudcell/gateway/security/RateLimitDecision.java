package com.fraudcell.gateway.security;

import java.time.Duration;

public record RateLimitDecision(boolean allowed, long observed, int limit, Duration retryAfter) {
}
