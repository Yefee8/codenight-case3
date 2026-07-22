package com.fraudcell.gamification.security;

import java.util.Set;
import java.util.UUID;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;

@Component
public class RlsContext {
    private static final Set<String> ROLES = Set.of("ANALYST", "SUPERVISOR", "ADMIN", "SERVICE");
    private static final UUID SERVICE_ID = new UUID(0, 0);
    private final JdbcTemplate jdbc;

    public RlsContext(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    @Transactional(propagation = Propagation.MANDATORY)
    public void apply(UUID userId, String role) {
        if (!ROLES.contains(role)) {
            throw new IllegalArgumentException("invalid RLS role");
        }
        jdbc.queryForObject(
                "SELECT set_config('app.user_id', ?, true), set_config('app.role', ?, true)",
                (rs, rowNum) -> rs.getString(1), userId.toString(), role);
    }

    @Transactional(propagation = Propagation.MANDATORY)
    public void applyService() {
        apply(SERVICE_ID, "SERVICE");
    }
}
