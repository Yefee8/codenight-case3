CREATE FUNCTION app_actor_role() RETURNS text LANGUAGE sql STABLE PARALLEL SAFE
RETURN nullif(current_setting('app.actor_role', true), '');
CREATE FUNCTION app_actor_id() RETURNS uuid LANGUAGE sql STABLE PARALLEL SAFE
RETURN nullif(current_setting('app.actor_id', true), '')::uuid;

ALTER TABLE transactions ENABLE ROW LEVEL SECURITY; ALTER TABLE transactions FORCE ROW LEVEL SECURITY;
ALTER TABLE risk_cases ENABLE ROW LEVEL SECURITY; ALTER TABLE risk_cases FORCE ROW LEVEL SECURITY;
ALTER TABLE case_status_history ENABLE ROW LEVEL SECURITY; ALTER TABLE case_status_history FORCE ROW LEVEL SECURITY;
ALTER TABLE case_notes ENABLE ROW LEVEL SECURITY; ALTER TABLE case_notes FORCE ROW LEVEL SECURITY;
ALTER TABLE case_feedback ENABLE ROW LEVEL SECURITY; ALTER TABLE case_feedback FORCE ROW LEVEL SECURITY;
ALTER TABLE staff_projection ENABLE ROW LEVEL SECURITY; ALTER TABLE staff_projection FORCE ROW LEVEL SECURITY;
ALTER TABLE idempotency_records ENABLE ROW LEVEL SECURITY; ALTER TABLE idempotency_records FORCE ROW LEVEL SECURITY;
ALTER TABLE inbox_events ENABLE ROW LEVEL SECURITY; ALTER TABLE inbox_events FORCE ROW LEVEL SECURITY;
ALTER TABLE outbox_events ENABLE ROW LEVEL SECURITY; ALTER TABLE outbox_events FORCE ROW LEVEL SECURITY;

CREATE POLICY transactions_read ON transactions FOR SELECT USING (
    app_actor_role() IN ('SUPERVISOR','ADMIN','SERVICE')
    OR (app_actor_role() = 'CUSTOMER' AND customer_id = app_actor_id())
    OR (app_actor_role() = 'ANALYST' AND EXISTS (
        SELECT 1 FROM risk_cases c WHERE c.transaction_id = transactions.id
          AND c.assigned_analyst_id = app_actor_id()))
);
CREATE POLICY transactions_write ON transactions FOR INSERT WITH CHECK (
    app_actor_role() = 'SERVICE' OR (app_actor_role() = 'CUSTOMER' AND customer_id = app_actor_id()));

CREATE POLICY cases_read ON risk_cases FOR SELECT USING (
    app_actor_role() IN ('SUPERVISOR','ADMIN','SERVICE')
    OR (app_actor_role() = 'CUSTOMER' AND customer_id = app_actor_id())
    OR (app_actor_role() = 'ANALYST' AND assigned_analyst_id = app_actor_id())
);
CREATE POLICY cases_insert ON risk_cases FOR INSERT WITH CHECK (
    app_actor_role() = 'SERVICE' OR (app_actor_role() = 'CUSTOMER' AND customer_id = app_actor_id()));
CREATE POLICY cases_update ON risk_cases FOR UPDATE USING (
    app_actor_role() IN ('SUPERVISOR','SERVICE')
    OR (app_actor_role() = 'CUSTOMER' AND customer_id = app_actor_id())
    OR (app_actor_role() = 'ANALYST' AND assigned_analyst_id = app_actor_id())
) WITH CHECK (
    app_actor_role() IN ('SUPERVISOR','SERVICE')
    OR (app_actor_role() = 'CUSTOMER' AND customer_id = app_actor_id())
    OR (app_actor_role() = 'ANALYST' AND assigned_analyst_id = app_actor_id())
);

CREATE POLICY history_read ON case_status_history FOR SELECT USING (
    app_actor_role() IN ('SUPERVISOR','ADMIN','SERVICE') OR EXISTS (
      SELECT 1 FROM risk_cases c WHERE c.id = case_id AND
       ((app_actor_role()='CUSTOMER' AND c.customer_id=app_actor_id()) OR
        (app_actor_role()='ANALYST' AND c.assigned_analyst_id=app_actor_id()))));
CREATE POLICY history_insert ON case_status_history FOR INSERT WITH CHECK (
    app_actor_role() IN ('CUSTOMER','ANALYST','SUPERVISOR','SERVICE'));

CREATE POLICY notes_read ON case_notes FOR SELECT USING (
    app_actor_role() IN ('SUPERVISOR','ADMIN','SERVICE') OR EXISTS (
      SELECT 1 FROM risk_cases c WHERE c.id = case_id AND c.assigned_analyst_id=app_actor_id()));
CREATE POLICY notes_insert ON case_notes FOR INSERT WITH CHECK (app_actor_role() IN ('ANALYST','SUPERVISOR','SERVICE'));

CREATE POLICY feedback_read ON case_feedback FOR SELECT USING (
    app_actor_role() IN ('SUPERVISOR','ADMIN','SERVICE') OR customer_id=app_actor_id());
CREATE POLICY feedback_insert ON case_feedback FOR INSERT WITH CHECK (
    app_actor_role()='SERVICE' OR (app_actor_role()='CUSTOMER' AND customer_id=app_actor_id()));

CREATE POLICY staff_read ON staff_projection FOR SELECT USING (
    app_actor_role() IN ('ANALYST','SUPERVISOR','ADMIN','SERVICE'));
CREATE POLICY staff_service_write ON staff_projection FOR ALL USING (app_actor_role()='SERVICE') WITH CHECK (app_actor_role()='SERVICE');

CREATE POLICY idempotency_own ON idempotency_records FOR ALL USING (
    app_actor_role()='SERVICE' OR actor_id=app_actor_id()) WITH CHECK (
    app_actor_role()='SERVICE' OR actor_id=app_actor_id());
CREATE POLICY inbox_service ON inbox_events FOR ALL USING (app_actor_role()='SERVICE') WITH CHECK (app_actor_role()='SERVICE');
CREATE POLICY outbox_insert ON outbox_events FOR INSERT WITH CHECK (
    app_actor_role() IN ('CUSTOMER','ANALYST','SUPERVISOR','SERVICE'));
CREATE POLICY outbox_service ON outbox_events FOR SELECT USING (app_actor_role()='SERVICE');
CREATE POLICY outbox_service_update ON outbox_events FOR UPDATE USING (app_actor_role()='SERVICE') WITH CHECK (app_actor_role()='SERVICE');
