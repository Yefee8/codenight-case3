package com.fraudcell.identity.api;

import com.fraudcell.identity.domain.IdentityUser;
import jakarta.validation.constraints.Email;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;
import java.time.Instant;
import java.util.List;
import java.util.UUID;

public final class AdminDtos {
    private AdminDtos() {}

    public record CreateStaffRequest(
            @NotBlank @Size(max = 80) String firstName,
            @NotBlank @Size(max = 80) String lastName,
            @NotBlank @Email @Size(max = 254) String email,
            @NotBlank @Size(max = 200) String password,
            @NotNull IdentityUser.Role role,
            @NotBlank @Size(max = 120) String title,
            List<@NotBlank @Size(max = 80) String> specialties,
            List<@NotBlank @Size(max = 80) String> regions) {}

    public record UpdateStaffRequest(
            IdentityUser.Role role,
            IdentityUser.Status status,
            @Size(max = 120) String title,
            List<@NotBlank @Size(max = 80) String> specialties,
            List<@NotBlank @Size(max = 80) String> regions,
            @NotBlank @Size(max = 300) String reason) {}

    public record StaffView(
            UUID id, String firstName, String lastName, String email, IdentityUser.Role role,
            IdentityUser.Status status, String title, List<String> specialties, List<String> regions) {
        public static StaffView from(IdentityUser user) {
            return new StaffView(user.id(), user.firstName(), user.lastName(), user.email(), user.role(),
                    user.status(), user.title(), user.specialties(), user.regions());
        }
    }

    public record AuditView(UUID id, UUID actorId, String action, String result, String resourceType,
                            String resourceId, String ipAddressMasked, Instant occurredAt) {}

    public record Page<T>(List<T> items, int page, int size, long total) {}
}
