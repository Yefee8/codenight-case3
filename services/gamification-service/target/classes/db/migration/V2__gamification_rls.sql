-- The runtime role is deliberately NOSUPERUSER/NOBYPASSRLS and does not own
-- these tables. Every transaction must set app.user_id/app.role locally.
CREATE FUNCTION app_role() RETURNS text
LANGUAGE sql STABLE PARALLEL SAFE
RETURN nullif(current_setting('app.role', true), '');

CREATE FUNCTION app_user_id() RETURNS uuid
LANGUAGE sql STABLE PARALLEL SAFE
RETURN nullif(current_setting('app.user_id', true), '')::uuid;

ALTER TABLE analyst_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE analyst_profiles FORCE ROW LEVEL SECURITY;
ALTER TABLE badges ENABLE ROW LEVEL SECURITY;
ALTER TABLE badges FORCE ROW LEVEL SECURITY;
ALTER TABLE earned_badges ENABLE ROW LEVEL SECURITY;
ALTER TABLE earned_badges FORCE ROW LEVEL SECURITY;
ALTER TABLE case_facts ENABLE ROW LEVEL SECURITY;
ALTER TABLE case_facts FORCE ROW LEVEL SECURITY;
ALTER TABLE point_ledger ENABLE ROW LEVEL SECURITY;
ALTER TABLE point_ledger FORCE ROW LEVEL SECURITY;
ALTER TABLE daily_stats ENABLE ROW LEVEL SECURITY;
ALTER TABLE daily_stats FORCE ROW LEVEL SECURITY;
ALTER TABLE weekly_stats ENABLE ROW LEVEL SECURITY;
ALTER TABLE weekly_stats FORCE ROW LEVEL SECURITY;
ALTER TABLE inbox_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE inbox_events FORCE ROW LEVEL SECURITY;
ALTER TABLE outbox_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE outbox_events FORCE ROW LEVEL SECURITY;

CREATE POLICY analyst_profiles_read ON analyst_profiles FOR SELECT USING (
    app_role() IN ('SUPERVISOR', 'ADMIN', 'SERVICE')
    OR (app_role() = 'ANALYST' AND analyst_id = app_user_id())
);
CREATE POLICY analyst_profiles_service_write ON analyst_profiles FOR ALL
    USING (app_role() = 'SERVICE') WITH CHECK (app_role() = 'SERVICE');

CREATE POLICY badges_read ON badges FOR SELECT USING (
    app_role() IN ('ANALYST', 'SUPERVISOR', 'ADMIN', 'SERVICE')
);
CREATE POLICY badges_service_write ON badges FOR ALL
    USING (app_role() = 'SERVICE') WITH CHECK (app_role() = 'SERVICE');

CREATE POLICY earned_badges_read ON earned_badges FOR SELECT USING (
    app_role() IN ('SUPERVISOR', 'ADMIN', 'SERVICE')
    OR (app_role() = 'ANALYST' AND analyst_id = app_user_id())
);
CREATE POLICY earned_badges_service_write ON earned_badges FOR ALL
    USING (app_role() = 'SERVICE') WITH CHECK (app_role() = 'SERVICE');

CREATE POLICY case_facts_read ON case_facts FOR SELECT USING (
    app_role() IN ('SUPERVISOR', 'ADMIN', 'SERVICE')
    OR (app_role() = 'ANALYST' AND analyst_id = app_user_id())
);
CREATE POLICY case_facts_service_write ON case_facts FOR ALL
    USING (app_role() = 'SERVICE') WITH CHECK (app_role() = 'SERVICE');

CREATE POLICY point_ledger_read ON point_ledger FOR SELECT USING (
    app_role() IN ('SUPERVISOR', 'ADMIN', 'SERVICE')
    OR (app_role() = 'ANALYST' AND analyst_id = app_user_id())
);
CREATE POLICY point_ledger_service_write ON point_ledger FOR ALL
    USING (app_role() = 'SERVICE') WITH CHECK (app_role() = 'SERVICE');

CREATE POLICY daily_stats_read ON daily_stats FOR SELECT USING (
    app_role() IN ('SUPERVISOR', 'ADMIN', 'SERVICE')
    OR (app_role() = 'ANALYST' AND analyst_id = app_user_id())
);
CREATE POLICY daily_stats_service_write ON daily_stats FOR ALL
    USING (app_role() = 'SERVICE') WITH CHECK (app_role() = 'SERVICE');

CREATE POLICY weekly_stats_read ON weekly_stats FOR SELECT USING (
    app_role() IN ('SUPERVISOR', 'ADMIN', 'SERVICE')
    OR (app_role() = 'ANALYST' AND analyst_id = app_user_id())
);
CREATE POLICY weekly_stats_service_write ON weekly_stats FOR ALL
    USING (app_role() = 'SERVICE') WITH CHECK (app_role() = 'SERVICE');

CREATE POLICY inbox_events_service_only ON inbox_events FOR ALL
    USING (app_role() = 'SERVICE') WITH CHECK (app_role() = 'SERVICE');
CREATE POLICY outbox_events_service_only ON outbox_events FOR ALL
    USING (app_role() = 'SERVICE') WITH CHECK (app_role() = 'SERVICE');

-- Runtime privileges are granted by the DB bootstrap's ALTER DEFAULT PRIVILEGES.
-- This assertion-like block prevents accidental owner/superuser deployments.
DO $$
DECLARE
    runtime_role text := current_setting('fraudcell.runtime_role', true);
BEGIN
    IF runtime_role IS NOT NULL AND runtime_role <> '' AND EXISTS (
        SELECT 1 FROM pg_roles
        WHERE rolname = runtime_role AND (rolsuper OR rolbypassrls)
    ) THEN
        RAISE EXCEPTION 'runtime role % must be NOSUPERUSER NOBYPASSRLS', runtime_role;
    END IF;
END;
$$;
