package com.fraudcell.identity.application;

import com.fraudcell.identity.domain.IdentityUser;
import com.fraudcell.identity.persistence.IdentityRepository;
import com.fraudcell.identity.persistence.RlsExecutor;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.ApplicationArguments;
import org.springframework.boot.ApplicationRunner;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Component;
import tools.jackson.databind.ObjectMapper;

@Component
public class DemoDataSeeder implements ApplicationRunner {
    private static final List<String> ALL_SPECIALTIES = List.of(
            "CALINTI_KART", "HESAP_ELE_GECIRME", "PARA_AKLAMA", "SUPHELI_DAVRANIS", "TEMIZ");
    private static final List<String> ALL_REGIONS = List.of(
            "MARMARA", "EGE", "IC_ANADOLU", "AKDENIZ", "KARADENIZ", "DOGU_ANADOLU", "GUNEYDOGU_ANADOLU");

    private final boolean enabled;
    private final IdentityRepository repository;
    private final RlsExecutor rls;
    private final PasswordEncoder passwords;
    private final ObjectMapper mapper;

    public DemoDataSeeder(@Value("${fraudcell.demo.enabled}") boolean enabled,
                          IdentityRepository repository, RlsExecutor rls,
                          PasswordEncoder passwords, ObjectMapper mapper) {
        this.enabled = enabled;
        this.repository = repository;
        this.rls = rls;
        this.passwords = passwords;
        this.mapper = mapper;
    }

    @Override
    public void run(ApplicationArguments args) {
        if (!enabled) return;
        rls.system(() -> {
            if (repository.findByGsm("+905551111111").isEmpty()) {
                repository.insertCustomer(UUID.randomUUID(), "Demo", "Müşteri", "+905551111111", "customer@fraudcell.local");
            }
            seedStaff("admin@fraudcell.local", "Demo", "Admin", "Admin123!",
                    IdentityUser.Role.ADMIN, "Sistem Yöneticisi", List.of(), ALL_REGIONS);
            seedStaff("supervisor@fraudcell.local", "Demo", "Supervisor", "Supervisor123!",
                    IdentityUser.Role.SUPERVISOR, "Fraud Operasyon Yöneticisi", ALL_SPECIALTIES, ALL_REGIONS);
            seedStaff("analyst1@fraudcell.local", "Ayşe", "Analist", "Analyst123!",
                    IdentityUser.Role.ANALYST, "Fraud Analisti", ALL_SPECIALTIES, ALL_REGIONS);
            seedStaff("analyst2@fraudcell.local", "Mehmet", "Analist", "Analyst123!",
                    IdentityUser.Role.ANALYST, "Fraud Analisti", ALL_SPECIALTIES, ALL_REGIONS);
            seedStaff("analyst3@fraudcell.local", "Zeynep", "Analist", "Analyst123!",
                    IdentityUser.Role.ANALYST, "Fraud Analisti", ALL_SPECIALTIES, ALL_REGIONS);
        });
    }

    private void seedStaff(String email, String firstName, String lastName, String password,
                           IdentityUser.Role role, String title, List<String> specialties, List<String> regions) {
        if (repository.findByEmail(email).isPresent()) return;
        UUID id = UUID.randomUUID();
        IdentityUser staff = new IdentityUser(id, IdentityUser.Kind.STAFF, firstName, lastName, null, email,
                passwords.encode(password), role, IdentityUser.Status.ACTIVE, title,
                specialties, regions, 0, null, 0, 1);
        repository.insertStaff(staff);
        Map<String, Object> payload = new LinkedHashMap<>();
        payload.put("staff_id", id.toString());
        payload.put("first_name", firstName);
        payload.put("last_name", lastName);
        payload.put("name", firstName + " " + lastName);
        payload.put("display_name", firstName + " " + lastName);
        payload.put("email", email);
        payload.put("role", role.name());
        payload.put("status", "ACTIVE");
        payload.put("locked", false);
        payload.put("title", title);
        payload.put("specialties", specialties);
        payload.put("regions", regions);
        repository.outbox("staff.created", id, 1, UUID.randomUUID(), null, json(payload));
    }

    private String json(Object value) {
        try { return mapper.writeValueAsString(value); }
        catch (Exception exception) { throw new IllegalStateException(exception); }
    }
}
