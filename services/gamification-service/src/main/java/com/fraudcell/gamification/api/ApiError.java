package com.fraudcell.gamification.api;

import com.fasterxml.jackson.annotation.JsonProperty;
import java.util.Map;

public record ApiError(
        String code,
        String message,
        @JsonProperty("field_errors") Map<String, java.util.List<String>> fieldErrors) {
    public ApiError(String code, String message) {
        this(code, message, Map.of());
    }
}
