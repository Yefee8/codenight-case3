package com.fraudcell.identity.api;

import static com.fraudcell.identity.api.ApiSupport.ApiEnvelope;

import jakarta.servlet.http.HttpServletRequest;
import jakarta.validation.ConstraintViolationException;
import java.util.LinkedHashMap;
import java.util.Map;
import org.springframework.dao.DuplicateKeyException;
import org.springframework.http.ResponseEntity;
import org.springframework.http.converter.HttpMessageNotReadableException;
import org.springframework.web.bind.MethodArgumentNotValidException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;

@RestControllerAdvice
public class ApiExceptionHandler {
    @ExceptionHandler(ApiSupport.DomainException.class)
    ResponseEntity<ApiEnvelope<Void>> domain(ApiSupport.DomainException exception, HttpServletRequest request) {
        return ResponseEntity.status(exception.status()).body(ApiEnvelope.error(
                exception.code(), exception.getMessage(), Map.of(), ApiSupport.requestId(request)));
    }

    @ExceptionHandler(MethodArgumentNotValidException.class)
    ResponseEntity<ApiEnvelope<Void>> validation(MethodArgumentNotValidException exception, HttpServletRequest request) {
        Map<String, String[]> fields = new LinkedHashMap<>();
        exception.getBindingResult().getFieldErrors().forEach(error ->
                fields.put(error.getField(), new String[] {error.getDefaultMessage()}));
        return ResponseEntity.unprocessableEntity().body(ApiEnvelope.error(
                "VALIDATION_ERROR", "İstek alanları geçersiz.", fields, ApiSupport.requestId(request)));
    }

    @ExceptionHandler({ConstraintViolationException.class, HttpMessageNotReadableException.class})
    ResponseEntity<ApiEnvelope<Void>> malformed(Exception exception, HttpServletRequest request) {
        return ResponseEntity.unprocessableEntity().body(ApiEnvelope.error(
                "VALIDATION_ERROR", "İstek gövdesi geçersiz.", Map.of(), ApiSupport.requestId(request)));
    }

    @ExceptionHandler(DuplicateKeyException.class)
    ResponseEntity<ApiEnvelope<Void>> conflict(DuplicateKeyException exception, HttpServletRequest request) {
        return ResponseEntity.status(409).body(ApiEnvelope.error(
                "IDENTITY_ALREADY_EXISTS", "GSM veya e-posta zaten kayıtlı.", Map.of(), ApiSupport.requestId(request)));
    }

    @ExceptionHandler(Exception.class)
    ResponseEntity<ApiEnvelope<Void>> unexpected(Exception exception, HttpServletRequest request) {
        return ResponseEntity.internalServerError().body(ApiEnvelope.error(
                "INTERNAL_ERROR", "İstek tamamlanamadı.", Map.of(), ApiSupport.requestId(request)));
    }
}
