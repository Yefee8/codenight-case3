-- Case facts may arrive before assignment; null means "not assigned yet", not a
-- missing authorization context. The consumer fills it when case.assigned lands.
ALTER TABLE case_facts ALTER COLUMN analyst_id DROP NOT NULL;
ALTER TABLE case_facts ADD COLUMN ground_truth VARCHAR(20)
    CHECK (ground_truth IN ('FRAUD', 'LEGITIMATE'));
ALTER TABLE case_facts ADD COLUMN ground_truth_fraud_type VARCHAR(50);
ALTER TABLE case_facts ADD COLUMN within_sla BOOLEAN;

-- A later/out-of-order event may reconcile an earlier fact. This business key,
-- rather than event id alone, prevents the same case rule being paid twice.
CREATE UNIQUE INDEX uq_point_ledger_case_reason
    ON point_ledger (case_id, reason)
    WHERE case_id IS NOT NULL AND reason <> 'CORRECTION';

-- Leaderboards and public analyst game profiles are derived, non-sensitive staff
-- views. Analysts may see them, while case facts and ledger detail remain own-row.
DROP POLICY analyst_profiles_read ON analyst_profiles;
CREATE POLICY analyst_profiles_read ON analyst_profiles FOR SELECT USING (
    app_role() IN ('ANALYST', 'SUPERVISOR', 'ADMIN', 'SERVICE')
);

DROP POLICY earned_badges_read ON earned_badges;
CREATE POLICY earned_badges_read ON earned_badges FOR SELECT USING (
    app_role() IN ('ANALYST', 'SUPERVISOR', 'ADMIN', 'SERVICE')
);

DROP POLICY daily_stats_read ON daily_stats;
CREATE POLICY daily_stats_read ON daily_stats FOR SELECT USING (
    app_role() IN ('ANALYST', 'SUPERVISOR', 'ADMIN', 'SERVICE')
);

DROP POLICY weekly_stats_read ON weekly_stats;
CREATE POLICY weekly_stats_read ON weekly_stats FOR SELECT USING (
    app_role() IN ('ANALYST', 'SUPERVISOR', 'ADMIN', 'SERVICE')
);
