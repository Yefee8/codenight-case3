package com.fraudcell.identity.api;

import com.fraudcell.identity.api.ApiSupport.ApiEnvelope;
import com.fraudcell.identity.application.AuthService;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.validation.Valid;
import java.time.Duration;
import java.util.Map;
import java.util.UUID;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpHeaders;
import org.springframework.http.ResponseCookie;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.Authentication;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.security.oauth2.server.resource.authentication.JwtAuthenticationToken;
import org.springframework.web.bind.annotation.CookieValue;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/v1")
public class AuthController {
    private static final String REFRESH_COOKIE = "fraudcell_refresh";
    private final AuthService service;
    private final boolean secureCookie;

    public AuthController(AuthService service, @Value("${fraudcell.cookie-secure}") boolean secureCookie) {
        this.service = service;
        this.secureCookie = secureCookie;
    }

    @PostMapping({"/auth/otp/challenges", "/auth/customers/otp", "/auth/customers/otp/challenges"})
    ApiEnvelope<AuthDtos.OtpChallengeResult> otp(
            @Valid @RequestBody AuthDtos.OtpChallengeRequest body, HttpServletRequest request) {
        return ApiEnvelope.ok(service.createOtp(body.gsm()), request);
    }

    @PostMapping("/auth/customers/register")
    ResponseEntity<ApiEnvelope<AuthDtos.AuthResult>> register(
            @Valid @RequestBody AuthDtos.CustomerRegisterRequest body, HttpServletRequest request) {
        var bundle = service.registerCustomer(body.challengeId(), body.gsm(), body.otpCode(),
                body.firstName(), body.lastName(), body.email(), request);
        return authResponse(bundle, request);
    }

    @PostMapping("/auth/customers/login")
    ResponseEntity<ApiEnvelope<AuthDtos.AuthResult>> customerLogin(
            @Valid @RequestBody AuthDtos.CustomerLoginRequest body, HttpServletRequest request) {
        var bundle = service.loginCustomer(body.challengeId(), body.gsm(), body.otpCode(), request);
        return authResponse(bundle, request);
    }

    @PostMapping("/auth/staff/login")
    ResponseEntity<ApiEnvelope<AuthDtos.AuthResult>> staffLogin(
            @Valid @RequestBody AuthDtos.StaffLoginRequest body, HttpServletRequest request) {
        var bundle = service.loginStaff(body.email(), body.password(), request);
        return authResponse(bundle, request);
    }

    @PostMapping("/auth/refresh")
    ResponseEntity<ApiEnvelope<AuthDtos.AuthResult>> refresh(
            @CookieValue(name = REFRESH_COOKIE, required = false) String refresh, HttpServletRequest request) {
        return authResponse(service.refresh(refresh, request), request);
    }

    @PostMapping("/auth/logout")
    ResponseEntity<ApiEnvelope<Map<String, Boolean>>> logout(
            @CookieValue(name = REFRESH_COOKIE, required = false) String refresh,
            Authentication authentication, HttpServletRequest request) {
        service.logout(refresh, actorId(authentication), request);
        ResponseCookie cleared = cookie("", Duration.ZERO);
        return ResponseEntity.ok().header(HttpHeaders.SET_COOKIE, cleared.toString())
                .body(ApiEnvelope.ok(Map.of("logged_out", true), request));
    }

    @GetMapping("/users/me")
    ApiEnvelope<AuthDtos.CurrentUser> me(Authentication authentication, HttpServletRequest request) {
        return ApiEnvelope.ok(service.current(actorId(authentication), role(authentication)), request);
    }

    private ResponseEntity<ApiEnvelope<AuthDtos.AuthResult>> authResponse(
            AuthDtos.AuthBundle bundle, HttpServletRequest request) {
        return ResponseEntity.ok()
                .header(HttpHeaders.SET_COOKIE, cookie(bundle.refreshToken(), Duration.ofDays(7)).toString())
                .header(HttpHeaders.CACHE_CONTROL, "no-store")
                .body(ApiEnvelope.ok(bundle.result(), request));
    }

    private ResponseCookie cookie(String value, Duration age) {
        return ResponseCookie.from(REFRESH_COOKIE, value)
                .httpOnly(true).secure(secureCookie).sameSite("Strict")
                .path("/api/v1/auth").maxAge(age).build();
    }

    private static UUID actorId(Authentication authentication) {
        if (authentication == null) return null;
        return UUID.fromString(authentication.getName());
    }

    private static String role(Authentication authentication) {
        if (authentication instanceof JwtAuthenticationToken token) {
            return token.getToken().getClaimAsString("role");
        }
        return "SYSTEM";
    }
}
