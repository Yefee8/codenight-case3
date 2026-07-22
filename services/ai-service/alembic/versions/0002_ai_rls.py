"""Force row-level security on every AI table.

Revision ID: 0002
"""

from alembic import op

revision = "0002"
down_revision = "0001"
branch_labels = None
depends_on = None


TABLES = (
    "model_versions",
    "training_runs",
    "predictions",
    "classification_feedback",
    "analyst_projection",
    "assignment_recommendations",
    "accuracy_snapshots",
    "inbox_events",
    "outbox_events",
)


def upgrade() -> None:
    op.execute(
        """
        CREATE FUNCTION app_actor_role() RETURNS text LANGUAGE sql STABLE PARALLEL SAFE
            RETURN nullif(current_setting('app.actor_role', true), '');
        CREATE FUNCTION app_actor_id() RETURNS uuid LANGUAGE sql STABLE PARALLEL SAFE
            RETURN nullif(current_setting('app.actor_id', true), '')::uuid;
        """
    )
    for table in TABLES:
        op.execute(f"ALTER TABLE {table} ENABLE ROW LEVEL SECURITY")
        op.execute(f"ALTER TABLE {table} FORCE ROW LEVEL SECURITY")

    for table in ("model_versions", "accuracy_snapshots"):
        op.execute(
            f"""
            CREATE POLICY {table}_read ON {table} FOR SELECT USING (
                app_actor_role() IN ('ANALYST','SUPERVISOR','ADMIN','SYSTEM')
            );
            CREATE POLICY {table}_service_write ON {table} FOR ALL
                USING (app_actor_role() = 'SYSTEM')
                WITH CHECK (app_actor_role() = 'SYSTEM');
            """
        )

    for table in (
        "training_runs",
        "predictions",
        "classification_feedback",
        "assignment_recommendations",
    ):
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

    op.execute(
        """
        CREATE POLICY analyst_projection_read ON analyst_projection FOR SELECT USING (
            app_actor_role() IN ('SUPERVISOR','ADMIN','SYSTEM')
            OR (app_actor_role() = 'ANALYST' AND analyst_id = app_actor_id())
        );
        CREATE POLICY analyst_projection_service_write ON analyst_projection FOR ALL
            USING (app_actor_role() = 'SYSTEM') WITH CHECK (app_actor_role() = 'SYSTEM');
        CREATE POLICY inbox_events_service_only ON inbox_events FOR ALL
            USING (app_actor_role() = 'SYSTEM') WITH CHECK (app_actor_role() = 'SYSTEM');
        CREATE POLICY outbox_events_service_only ON outbox_events FOR ALL
            USING (app_actor_role() = 'SYSTEM') WITH CHECK (app_actor_role() = 'SYSTEM');
        """
    )


def downgrade() -> None:
    raise RuntimeError("Production RLS downgrade is intentionally disabled")
