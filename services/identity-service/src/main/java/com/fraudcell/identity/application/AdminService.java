package com.fraudcell.identity.application;

import com.fraudcell.identity.api.AdminDtos;
import com.fraudcell.identity.api.ApiSupport.DomainException;
import com.fraudcell.identity.domain.IdentityUser;
import com.fraudcell.identity.persistence.IdentityRepository;
import com.fraudcell.identity.persistence.RlsExecutor;
import com.fraudcell.identity.security.PasswordPolicy;
import jakarta.servlet.http.HttpServletRequest;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.UUID;
import org.springframework.http.HttpStatus;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;
import tools.jackson.databind.ObjectMapper;

@Service
public class AdminService {
    private final IdentityRepository repository;
    private final RlsExecutor rls;
    private final PasswordEncoder passwords;
    private final AuditService audit;
    private final ObjectMapper mapper;

    public AdminService(IdentityRepository repository, RlsExecutor rls, PasswordEncoder passwords,
                        AuditService audit, ObjectMapper mapper) {
        this.repository = repository;
        this.rls = rls;
        this.passwords = passwords;
        this.audit = audit;
        this.mapper = mapper;
    }

    public AdminDtos.StaffView create(AdminDtos.CreateStaffRequest body, UUID actorId,
                                      UUID correlationId, HttpServletRequest request) {
        validateRole(body.role());
        if (!PasswordPolicy.valid(body.password())) {
            throw new DomainException(HttpStatus.UNPROCESSABLE_ENTITY, "WEAK_PASSWORD",
                    "Şifre en az 8 karakter, büyük harf, rakam ve özel karakter içermelidir.");
        }
        return rls.as(actorId, "ADMIN", () -> {
            UUID id = UUID.randomUUID();
            IdentityUser staff = new IdentityUser(id, IdentityUser.Kind.STAFF,
                    body.firstName().trim(), body.lastName().trim(), null, body.email().trim().toLowerCase(),
                    passwords.encode(body.password()), body.role(), IdentityUser.Status.ACTIVE,
                    body.title().trim(), clean(body.specialties()), clean(body.regions()), 0, null, 0, 1);
            repository.insertStaff(staff);
            repository.outbox("staff.created", id, 1, correlationId, null, json(staffPayload(staff)));
            audit.write(actorId, "ADMIN", "STAFF_CREATED", "SUCCESS", "STAFF", id.toString(), request);
            return AdminDtos.StaffView.from(staff);
        });
    }

    public AdminDtos.StaffView update(UUID staffId, AdminDtos.UpdateStaffRequest body, UUID actorId,
                                      UUID correlationId, HttpServletRequest request) {
        if (body.role() != null) validateRole(body.role());
        return rls.as(actorId, "ADMIN", () -> {
            IdentityUser old = repository.findById(staffId)
                    .filter(user -> user.kind() == IdentityUser.Kind.STAFF)
                    .orElseThrow(() -> new DomainException(HttpStatus.NOT_FOUND, "STAFF_NOT_FOUND", "Personel bulunamadı."));
            IdentityUser.Role role = body.role() == null ? old.role() : body.role();
            IdentityUser.Status status = body.status() == null ? old.status() : body.status();
            if (status == IdentityUser.Status.LOCKED) {
                throw new DomainException(HttpStatus.UNPROCESSABLE_ENTITY, "INVALID_STATUS", "LOCKED durumu yalnızca güvenlik süreciyle oluşur.");
            }
            boolean roleChanged = role != old.role();
            boolean statusChanged = status != old.status();
            List<String> nextSpecialties = body.specialties() == null ? old.specialties() : clean(body.specialties());
            List<String> nextRegions = body.regions() == null ? old.regions() : clean(body.regions());
            boolean assignmentProfileChanged = !old.specialties().equals(nextSpecialties)
                    || !old.regions().equals(nextRegions);
            long epoch = old.sessionEpoch();
            if (roleChanged || assignmentProfileChanged || (statusChanged && status == IdentityUser.Status.DISABLED)) {
                epoch = repository.revokeAllSessions(old.id());
            }
            IdentityUser updated = new IdentityUser(old.id(), old.kind(), old.firstName(), old.lastName(),
                    old.gsm(), old.email(), old.passwordHash(), role, status,
                    body.title() == null ? old.title() : body.title().trim(),
                    nextSpecialties, nextRegions,
                    old.failedLoginCount(), old.lockedUntil(), epoch, old.version() + 1);
            repository.updateStaff(updated);

            List<String> changed = changedFields(old, updated);
            if (!changed.isEmpty()) {
                Map<String, Object> payload = new LinkedHashMap<>(staffPayload(updated));
                Map<String, Object> changedValues = new LinkedHashMap<>();
                for (String field : changed) {
                    switch (field) {
                        case "role" -> changedValues.put(field, updated.role().name());
                        case "status" -> changedValues.put(field, updated.status().name());
                        case "title" -> changedValues.put(field, updated.title());
                        case "specialties" -> changedValues.put(field, updated.specialties());
                        case "regions" -> changedValues.put(field, updated.regions());
                        default -> { }
                    }
                }
                payload.put("changed_fields", changedValues);
                repository.outbox("staff.profile-updated", staffId, updated.version(), correlationId, null, json(payload));
            }
            if (statusChanged) {
                Map<String, Object> statusPayload = new LinkedHashMap<>(staffPayload(updated));
                statusPayload.put("staff_id", staffId.toString());
                repository.outbox("staff.status-changed", staffId, updated.version(), correlationId, null,
                        json(statusPayload));
            }
            if (roleChanged) {
                Map<String, Object> rolePayload = new LinkedHashMap<>(staffPayload(updated));
                rolePayload.put("user_id", staffId.toString());
                rolePayload.put("roles", List.of(role.name()));
                rolePayload.put("session_epoch", epoch);
                repository.outbox("role.changed", staffId, updated.version(), correlationId, null,
                        json(rolePayload));
            }
            if (roleChanged || assignmentProfileChanged || (statusChanged && status == IdentityUser.Status.DISABLED)) {
                String reason = roleChanged ? "ROLE_CHANGED"
                        : assignmentProfileChanged ? "ASSIGNMENT_PROFILE_CHANGED" : "ACCOUNT_DISABLED";
                repository.outbox("sessions.revoked", staffId, epoch, correlationId, null,
                        json(Map.of("user_id", staffId.toString(), "session_epoch", epoch,
                                "reason", reason)));
            }
            audit.write(actorId, "ADMIN", roleChanged ? "STAFF_ROLE_CHANGED" : "STAFF_UPDATED",
                    "SUCCESS", "STAFF", staffId.toString(), request,
                    json(Map.of("reason", body.reason(), "changed_fields", changed)));
            return AdminDtos.StaffView.from(updated);
        });
    }

    public AdminDtos.Page<AdminDtos.StaffView> list(int page, int size, UUID actorId, String actorRole) {
        return rls.as(actorId, actorRole, () -> new AdminDtos.Page<>(repository.listStaff(size, page * size)
                .stream().map(AdminDtos.StaffView::from).toList(), page, size, repository.countStaff()));
    }

    public AdminDtos.Page<AdminDtos.AuditView> audit(int page, int size, UUID actorId) {
        return rls.as(actorId, "ADMIN", () -> new AdminDtos.Page<>(repository.listAudit(size, page * size).stream()
                .map(row -> new AdminDtos.AuditView(row.id(), row.actorId(), row.action(), row.result(),
                        row.resourceType(), row.resourceId(), row.ipAddressMasked(), row.occurredAt())).toList(),
                page, size, repository.countAudit()));
    }

    private static void validateRole(IdentityUser.Role role) {
        if (role == null || role == IdentityUser.Role.CUSTOMER) {
            throw new DomainException(HttpStatus.UNPROCESSABLE_ENTITY, "INVALID_STAFF_ROLE", "Personel rolü geçersiz.");
        }
    }

    private static List<String> clean(List<String> values) {
        if (values == null) return List.of();
        return values.stream().filter(Objects::nonNull).map(String::trim).filter(value -> !value.isBlank())
                .distinct().toList();
    }

    private static List<String> changedFields(IdentityUser old, IdentityUser updated) {
        List<String> fields = new ArrayList<>();
        if (old.role() != updated.role()) fields.add("role");
        if (old.status() != updated.status()) fields.add("status");
        if (!old.title().equals(updated.title())) fields.add("title");
        if (!old.specialties().equals(updated.specialties())) fields.add("specialties");
        if (!old.regions().equals(updated.regions())) fields.add("regions");
        return fields;
    }

    private static Map<String, Object> staffPayload(IdentityUser user) {
        Map<String, Object> payload = new LinkedHashMap<>();
        payload.put("staff_id", user.id().toString());
        payload.put("first_name", user.firstName());
        payload.put("last_name", user.lastName());
        payload.put("name", user.firstName() + " " + user.lastName());
        payload.put("display_name", user.firstName() + " " + user.lastName());
        payload.put("email", user.email());
        payload.put("role", user.role().name());
        payload.put("status", user.status().name());
        payload.put("locked", user.status() == IdentityUser.Status.LOCKED);
        payload.put("title", user.title());
        payload.put("specialties", user.specialties());
        payload.put("regions", user.regions());
        return payload;
    }

    private String json(Object value) {
        try { return mapper.writeValueAsString(value); }
        catch (Exception exception) { throw new IllegalStateException("Event serileştirilemedi", exception); }
    }
}
