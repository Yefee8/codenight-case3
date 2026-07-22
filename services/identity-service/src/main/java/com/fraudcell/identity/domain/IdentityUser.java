package com.fraudcell.identity.domain;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

public record IdentityUser(
        UUID id,
        Kind kind,
        String firstName,
        String lastName,
        String gsm,
        String email,
        String passwordHash,
        Role role,
        Status status,
        String title,
        List<String> specialties,
        List<String> regions,
        int failedLoginCount,
        Instant lockedUntil,
        long sessionEpoch,
        long version) {

    public enum Kind { CUSTOMER, STAFF }
    public enum Role { CUSTOMER, ANALYST, SUPERVISOR, ADMIN }
    public enum Status { ACTIVE, LOCKED, DISABLED }
}
