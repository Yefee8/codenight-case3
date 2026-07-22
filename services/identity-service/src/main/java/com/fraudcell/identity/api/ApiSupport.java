package com.fraudcell.identity.api;

import jakarta.servlet.http.HttpServletRequest;
import java.util.Map;
import java.util.UUID;
import org.springframework.http.HttpStatus;

public final class ApiSupport {
    public static final String REQUEST_ID = "fraudcell.request_id";

    private ApiSupport() {}

    public record ApiError(String code, String message, Map<String, String[]> fieldErrors) {}

    public record ApiEnvelope<T>(boolean success, T data, ApiError error, UUID requestId) {
        public static <T> ApiEnvelope<T> ok(T data, HttpServletRequest request) {
            return new ApiEnvelope<>(true, data, null, ApiSupport.requestId(request));
        }

        public static ApiEnvelope<Void> error(
                String code, String message, Map<String, String[]> fields, UUID requestId) {
            return new ApiEnvelope<>(false, null, new ApiError(code, message, fields), requestId);
        }
    }

    public static UUID requestId(HttpServletRequest request) {
        Object value = request.getAttribute(REQUEST_ID);
        return value instanceof UUID id ? id : UUID.randomUUID();
    }

    public static final class DomainException extends RuntimeException {
        private final HttpStatus status;
        private final String code;

        public DomainException(HttpStatus status, String code, String message) {
            super(message);
            this.status = status;
            this.code = code;
        }

        public HttpStatus status() { return status; }
        public String code() { return code; }
    }
}
