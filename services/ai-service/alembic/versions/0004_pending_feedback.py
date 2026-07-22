"""Durable pending feedback for events that beat case-created projection.

Revision ID: 0004
"""

from alembic import op

revision = "0004"
down_revision = "0003"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        CREATE TABLE pending_feedback_events (
            event_id UUID PRIMARY KEY,
            case_id UUID NOT NULL,
            event_type VARCHAR(120) NOT NULL,
            aggregate_version BIGINT NOT NULL,
            payload JSONB NOT NULL,
            occurred_at TIMESTAMPTZ NOT NULL,
            created_at TIMESTAMPTZ NOT NULL DEFAULT now()
        );
        CREATE INDEX idx_pending_feedback_case
            ON pending_feedback_events (case_id, aggregate_version, occurred_at);
        ALTER TABLE pending_feedback_events ENABLE ROW LEVEL SECURITY;
        ALTER TABLE pending_feedback_events FORCE ROW LEVEL SECURITY;
        CREATE POLICY pending_feedback_service_only ON pending_feedback_events FOR ALL
            USING (app_actor_role() = 'SYSTEM') WITH CHECK (app_actor_role() = 'SYSTEM');
        """
    )


def downgrade() -> None:
    raise RuntimeError("Production pending-event downgrade is intentionally disabled")
