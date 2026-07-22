"""Case-to-prediction and workload projections for ordered event handling.

Revision ID: 0003
"""

from alembic import op

revision = "0003"
down_revision = "0002"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        CREATE TABLE case_prediction_projection (
            case_id UUID PRIMARY KEY,
            transaction_id UUID NOT NULL,
            prediction_id UUID REFERENCES predictions(prediction_id),
            aggregate_version BIGINT NOT NULL,
            updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
        );
        CREATE INDEX idx_case_prediction_transaction
            ON case_prediction_projection (transaction_id);

        CREATE TABLE case_assignment_projection (
            case_id UUID PRIMARY KEY,
            analyst_id UUID,
            status VARCHAR(30),
            aggregate_version BIGINT NOT NULL,
            updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
        );
        CREATE INDEX idx_case_assignment_analyst_status
            ON case_assignment_projection (analyst_id, status);
        """
    )
    for table in ("case_prediction_projection", "case_assignment_projection"):
        op.execute(f"ALTER TABLE {table} ENABLE ROW LEVEL SECURITY")
        op.execute(f"ALTER TABLE {table} FORCE ROW LEVEL SECURITY")
        op.execute(
            f"""
            CREATE POLICY {table}_read ON {table} FOR SELECT USING (
                app_actor_role() IN ('SUPERVISOR','ADMIN','SYSTEM')
            );
            CREATE POLICY {table}_service_write ON {table} FOR ALL
                USING (app_actor_role() = 'SYSTEM')
                WITH CHECK (app_actor_role() = 'SYSTEM');
            """
        )


def downgrade() -> None:
    raise RuntimeError("Production projection downgrade is intentionally disabled")
