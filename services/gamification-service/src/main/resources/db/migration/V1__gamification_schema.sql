CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE analyst_profiles (
    analyst_id UUID PRIMARY KEY,
    display_name VARCHAR(120) NOT NULL,
    status VARCHAR(24) NOT NULL DEFAULT 'ACTIVE'
        CHECK (status IN ('ACTIVE', 'INACTIVE', 'SUSPENDED')),
    total_points BIGINT NOT NULL DEFAULT 0,
    level VARCHAR(24) NOT NULL DEFAULT 'BEGINNER'
        CHECK (level IN ('BEGINNER', 'EXPERIENCED', 'EXPERT', 'MASTER')),
    version BIGINT NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE badges (
    code VARCHAR(40) PRIMARY KEY,
    display_name VARCHAR(80) NOT NULL,
    description VARCHAR(300) NOT NULL,
    threshold INTEGER NOT NULL CHECK (threshold > 0)
);

INSERT INTO badges (code, display_name, description, threshold) VALUES
    ('FIRST_CATCH', 'İlk Yakalama', 'İlk doğrulanmış sahtekârlık', 1),
    ('SHARP_EYE', 'Keskin Göz', '15 dakikadan kısa 10 inceleme', 10),
    ('ZERO_ERROR', 'Sıfır Hata', 'Yanlış blok olmadan 50 inceleme', 50),
    ('MARATHONER', 'Maratoncu', 'Bir günde 20 tamamlanan vaka', 20),
    ('CRISIS_MANAGER', 'Kriz Yöneticisi', 'SLA içinde 10 kritik vaka', 10),
    ('EXPERT_HUNTER', 'Uzman Avcı', 'Aynı türde 50 doğrulanmış vaka', 50);

CREATE TABLE earned_badges (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    analyst_id UUID NOT NULL REFERENCES analyst_profiles(analyst_id),
    badge_code VARCHAR(40) NOT NULL REFERENCES badges(code),
    source_event_id UUID NOT NULL,
    earned_at TIMESTAMPTZ NOT NULL,
    UNIQUE (analyst_id, badge_code),
    UNIQUE (source_event_id, badge_code)
);

CREATE TABLE case_facts (
    case_id UUID PRIMARY KEY,
    analyst_id UUID NOT NULL REFERENCES analyst_profiles(analyst_id),
    aggregate_version BIGINT NOT NULL CHECK (aggregate_version >= 0),
    fraud_type VARCHAR(50),
    risk_level VARCHAR(16),
    terminal_decision VARCHAR(24),
    review_started_at TIMESTAMPTZ,
    decided_at TIMESTAMPTZ,
    sla_due_at TIMESTAMPTZ,
    verified_fraud BOOLEAN NOT NULL DEFAULT FALSE,
    false_block BOOLEAN NOT NULL DEFAULT FALSE,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE point_ledger (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    event_id UUID NOT NULL,
    analyst_id UUID NOT NULL REFERENCES analyst_profiles(analyst_id),
    case_id UUID,
    reason VARCHAR(40) NOT NULL CHECK (reason IN (
        'TERMINAL_DECISION', 'FAST_REVIEW', 'VERIFIED_FRAUD',
        'CRITICAL_WITHIN_SLA', 'SLA_BREACH', 'FALSE_BLOCK', 'CORRECTION'
    )),
    points INTEGER NOT NULL CHECK (points BETWEEN -1000 AND 1000 AND points <> 0),
    correction_of UUID REFERENCES point_ledger(id),
    aggregate_version BIGINT NOT NULL CHECK (aggregate_version >= 0),
    occurred_at TIMESTAMPTZ NOT NULL,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (event_id, reason)
);

CREATE TABLE daily_stats (
    analyst_id UUID NOT NULL REFERENCES analyst_profiles(analyst_id),
    local_day DATE NOT NULL,
    points BIGINT NOT NULL DEFAULT 0,
    completed_cases INTEGER NOT NULL DEFAULT 0 CHECK (completed_cases >= 0),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (analyst_id, local_day)
);

CREATE TABLE weekly_stats (
    analyst_id UUID NOT NULL REFERENCES analyst_profiles(analyst_id),
    iso_year SMALLINT NOT NULL,
    iso_week SMALLINT NOT NULL CHECK (iso_week BETWEEN 1 AND 53),
    points BIGINT NOT NULL DEFAULT 0,
    completed_cases INTEGER NOT NULL DEFAULT 0 CHECK (completed_cases >= 0),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (analyst_id, iso_year, iso_week)
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
    event_version INTEGER NOT NULL DEFAULT 1 CHECK (event_version > 0),
    aggregate_id UUID NOT NULL,
    aggregate_version BIGINT NOT NULL,
    correlation_id UUID NOT NULL,
    causation_id UUID,
    payload JSONB NOT NULL,
    occurred_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    published_at TIMESTAMPTZ,
    attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
    next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_point_ledger_analyst_time ON point_ledger (analyst_id, occurred_at DESC);
CREATE INDEX idx_point_ledger_case ON point_ledger (case_id) WHERE case_id IS NOT NULL;
CREATE INDEX idx_daily_stats_ranking ON daily_stats (local_day, points DESC, analyst_id);
CREATE INDEX idx_weekly_stats_ranking ON weekly_stats (iso_year, iso_week, points DESC, analyst_id);
CREATE INDEX idx_outbox_pending ON outbox_events (next_attempt_at, occurred_at) WHERE published_at IS NULL;

CREATE FUNCTION reject_immutable_change() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    RAISE EXCEPTION '% is append-only', TG_TABLE_NAME USING ERRCODE = '55000';
END;
$$;

CREATE TRIGGER point_ledger_append_only
BEFORE UPDATE OR DELETE ON point_ledger
FOR EACH ROW EXECUTE FUNCTION reject_immutable_change();

CREATE TRIGGER earned_badges_append_only
BEFORE UPDATE OR DELETE ON earned_badges
FOR EACH ROW EXECUTE FUNCTION reject_immutable_change();
