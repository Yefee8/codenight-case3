CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE SEQUENCE transaction_number_seq;

CREATE TABLE transactions (
    id UUID PRIMARY KEY,
    transaction_number VARCHAR(32) NOT NULL UNIQUE,
    customer_id UUID NOT NULL,
    amount NUMERIC(19,2) NOT NULL CHECK (amount > 0),
    currency CHAR(3) NOT NULL DEFAULT 'TRY',
    transaction_type VARCHAR(16) NOT NULL CHECK (transaction_type IN ('ODEME','TRANSFER','FATURA','CEKIM')),
    recipient VARCHAR(200) NOT NULL,
    source_device VARCHAR(100) NOT NULL,
    city VARCHAR(100) NOT NULL,
    country_code CHAR(2) NOT NULL CHECK (country_code ~ '^[A-Z]{2}$'),
    occurred_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE risk_cases (
    id UUID PRIMARY KEY,
    transaction_id UUID NOT NULL UNIQUE REFERENCES transactions(id),
    customer_id UUID NOT NULL,
    assigned_analyst_id UUID,
    status VARCHAR(32) NOT NULL CHECK (status IN (
        'YENI','ATANDI','INCELENIYOR','MUSTERI_DOGRULAMA','ONAYLANDI','BLOKLANDI','KAPANDI')),
    prediction_status VARCHAR(20) NOT NULL CHECK (prediction_status IN ('PENDING','AVAILABLE','UNAVAILABLE')),
    risk_level VARCHAR(16) NOT NULL CHECK (risk_level IN ('DUSUK','ORTA','YUKSEK','KRITIK','BELIRSIZ')),
    fraud_type VARCHAR(40) NOT NULL CHECK (fraud_type IN (
        'CALINTI_KART','HESAP_ELE_GECIRME','PARA_AKLAMA','SUPHELI_DAVRANIS','TEMIZ','BELIRSIZ')),
    ai_decision VARCHAR(16) NOT NULL CHECK (ai_decision IN ('ONAY','INCELEME','BLOK')),
    raw_ai_score NUMERIC(7,6) CHECK (raw_ai_score BETWEEN 0 AND 1),
    effective_score NUMERIC(7,6) CHECK (effective_score BETWEEN 0 AND 1),
    prediction_id UUID,
    model_version VARCHAR(100),
    reason_codes JSONB NOT NULL DEFAULT '[]'::jsonb,
    hold_status VARCHAR(32),
    queue_reason VARCHAR(40),
    due_at TIMESTAMPTZ NOT NULL,
    review_started_at TIMESTAMPTZ,
    decided_at TIMESTAMPTZ,
    customer_verification VARCHAR(32) CHECK (customer_verification IN (
        'PENDING','CUSTOMER_CONFIRMED','CUSTOMER_DENIED')),
    ground_truth VARCHAR(20) CHECK (ground_truth IN ('FRAUD','LEGITIMATE')),
    ground_truth_fraud_type VARCHAR(40),
    sla_breached_at TIMESTAMPTZ,
    version BIGINT NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE case_status_history (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    case_id UUID NOT NULL REFERENCES risk_cases(id),
    from_status VARCHAR(32),
    to_status VARCHAR(32) NOT NULL,
    actor_id UUID,
    actor_role VARCHAR(20) NOT NULL,
    reason VARCHAR(500),
    occurred_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE case_notes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    case_id UUID NOT NULL REFERENCES risk_cases(id),
    author_id UUID NOT NULL,
    note VARCHAR(2000) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE case_feedback (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    case_id UUID NOT NULL UNIQUE REFERENCES risk_cases(id),
    customer_id UUID NOT NULL,
    score SMALLINT NOT NULL CHECK (score BETWEEN 1 AND 5),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE staff_projection (
    analyst_id UUID PRIMARY KEY,
    display_name VARCHAR(160) NOT NULL,
    role VARCHAR(20) NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
    locked BOOLEAN NOT NULL DEFAULT FALSE,
    specialties JSONB NOT NULL DEFAULT '[]'::jsonb,
    regions JSONB NOT NULL DEFAULT '[]'::jsonb,
    active_case_count INTEGER NOT NULL DEFAULT 0 CHECK (active_case_count >= 0),
    performance NUMERIC(6,5) CHECK (performance BETWEEN 0 AND 1),
    last_assigned_at TIMESTAMPTZ,
    aggregate_version BIGINT NOT NULL DEFAULT 0,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE idempotency_records (
    actor_id UUID NOT NULL,
    idempotency_key VARCHAR(100) NOT NULL,
    request_hash CHAR(64) NOT NULL,
    transaction_id UUID NOT NULL REFERENCES transactions(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (actor_id, idempotency_key)
);

CREATE TABLE inbox_events (
    event_id UUID PRIMARY KEY,
    event_type VARCHAR(120) NOT NULL,
    aggregate_id UUID NOT NULL,
    aggregate_version BIGINT NOT NULL,
    payload_hash CHAR(64) NOT NULL,
    processed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE outbox_events (
    event_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    event_type VARCHAR(120) NOT NULL,
    event_version INTEGER NOT NULL DEFAULT 1,
    aggregate_id UUID NOT NULL,
    aggregate_version BIGINT NOT NULL,
    correlation_id UUID NOT NULL,
    causation_id UUID,
    payload JSONB NOT NULL,
    occurred_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    published_at TIMESTAMPTZ,
    attempt_count INTEGER NOT NULL DEFAULT 0,
    next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    failed_at TIMESTAMPTZ,
    failure_code VARCHAR(100)
);

CREATE INDEX idx_transactions_customer_time ON transactions(customer_id, created_at DESC);
CREATE INDEX idx_cases_customer ON risk_cases(customer_id, created_at DESC);
CREATE INDEX idx_cases_analyst ON risk_cases(assigned_analyst_id, status, due_at);
CREATE INDEX idx_cases_manual_queue ON risk_cases(queue_reason, due_at) WHERE assigned_analyst_id IS NULL;
CREATE INDEX idx_outbox_pending ON outbox_events(next_attempt_at, occurred_at)
    WHERE published_at IS NULL AND failed_at IS NULL;

CREATE FUNCTION reject_transaction_immutable_change() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION '% is append-only', TG_TABLE_NAME USING ERRCODE = '55000'; END;
$$;
CREATE TRIGGER status_history_append_only BEFORE UPDATE OR DELETE ON case_status_history
FOR EACH ROW EXECUTE FUNCTION reject_transaction_immutable_change();
CREATE TRIGGER case_notes_append_only BEFORE UPDATE OR DELETE ON case_notes
FOR EACH ROW EXECUTE FUNCTION reject_transaction_immutable_change();
CREATE TRIGGER case_feedback_append_only BEFORE UPDATE OR DELETE ON case_feedback
FOR EACH ROW EXECUTE FUNCTION reject_transaction_immutable_change();
