package com.fraudcell.transaction.api;

import org.springframework.http.HttpStatus;

public class DomainViolation extends RuntimeException {
    private final HttpStatus status;
    private final String code;
    public DomainViolation(HttpStatus status, String code, String message) {
        super(message); this.status = status; this.code = code;
    }
    public HttpStatus status() { return status; }
    public String code() { return code; }
    public static DomainViolation invalidState(String message) {
        return new DomainViolation(HttpStatus.UNPROCESSABLE_ENTITY, "INVALID_CASE_TRANSITION", message);
    }
}
