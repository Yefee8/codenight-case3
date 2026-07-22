package com.fraudcell.transaction.api;

import jakarta.servlet.http.HttpServletRequest;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.NoSuchElementException;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.MethodArgumentNotValidException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;

@RestControllerAdvice
public class ApiExceptionHandler {
    @ExceptionHandler(DomainViolation.class)
    ResponseEntity<ApiEnvelope<Void>> domain(DomainViolation error, HttpServletRequest request) {
        return ResponseEntity.status(error.status()).body(ApiEnvelope.fail(
                error.code(), error.getMessage(), RequestIdFilter.current(request)));
    }

    @ExceptionHandler(NoSuchElementException.class)
    ResponseEntity<ApiEnvelope<Void>> missing(HttpServletRequest request) {
        return ResponseEntity.status(HttpStatus.NOT_FOUND).body(ApiEnvelope.fail(
                "RESOURCE_NOT_FOUND", "Kaynak bulunamadı.", RequestIdFilter.current(request)));
    }

    @ExceptionHandler(DataIntegrityViolationException.class)
    ResponseEntity<ApiEnvelope<Void>> conflict(HttpServletRequest request) {
        return ResponseEntity.status(HttpStatus.CONFLICT).body(ApiEnvelope.fail(
                "CONFLICT", "İstek mevcut bir kayıtla çakışıyor.", RequestIdFilter.current(request)));
    }

    @ExceptionHandler(MethodArgumentNotValidException.class)
    ResponseEntity<ApiEnvelope<Void>> invalid(MethodArgumentNotValidException error, HttpServletRequest request) {
        Map<String, List<String>> fields = new LinkedHashMap<>();
        error.getBindingResult().getFieldErrors().forEach(item ->
                fields.computeIfAbsent(item.getField(), ignored -> new java.util.ArrayList<>())
                        .add(item.getDefaultMessage()));
        var body = new ApiEnvelope<Void>(false, null,
                new ApiEnvelope.ApiError("VALIDATION_ERROR", "İstek alanları geçersiz.", fields),
                RequestIdFilter.current(request));
        return ResponseEntity.badRequest().body(body);
    }
}
