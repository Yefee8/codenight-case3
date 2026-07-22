package com.fraudcell.transaction.api;

import java.util.Map;
import java.util.UUID;

public record ApiEnvelope<T>(boolean success, T data, ApiError error, UUID requestId) {
    public static <T> ApiEnvelope<T> ok(T data, UUID requestId) {
        return new ApiEnvelope<>(true, data, null, requestId);
    }
    public static <T> ApiEnvelope<T> fail(String code, String message, UUID requestId) {
        return new ApiEnvelope<>(false, null, new ApiError(code, message, Map.of()), requestId);
    }
    public record ApiError(String code, String message, Map<String, java.util.List<String>> fieldErrors) {}
}
