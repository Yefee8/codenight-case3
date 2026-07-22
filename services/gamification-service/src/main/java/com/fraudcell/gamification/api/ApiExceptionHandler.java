package com.fraudcell.gamification.api;

import jakarta.servlet.http.HttpServletRequest;
import java.util.NoSuchElementException;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;

@RestControllerAdvice
public class ApiExceptionHandler {
    @ExceptionHandler(NoSuchElementException.class)
    ResponseEntity<ApiEnvelope<Void>> notFound(NoSuchElementException ignored, HttpServletRequest request) {
        return ResponseEntity.status(HttpStatus.NOT_FOUND)
                .body(ApiEnvelope.failure("RESOURCE_NOT_FOUND", "Kaynak bulunamadı.", RequestIdFilter.current(request)));
    }

    @ExceptionHandler(IllegalArgumentException.class)
    ResponseEntity<ApiEnvelope<Void>> invalid(IllegalArgumentException exception, HttpServletRequest request) {
        return ResponseEntity.badRequest().body(ApiEnvelope.failure(
                "VALIDATION_ERROR", exception.getMessage(), RequestIdFilter.current(request)));
    }
}
