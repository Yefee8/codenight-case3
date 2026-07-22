package com.fraudcell.identity.api;

import com.fraudcell.identity.domain.IdentityUser;
import jakarta.validation.constraints.Email;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;
import java.time.Instant;
import java.util.List;
import java.util.UUID;

public final class AuthDtos {
    private AuthDtos() {}

    public record OtpChallengeRequest(
            @NotBlank @Pattern(regexp = "^\\+?[1-9][0-9]{9,14}$") String gsm) {}

    public record OtpChallengeResult(UUID challengeId, Instant expiresAt) {}

    public record CustomerRegisterRequest(
            UUID challengeId,
            @NotBlank @Pattern(regexp = "^\\+?[1-9][0-9]{9,14}$") String gsm,
            @NotBlank @Pattern(regexp = "^[0-9]{4,8}$") String otpCode,
            @NotBlank @Size(max = 80) String firstName,
            @NotBlank @Size(max = 80) String lastName,
            @Email @Size(max = 254) String email) {}

    public record CustomerLoginRequest(
            UUID challengeId,
            @NotBlank @Pattern(regexp = "^\\+?[1-9][0-9]{9,14}$") String gsm,
            @NotBlank @Pattern(regexp = "^[0-9]{4,8}$") String otpCode) {}

    public record StaffLoginRequest(
            @NotBlank @Email @Size(max = 254) String email,
            @NotBlank @Size(max = 200) String password) {}

    public record CurrentUser(
            UUID id, String firstName, String lastName, IdentityUser.Role role,
            List<String> specialties, List<String> regions) {
        public static CurrentUser from(IdentityUser user) {
            return new CurrentUser(user.id(), user.firstName(), user.lastName(), user.role(),
                    user.specialties(), user.regions());
        }
    }

    public record AuthResult(String accessToken, long expiresIn, CurrentUser user) {}
    public record AuthBundle(AuthResult result, String refreshToken) {}
}
