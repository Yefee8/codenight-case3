CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE identity_users (
    id uuid PRIMARY KEY,
    kind varchar(16) NOT NULL CHECK (kind IN ('CUSTOMER','STAFF')),
    first_name varchar(80) NOT NULL,
    last_name varchar(80) NOT NULL,
    gsm varchar(20) UNIQUE,
    email varchar(254) UNIQUE,
    password_hash text,
    role varchar(16) NOT NULL CHECK (role IN ('CUSTOMER','ANALYST','SUPERVISOR','ADMIN')),
    status varchar(16) NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','LOCKED','DISABLED')),
    title varchar(120) NOT NULL DEFAULT '',
    specialties text[] NOT NULL DEFAULT '{}',
    regions text[] NOT NULL DEFAULT '{}',
    failed_login_count integer NOT NULL DEFAULT 0 CHECK (failed_login_count BETWEEN 0 AND 5),
    locked_until timestamptz,
    session_epoch bigint NOT NULL DEFAULT 0 CHECK (session_epoch >= 0),
    version bigint NOT NULL DEFAULT 1,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CHECK ((kind = 'CUSTOMER' AND gsm IS NOT NULL AND role = 'CUSTOMER') OR
           (kind = 'STAFF' AND email IS NOT NULL AND password_hash IS NOT NULL AND role <> 'CUSTOMER'))
);

CREATE UNIQUE INDEX identity_users_email_lower_uq ON identity_users (lower(email)) WHERE email IS NOT NULL;

CREATE TABLE otp_challenges (
    id uuid PRIMARY KEY,
    gsm varchar(20) NOT NULL,
    code_hash char(64) NOT NULL,
    expires_at timestamptz NOT NULL,
    used_at timestamptz,
    attempts integer NOT NULL DEFAULT 0 CHECK (attempts BETWEEN 0 AND 5),
    created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX otp_challenges_gsm_idx ON otp_challenges (gsm, created_at DESC);

CREATE TABLE auth_sessions (
    id uuid PRIMARY KEY,
    family_id uuid NOT NULL,
    user_id uuid NOT NULL REFERENCES identity_users(id),
    refresh_hash char(64) NOT NULL UNIQUE,
    expires_at timestamptz NOT NULL,
    revoked_at timestamptz,
    replaced_by uuid,
    created_at timestamptz NOT NULL DEFAULT now(),
    last_used_at timestamptz
);
CREATE INDEX auth_sessions_user_idx ON auth_sessions (user_id, expires_at DESC);
CREATE INDEX auth_sessions_family_idx ON auth_sessions (family_id);

CREATE TABLE audit_logs (
    id uuid PRIMARY KEY,
    actor_id uuid,
    actor_role varchar(20) NOT NULL,
    action varchar(80) NOT NULL,
    result varchar(20) NOT NULL,
    resource_type varchar(80),
    resource_id varchar(120),
    ip_address_masked varchar(80) NOT NULL,
    request_id uuid NOT NULL,
    details jsonb NOT NULL DEFAULT '{}',
    occurred_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_logs_occurred_idx ON audit_logs (occurred_at DESC);

CREATE TABLE outbox_events (
    event_id uuid PRIMARY KEY,
    event_type varchar(100) NOT NULL,
    aggregate_id uuid NOT NULL,
    aggregate_version bigint NOT NULL,
    correlation_id uuid NOT NULL,
    causation_id uuid,
    payload jsonb NOT NULL,
    occurred_at timestamptz NOT NULL DEFAULT now(),
    published_at timestamptz,
    attempts integer NOT NULL DEFAULT 0,
    last_error varchar(500)
);
CREATE INDEX outbox_unpublished_idx ON outbox_events (occurred_at) WHERE published_at IS NULL;

CREATE OR REPLACE FUNCTION reject_audit_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    RAISE EXCEPTION 'audit_logs is append-only';
END $$;
CREATE TRIGGER audit_logs_immutable BEFORE UPDATE OR DELETE ON audit_logs
FOR EACH ROW EXECUTE FUNCTION reject_audit_mutation();

ALTER TABLE identity_users ENABLE ROW LEVEL SECURITY;
ALTER TABLE identity_users FORCE ROW LEVEL SECURITY;
CREATE POLICY identity_users_policy ON identity_users
USING (
    current_setting('app.actor_role', true) IN ('SYSTEM','ADMIN') OR
    (current_setting('app.actor_role', true) = 'SUPERVISOR' AND kind = 'STAFF') OR
    id::text = current_setting('app.actor_id', true)
)
WITH CHECK (
    current_setting('app.actor_role', true) IN ('SYSTEM','ADMIN') OR
    id::text = current_setting('app.actor_id', true)
);

ALTER TABLE otp_challenges ENABLE ROW LEVEL SECURITY;
ALTER TABLE otp_challenges FORCE ROW LEVEL SECURITY;
CREATE POLICY otp_system_policy ON otp_challenges
USING (current_setting('app.actor_role', true) = 'SYSTEM')
WITH CHECK (current_setting('app.actor_role', true) = 'SYSTEM');

ALTER TABLE auth_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE auth_sessions FORCE ROW LEVEL SECURITY;
CREATE POLICY sessions_policy ON auth_sessions
USING (
    current_setting('app.actor_role', true) IN ('SYSTEM','ADMIN') OR
    user_id::text = current_setting('app.actor_id', true)
)
WITH CHECK (
    current_setting('app.actor_role', true) IN ('SYSTEM','ADMIN') OR
    user_id::text = current_setting('app.actor_id', true)
);

ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_logs FORCE ROW LEVEL SECURITY;
CREATE POLICY audit_insert_policy ON audit_logs FOR INSERT
WITH CHECK (current_setting('app.actor_role', true) IN ('SYSTEM','ADMIN'));
CREATE POLICY audit_read_policy ON audit_logs FOR SELECT
USING (current_setting('app.actor_role', true) IN ('SYSTEM','ADMIN'));

ALTER TABLE outbox_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE outbox_events FORCE ROW LEVEL SECURITY;
CREATE POLICY outbox_system_policy ON outbox_events
USING (current_setting('app.actor_role', true) = 'SYSTEM')
WITH CHECK (current_setting('app.actor_role', true) = 'SYSTEM');
