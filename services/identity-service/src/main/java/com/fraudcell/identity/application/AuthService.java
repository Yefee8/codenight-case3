package com.fraudcell.identity.application;

import static com.fraudcell.identity.api.ApiSupport.DomainException;

import com.fraudcell.identity.api.AuthDtos.AuthBundle;
import com.fraudcell.identity.api.AuthDtos.AuthResult;
import com.fraudcell.identity.api.AuthDtos.CurrentUser;
import com.fraudcell.identity.api.AuthDtos.OtpChallengeResult;
import com.fraudcell.identity.domain.IdentityUser;
import com.fraudcell.identity.persistence.IdentityRepository;
import com.fraudcell.identity.persistence.IdentityRepository.Session;
import com.fraudcell.identity.persistence.RlsExecutor;
import com.fraudcell.identity.security.SecretTokens;
import com.fraudcell.identity.security.TokenService;
import jakarta.servlet.http.HttpServletRequest;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.Map;
import java.util.UUID;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpStatus;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;
import tools.jackson.databind.ObjectMapper;

@Service
public class AuthService {
    private final IdentityRepository repository;
    private final RlsExecutor rls;
    private final PasswordEncoder passwordEncoder;
    private final TokenService tokens;
    private final AuditService audit;
    private final ObjectMapper mapper;
    private final boolean demoMode;
    private final String otpCode;
    private final long refreshDays;
    private final String dummyPasswordHash;

    public AuthService(IdentityRepository repository, RlsExecutor rls, PasswordEncoder passwordEncoder,
                       TokenService tokens, AuditService audit, ObjectMapper mapper,
                       @Value("${fraudcell.demo.enabled}") boolean demoMode,
                       @Value("${fraudcell.demo.otp-code:1234}") String configuredOtp,
                       @Value("${fraudcell.jwt.refresh-days}") long refreshDays) {
        this.repository = repository;
        this.rls = rls;
        this.passwordEncoder = passwordEncoder;
        this.tokens = tokens;
        this.audit = audit;
        this.mapper = mapper;
        this.demoMode = demoMode;
        this.otpCode = configuredOtp == null || configuredOtp.isBlank() ? "1234" : configuredOtp;
        this.refreshDays = refreshDays;
        this.dummyPasswordHash = passwordEncoder.encode("FraudCell-Dummy-Password-123!");
    }

    public OtpChallengeResult createOtp(String gsm) {
        String normalized = normalizeGsm(gsm);
        return rls.system(() -> {
            Instant expires = Instant.now().plus(5, ChronoUnit.MINUTES);
            UUID id = repository.insertOtp(normalized, SecretTokens.sha256(normalized + ":" + otpCode), expires);
            return new OtpChallengeResult(id, expires);
        });
    }

    public AuthBundle registerCustomer(UUID challengeId, String gsm, String code, String firstName,
                                       String lastName, String email, HttpServletRequest request) {
        String normalized = normalizeGsm(gsm);
        Attempt<AuthBundle> attempt = rls.system(() -> {
            try {
                verifyOtp(challengeId, normalized, code);
            } catch (DomainException exception) {
                return Attempt.failure(exception);
            }
            if (repository.findByGsm(normalized).isPresent()) {
                throw new DomainException(HttpStatus.CONFLICT, "CUSTOMER_ALREADY_EXISTS", "GSM zaten kayıtlı.");
            }
            UUID id = UUID.randomUUID();
            repository.insertCustomer(id, firstName.trim(), lastName.trim(), normalized, email);
            IdentityUser user = repository.findById(id).orElseThrow();
            audit.write(id, "CUSTOMER", "CUSTOMER_REGISTERED", "SUCCESS", "USER", id.toString(), request);
            return Attempt.success(createSession(user));
        });
        return attempt.unwrap();
    }

    public AuthBundle loginCustomer(UUID challengeId, String gsm, String code, HttpServletRequest request) {
        String normalized = normalizeGsm(gsm);
        Attempt<AuthBundle> attempt = rls.system(() -> {
            IdentityUser user = repository.findByGsm(normalized).orElse(null);
            try {
                verifyOtp(challengeId, normalized, code);
            } catch (DomainException exception) {
                audit.write(user == null ? null : user.id(), "CUSTOMER", "LOGIN_CUSTOMER", "FAILURE",
                        "USER", user == null ? normalized : user.id().toString(), request);
                return Attempt.failure(exception);
            }
            if (user == null || user.kind() != IdentityUser.Kind.CUSTOMER || user.status() != IdentityUser.Status.ACTIVE) {
                audit.write(user == null ? null : user.id(), "CUSTOMER", "LOGIN_CUSTOMER", "FAILURE",
                        "USER", user == null ? normalized : user.id().toString(), request);
                return Attempt.failure(unauthorized());
            }
            audit.write(user.id(), "CUSTOMER", "LOGIN_CUSTOMER", "SUCCESS", "USER", user.id().toString(), request);
            return Attempt.success(createSession(user));
        });
        return attempt.unwrap();
    }

    public AuthBundle loginStaff(String email, String password, HttpServletRequest request) {
        Attempt<AuthBundle> attempt = rls.system(() -> {
            IdentityUser user = repository.lockByEmail(email.trim()).orElse(null);
            if (user == null || user.kind() != IdentityUser.Kind.STAFF) {
                passwordEncoder.matches(password, dummyPasswordHash);
                audit.write(null, "ANONYMOUS", "LOGIN_STAFF", "FAILURE", "USER", "unknown", request);
                return Attempt.failure(unauthorized());
            }
            if (user.status() == IdentityUser.Status.DISABLED) {
                audit.write(user.id(), user.role().name(), "LOGIN_STAFF", "DENIED", "USER", user.id().toString(), request);
                return Attempt.failure(new DomainException(HttpStatus.LOCKED, "ACCOUNT_DISABLED", "Personel hesabı devre dışı."));
            }
            if (user.lockedUntil() != null && user.lockedUntil().isAfter(Instant.now())) {
                audit.write(user.id(), user.role().name(), "LOGIN_STAFF", "LOCKED", "USER", user.id().toString(), request);
                long remaining = Math.max(1, java.time.Duration.between(Instant.now(), user.lockedUntil()).toSeconds());
                return Attempt.failure(new DomainException(HttpStatus.LOCKED, "ACCOUNT_LOCKED",
                        "Hesap kilitli; kalan süre " + remaining + " saniye."));
            }
            if (!passwordEncoder.matches(password, user.passwordHash())) {
                boolean lock = user.failedLoginCount() + 1 >= 5;
                repository.registerFailedLogin(user.id(), lock);
                audit.write(user.id(), user.role().name(), "LOGIN_STAFF", "FAILURE", "USER", user.id().toString(), request);
                if (lock) {
                    audit.write(user.id(), user.role().name(), "ACCOUNT_LOCKED", "SUCCESS", "USER", user.id().toString(), request);
                    return Attempt.failure(new DomainException(HttpStatus.LOCKED, "ACCOUNT_LOCKED", "Beş hatalı deneme sonrası hesap 15 dakika kilitlendi."));
                }
                return Attempt.failure(unauthorized());
            }
            repository.clearLoginFailures(user.id());
            IdentityUser active = repository.findById(user.id()).orElseThrow();
            audit.write(active.id(), active.role().name(), "LOGIN_STAFF", "SUCCESS", "USER", active.id().toString(), request);
            return Attempt.success(createSession(active));
        });
        return attempt.unwrap();
    }

    public AuthBundle refresh(String rawRefresh, HttpServletRequest request) {
        if (rawRefresh == null || rawRefresh.isBlank()) throw unauthorized();
        Attempt<AuthBundle> attempt = rls.system(() -> {
            Session current = repository.lockSessionByHash(SecretTokens.sha256(rawRefresh)).orElse(null);
            if (current == null) return Attempt.failure(unauthorized());
            if (current.revokedAt() != null || current.replacedBy() != null) {
                revokeAll(current.userId(), "REFRESH_TOKEN_REUSE", request);
                return Attempt.failure(new DomainException(HttpStatus.UNAUTHORIZED, "REFRESH_REUSE_DETECTED",
                        "Refresh token tekrar kullanıldı; tüm oturumlar kapatıldı."));
            }
            if (!current.expiresAt().isAfter(Instant.now())) return Attempt.failure(unauthorized());
            IdentityUser user = repository.findById(current.userId()).orElse(null);
            if (user == null) return Attempt.failure(unauthorized());
            if (user.status() != IdentityUser.Status.ACTIVE) {
                revokeAll(user.id(), "ACCOUNT_NOT_ACTIVE", request);
                return Attempt.failure(unauthorized());
            }
            String nextRaw = SecretTokens.randomOpaque();
            UUID nextId = UUID.randomUUID();
            repository.rotateSession(current.id(), nextId);
            repository.insertSession(new Session(nextId, current.familyId(), user.id(), SecretTokens.sha256(nextRaw),
                    Instant.now().plus(refreshDays, ChronoUnit.DAYS), null, null));
            var access = tokens.issue(user, nextId);
            return Attempt.success(new AuthBundle(
                    new AuthResult(access.value(), access.expiresIn(), CurrentUser.from(user)), nextRaw));
        });
        return attempt.unwrap();
    }

    public void logout(String rawRefresh, UUID authenticatedUser, HttpServletRequest request) {
        rls.system(() -> {
            UUID userId = authenticatedUser;
            if (rawRefresh != null && !rawRefresh.isBlank()) {
                userId = repository.lockSessionByHash(SecretTokens.sha256(rawRefresh))
                        .map(Session::userId).orElse(userId);
            }
            if (userId != null) revokeAll(userId, "LOGOUT", request);
        });
    }

    public CurrentUser current(UUID userId, String role) {
        return rls.as(userId, role, () -> CurrentUser.from(repository.findById(userId).orElseThrow(AuthService::unauthorized)));
    }

    private AuthBundle createSession(IdentityUser user) {
        String raw = SecretTokens.randomOpaque();
        UUID sessionId = UUID.randomUUID();
        repository.insertSession(new Session(sessionId, sessionId, user.id(), SecretTokens.sha256(raw),
                Instant.now().plus(refreshDays, ChronoUnit.DAYS), null, null));
        var access = tokens.issue(user, sessionId);
        return new AuthBundle(new AuthResult(access.value(), access.expiresIn(), CurrentUser.from(user)), raw);
    }

    private void verifyOtp(UUID challengeId, String gsm, String supplied) {
        if (demoMode && otpCode.equals(supplied)) return;
        if (challengeId == null) throw new DomainException(HttpStatus.UNAUTHORIZED, "OTP_REQUIRED", "OTP isteği gereklidir.");
        var challenge = repository.lockOtp(challengeId, gsm).orElseThrow(AuthService::unauthorized);
        boolean invalid = challenge.usedAt() != null || !challenge.expiresAt().isAfter(Instant.now())
                || challenge.attempts() >= 5
                || !SecretTokens.sha256(gsm + ":" + supplied).equals(challenge.codeHash());
        if (invalid) {
            if (challenge.usedAt() == null && challenge.attempts() < 5) repository.failOtp(challenge.id());
            throw unauthorized();
        }
        repository.useOtp(challenge.id());
    }

    private void revokeAll(UUID userId, String reason, HttpServletRequest request) {
        long epoch = repository.revokeAllSessions(userId);
        UUID requestId = request != null && request.getAttribute("fraudcell.request_id") instanceof UUID id ? id : UUID.randomUUID();
        repository.outbox("sessions.revoked", userId, epoch, requestId, null,
                json(Map.of("user_id", userId.toString(), "session_epoch", epoch, "reason", reason)));
        audit.write(userId, "SYSTEM", "SESSIONS_REVOKED", "SUCCESS", "USER", userId.toString(), request);
    }

    private String json(Object value) {
        try { return mapper.writeValueAsString(value); }
        catch (Exception exception) { throw new IllegalStateException("Event serileştirilemedi", exception); }
    }

    private static String normalizeGsm(String gsm) {
        String value = gsm == null ? "" : gsm.replaceAll("[\\s()-]", "");
        return value.startsWith("+") ? value : "+" + value;
    }

    private static DomainException unauthorized() {
        return new DomainException(HttpStatus.UNAUTHORIZED, "INVALID_CREDENTIALS", "Kimlik bilgileri geçersiz.");
    }

    private record Attempt<T>(T value, DomainException error) {
        static <T> Attempt<T> success(T value) { return new Attempt<>(value, null); }
        static <T> Attempt<T> failure(DomainException error) { return new Attempt<>(null, error); }
        T unwrap() {
            if (error != null) throw error;
            return value;
        }
    }
}
