package com.fraudcell.transaction.security;

import java.util.Set;
import java.util.UUID;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;

@Component
public class RlsContext {
    private static final Set<String> ROLES = Set.of("CUSTOMER","ANALYST","SUPERVISOR","ADMIN","SERVICE");
    private static final UUID SERVICE_ID = new UUID(0, 0);
    private final JdbcTemplate jdbc;
    public RlsContext(JdbcTemplate jdbc) { this.jdbc = jdbc; }
    @Transactional(propagation = Propagation.MANDATORY)
    public void apply(UUID actorId, String role) {
        if (!ROLES.contains(role)) throw new IllegalArgumentException("invalid RLS role");
        jdbc.queryForObject("SELECT set_config('app.actor_id', ?, true)", String.class, actorId.toString());
        jdbc.queryForObject("SELECT set_config('app.actor_role', ?, true)", String.class, role);
        jdbc.queryForObject("SELECT set_config('app.service_name', 'transaction-service', true)", String.class);
    }
    @Transactional(propagation = Propagation.MANDATORY)
    public void service() { apply(SERVICE_ID, "SERVICE"); }
}
