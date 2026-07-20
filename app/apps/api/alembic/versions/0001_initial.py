"""schema inicial

Revision ID: 0001
Revises:
Create Date: 2026-07-20 00:00:00

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0001"
down_revision: Union[str, None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "tenants",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("name", sa.String(120), nullable=False),
        sa.Column("owner_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )

    op.create_table(
        "users",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("name", sa.String(100), nullable=False),
        sa.Column("email", sa.String(254), nullable=False),
        sa.Column("password_hash", sa.String(256), nullable=False),
        sa.Column("role", sa.String(16), nullable=False),
        sa.Column("tenant_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("tenants.id"), nullable=True),
        sa.Column("email_verified_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index("ix_users_email", "users", ["email"], unique=True)
    op.create_foreign_key("fk_tenants_owner_id", "tenants", "users", ["owner_id"], ["id"])

    op.create_table(
        "profiles",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("student_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id"), nullable=False, unique=True),
        sa.Column("goal", sa.String(32), nullable=False),
        sa.Column("level", sa.String(16), nullable=False),
        sa.Column("training_days", postgresql.ARRAY(sa.Integer()), nullable=False),
        sa.Column("duration_minutes", sa.Integer(), nullable=False),
        sa.Column("location", sa.String(16), nullable=False),
        sa.Column("equipment", postgresql.ARRAY(sa.String()), nullable=False),
        sa.Column("weight_kg", sa.Float(), nullable=False),
        sa.Column("height_cm", sa.Integer(), nullable=False),
        sa.Column("age", sa.Integer(), nullable=False),
        sa.Column("sex", sa.String(16), nullable=False),
        sa.Column("priority_muscles", postgresql.ARRAY(sa.String()), nullable=False, server_default="{}"),
        sa.Column("intensity", sa.String(16), nullable=False),
        sa.Column("injuries", postgresql.JSONB(), nullable=False, server_default="[]"),
        sa.Column("bmi", sa.Float(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )

    op.create_table(
        "exercises",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("slug", sa.String(160), nullable=False),
        sa.Column("locale", sa.String(8), nullable=False, server_default="pt-BR"),
        sa.Column("name", sa.String(160), nullable=False),
        sa.Column("name_raw", sa.String(160), nullable=False),
        sa.Column("muscle_primary", sa.String(32), nullable=False),
        sa.Column("secondary_muscles", postgresql.ARRAY(sa.String()), nullable=False, server_default="{}"),
        sa.Column("equipment", sa.String(32), nullable=False),
        sa.Column("complexity", sa.String(16), nullable=False),
        sa.Column("movement_pattern", sa.String(32), nullable=False),
        sa.Column("target_key", sa.String(64), nullable=False),
        sa.Column("is_unilateral", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("is_stretch", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("is_warmup", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("joints", postgresql.ARRAY(sa.String()), nullable=False, server_default="{}"),
        sa.Column("contraindications", postgresql.ARRAY(sa.String()), nullable=False, server_default="{}"),
        sa.Column("requires_high_mind_muscle_awareness", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("search_tokens", postgresql.ARRAY(sa.String()), nullable=False, server_default="{}"),
        sa.Column("classification", postgresql.JSONB(), nullable=True),
        sa.Column("needs_review", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("video", postgresql.JSONB(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index("ix_exercises_slug", "exercises", ["slug"], unique=True)
    op.create_index("ix_exercises_muscle_primary", "exercises", ["muscle_primary"])
    op.create_index("ix_exercises_equipment", "exercises", ["equipment"])
    op.create_index("ix_exercises_target_key", "exercises", ["target_key"])
    op.create_index("ix_exercises_search_tokens", "exercises", ["search_tokens"], postgresql_using="gin")
    op.create_index("ix_exercises_contraindications", "exercises", ["contraindications"], postgresql_using="gin")

    op.create_table(
        "workout_sessions",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("student_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("workout_date", sa.Date(), nullable=False),
        sa.Column("selections", postgresql.JSONB(), nullable=False, server_default="{}"),
        sa.Column("status", sa.String(16), nullable=False, server_default="active"),
        sa.Column("comment", sa.String(1000), nullable=True),
        sa.Column("missing_exercise_ids", postgresql.ARRAY(sa.String()), nullable=False, server_default="{}"),
        sa.Column("started_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("finished_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index("ix_workout_sessions_student_id", "workout_sessions", ["student_id"])
    op.create_unique_constraint("uq_workout_sessions_student_date", "workout_sessions", ["student_id", "workout_date"])

    op.create_table(
        "workout_plans",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("student_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("version", sa.Integer(), nullable=False),
        sa.Column("active", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("source", sa.String(32), nullable=False),
        sa.Column("days", postgresql.JSONB(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index("ix_workout_plans_student_id", "workout_plans", ["student_id"])
    op.create_index("ix_workout_plans_active", "workout_plans", ["active"])
    op.create_unique_constraint("uq_workout_plans_student_version", "workout_plans", ["student_id", "version"])

    op.create_table(
        "workout_logs",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("student_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("exercise_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("exercises.id"), nullable=False),
        sa.Column("session_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("workout_sessions.id"), nullable=True),
        sa.Column("sets", sa.Integer(), nullable=False),
        sa.Column("reps", sa.Integer(), nullable=False),
        sa.Column("load_kg", sa.Float(), nullable=False),
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_workout_logs_student_id", "workout_logs", ["student_id"])
    op.create_index("ix_workout_logs_completed_at", "workout_logs", ["completed_at"])

    op.create_table(
        "measurements",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("student_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("measured_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("weight_kg", sa.Float(), nullable=False),
        sa.Column("height_cm", sa.Integer(), nullable=False),
        sa.Column("bmi", sa.Float(), nullable=False),
        sa.Column("waist_cm", sa.Float(), nullable=True),
    )
    op.create_index("ix_measurements_student_id", "measurements", ["student_id"])
    op.create_index("ix_measurements_measured_at", "measurements", ["measured_at"])

    op.create_table(
        "memberships",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("tenant_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("tenants.id"), nullable=False),
        sa.Column("student_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("status", sa.String(16), nullable=False, server_default="active"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index("ix_memberships_tenant_id", "memberships", ["tenant_id"])
    op.create_index("ix_memberships_student_id", "memberships", ["student_id"])
    op.create_unique_constraint("uq_memberships_tenant_student", "memberships", ["tenant_id", "student_id"])

    op.create_table(
        "consents",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("membership_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("memberships.id"), nullable=False),
        sa.Column("version", sa.String(16), nullable=False),
        sa.Column("scopes", postgresql.ARRAY(sa.String()), nullable=False),
        sa.Column("accepted_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("revoked_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("document_hash", sa.String(64), nullable=False),
    )
    op.create_index("ix_consents_membership_id", "consents", ["membership_id"])
    op.create_index("ix_consents_revoked_at", "consents", ["revoked_at"])

    op.create_table(
        "invitations",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("tenant_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("tenants.id"), nullable=False),
        sa.Column("email", sa.String(254), nullable=False),
        sa.Column("token_hash", sa.String(64), nullable=False),
        sa.Column("status", sa.String(16), nullable=False, server_default="pending"),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("created_by", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("accepted_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index("ix_invitations_token_hash", "invitations", ["token_hash"])
    op.create_index("ix_invitations_expires_at", "invitations", ["expires_at"])

    op.create_table(
        "analytics_snapshots",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("student_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id"), nullable=False, unique=True),
        sa.Column("adherence_percent", sa.Integer(), nullable=False),
        sa.Column("total_volume_kg", sa.Float(), nullable=False),
        sa.Column("personal_records", sa.Integer(), nullable=False),
        sa.Column("weekly_volume", postgresql.JSONB(), nullable=False, server_default="[]"),
        sa.Column("weight_trend", postgresql.JSONB(), nullable=False, server_default="[]"),
        sa.Column("bmi_trend", postgresql.JSONB(), nullable=False, server_default="[]"),
        sa.Column("generated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )


def downgrade() -> None:
    op.drop_table("analytics_snapshots")
    op.drop_table("invitations")
    op.drop_table("consents")
    op.drop_table("memberships")
    op.drop_table("measurements")
    op.drop_table("workout_logs")
    op.drop_table("workout_plans")
    op.drop_table("workout_sessions")
    op.drop_table("exercises")
    op.drop_table("profiles")
    op.drop_constraint("fk_tenants_owner_id", "tenants", type_="foreignkey")
    op.drop_table("users")
    op.drop_table("tenants")
