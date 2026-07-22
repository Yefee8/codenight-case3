"""Per-field event versions and terminal outbox state.

Revision ID: 0005
"""

from alembic import op

revision = "0005"
down_revision = "0004"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        ALTER TABLE analyst_projection
            ADD COLUMN status_version BIGINT NOT NULL DEFAULT -1,
            ADD COLUMN specialties_version BIGINT NOT NULL DEFAULT -1,
            ADD COLUMN regions_version BIGINT NOT NULL DEFAULT -1;
        UPDATE analyst_projection
           SET status_version = aggregate_version,
               specialties_version = aggregate_version,
               regions_version = aggregate_version;

        ALTER TABLE case_assignment_projection
            ADD COLUMN assignment_version BIGINT NOT NULL DEFAULT -1,
            ADD COLUMN status_version BIGINT NOT NULL DEFAULT -1;
        UPDATE case_assignment_projection
           SET assignment_version = CASE WHEN analyst_id IS NULL THEN -1 ELSE aggregate_version END,
               status_version = aggregate_version;

        ALTER TABLE outbox_events
            ADD COLUMN failed_at TIMESTAMPTZ,
            ADD COLUMN failure_code VARCHAR(80);
        DROP INDEX idx_ai_outbox_pending;
        CREATE INDEX idx_ai_outbox_pending ON outbox_events (next_attempt_at, occurred_at)
            WHERE published_at IS NULL AND failed_at IS NULL;
        CREATE INDEX idx_ai_outbox_failed ON outbox_events (failed_at)
            WHERE failed_at IS NOT NULL;

        CREATE INDEX idx_feedback_effective
            ON classification_feedback (
                prediction_id,
                (CASE source
                    WHEN 'SUPERVISOR_QA' THEN 3
                    WHEN 'CUSTOMER' THEN 2
                    ELSE 1
                 END) DESC,
                aggregate_version DESC,
                occurred_at DESC
            );
        """
    )


def downgrade() -> None:
    raise RuntimeError("Production event-safety downgrade is intentionally disabled")
