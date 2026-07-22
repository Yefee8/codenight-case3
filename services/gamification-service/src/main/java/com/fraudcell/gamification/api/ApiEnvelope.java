package com.fraudcell.gamification.api;

import com.fasterxml.jackson.annotation.JsonProperty;
import java.util.UUID;

public record ApiEnvelope<T>(
        boolean success,
        T data,
        ApiError error,
        @JsonProperty("request_id") UUID requestId) {

    public static <T> ApiEnvelope<T> success(T data, UUID requestId) {
        return new ApiEnvelope<>(true, data, null, requestId);
    }

    public static ApiEnvelope<Void> failure(String code, String message, UUID requestId) {
        return new ApiEnvelope<>(false, null, new ApiError(code, message), requestId);
    }
}
