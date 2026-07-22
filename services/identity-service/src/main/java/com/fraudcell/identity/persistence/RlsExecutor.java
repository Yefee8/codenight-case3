package com.fraudcell.identity.persistence;

import java.util.UUID;
import java.util.function.Supplier;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;
import org.springframework.transaction.support.TransactionTemplate;

@Component
public class RlsExecutor {
    private final JdbcTemplate jdbc;
    private final TransactionTemplate transactions;

    public RlsExecutor(JdbcTemplate jdbc, TransactionTemplate transactions) {
        this.jdbc = jdbc;
        this.transactions = transactions;
    }

    public <T> T system(Supplier<T> work) {
        return execute(null, "SYSTEM", work);
    }

    public <T> T as(UUID actorId, String actorRole, Supplier<T> work) {
        return execute(actorId, actorRole, work);
    }

    public void system(Runnable work) {
        system(() -> { work.run(); return null; });
    }

    public void as(UUID actorId, String actorRole, Runnable work) {
        as(actorId, actorRole, () -> { work.run(); return null; });
    }

    private <T> T execute(UUID actorId, String actorRole, Supplier<T> work) {
        return transactions.execute(status -> {
            jdbc.queryForObject("select set_config('app.actor_id', ?, true)", String.class,
                    actorId == null ? "" : actorId.toString());
            jdbc.queryForObject("select set_config('app.actor_role', ?, true)", String.class, actorRole);
            return work.get();
        });
    }
}
