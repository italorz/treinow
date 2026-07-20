import uuid
from datetime import date, datetime

from sqlalchemy import Date, DateTime, Float, ForeignKey, Integer, String, UniqueConstraint, func
from sqlalchemy.dialects.postgresql import ARRAY, JSONB, UUID
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column


class Base(DeclarativeBase):
    # SQLAlchemy infere DateTime() (sem timezone) a partir de `datetime` por
    # padrao; forcamos timestamptz para toda coluna Mapped[datetime] de uma vez.
    type_annotation_map = {datetime: DateTime(timezone=True)}


def uuid_pk() -> Mapped[uuid.UUID]:
    return mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)


class User(Base):
    __tablename__ = "users"

    id: Mapped[uuid.UUID] = uuid_pk()
    name: Mapped[str] = mapped_column(String(100))
    email: Mapped[str] = mapped_column(String(254), unique=True, index=True)
    password_hash: Mapped[str] = mapped_column(String(256))
    role: Mapped[str] = mapped_column(String(16))
    tenant_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("tenants.id"))
    email_verified_at: Mapped[datetime | None]
    created_at: Mapped[datetime] = mapped_column(server_default=func.now())


class Tenant(Base):
    __tablename__ = "tenants"

    id: Mapped[uuid.UUID] = uuid_pk()
    name: Mapped[str] = mapped_column(String(120))
    owner_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"))
    created_at: Mapped[datetime] = mapped_column(server_default=func.now())


class Profile(Base):
    __tablename__ = "profiles"

    id: Mapped[uuid.UUID] = uuid_pk()
    student_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"), unique=True)
    goal: Mapped[str] = mapped_column(String(32))
    level: Mapped[str] = mapped_column(String(16))
    training_days: Mapped[list[int]] = mapped_column(ARRAY(Integer))
    duration_minutes: Mapped[int]
    location: Mapped[str] = mapped_column(String(16))
    equipment: Mapped[list[str]] = mapped_column(ARRAY(String))
    weight_kg: Mapped[float] = mapped_column(Float)
    height_cm: Mapped[int]
    age: Mapped[int]
    sex: Mapped[str] = mapped_column(String(16))
    priority_muscles: Mapped[list[str]] = mapped_column(ARRAY(String), default=list)
    intensity: Mapped[str] = mapped_column(String(16))
    injuries: Mapped[list[dict]] = mapped_column(JSONB, default=list)
    bmi: Mapped[float] = mapped_column(Float)
    updated_at: Mapped[datetime] = mapped_column(server_default=func.now(), onupdate=func.now())


class Exercise(Base):
    __tablename__ = "exercises"

    id: Mapped[uuid.UUID] = uuid_pk()
    slug: Mapped[str] = mapped_column(String(160), unique=True, index=True)
    locale: Mapped[str] = mapped_column(String(8), default="pt-BR")
    name: Mapped[str] = mapped_column(String(160))
    name_raw: Mapped[str] = mapped_column(String(160))
    muscle_primary: Mapped[str] = mapped_column(String(32), index=True)
    secondary_muscles: Mapped[list[str]] = mapped_column(ARRAY(String), default=list)
    equipment: Mapped[str] = mapped_column(String(32), index=True)
    complexity: Mapped[str] = mapped_column(String(16))
    movement_pattern: Mapped[str] = mapped_column(String(32))
    target_key: Mapped[str] = mapped_column(String(64), index=True)
    is_unilateral: Mapped[bool] = mapped_column(default=False)
    is_stretch: Mapped[bool] = mapped_column(default=False)
    is_warmup: Mapped[bool] = mapped_column(default=False)
    joints: Mapped[list[str]] = mapped_column(ARRAY(String), default=list)
    contraindications: Mapped[list[str]] = mapped_column(ARRAY(String), default=list)
    requires_high_mind_muscle_awareness: Mapped[bool] = mapped_column(default=False)
    search_tokens: Mapped[list[str]] = mapped_column(ARRAY(String), default=list, index=True)
    classification: Mapped[dict | None] = mapped_column(JSONB)
    needs_review: Mapped[bool] = mapped_column(default=False)
    video: Mapped[dict] = mapped_column(JSONB)
    created_at: Mapped[datetime] = mapped_column(server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(server_default=func.now(), onupdate=func.now())


class WorkoutPlan(Base):
    __tablename__ = "workout_plans"
    __table_args__ = (UniqueConstraint("student_id", "version"),)

    id: Mapped[uuid.UUID] = uuid_pk()
    student_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"), index=True)
    version: Mapped[int]
    active: Mapped[bool] = mapped_column(default=True, index=True)
    source: Mapped[str] = mapped_column(String(32))
    days: Mapped[list[dict]] = mapped_column(JSONB)
    created_at: Mapped[datetime] = mapped_column(server_default=func.now())


class WorkoutLog(Base):
    __tablename__ = "workout_logs"

    id: Mapped[uuid.UUID] = uuid_pk()
    student_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"), index=True)
    exercise_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("exercises.id"))
    session_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("workout_sessions.id"))
    sets: Mapped[int]
    reps: Mapped[int]
    load_kg: Mapped[float] = mapped_column(Float)
    completed_at: Mapped[datetime] = mapped_column(index=True)


class WorkoutSession(Base):
    __tablename__ = "workout_sessions"
    __table_args__ = (UniqueConstraint("student_id", "workout_date"),)

    id: Mapped[uuid.UUID] = uuid_pk()
    student_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"), index=True)
    workout_date: Mapped[date] = mapped_column(Date)
    selections: Mapped[dict] = mapped_column(JSONB, default=dict)
    status: Mapped[str] = mapped_column(String(16), default="active")
    comment: Mapped[str | None] = mapped_column(String(1000))
    missing_exercise_ids: Mapped[list[str]] = mapped_column(ARRAY(String), default=list)
    started_at: Mapped[datetime] = mapped_column(server_default=func.now())
    finished_at: Mapped[datetime | None]
    created_at: Mapped[datetime] = mapped_column(server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(server_default=func.now(), onupdate=func.now())


class Measurement(Base):
    __tablename__ = "measurements"

    id: Mapped[uuid.UUID] = uuid_pk()
    student_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"), index=True)
    measured_at: Mapped[datetime] = mapped_column(index=True)
    weight_kg: Mapped[float] = mapped_column(Float)
    height_cm: Mapped[int]
    bmi: Mapped[float] = mapped_column(Float)
    waist_cm: Mapped[float | None] = mapped_column(Float)


class Membership(Base):
    __tablename__ = "memberships"
    __table_args__ = (UniqueConstraint("tenant_id", "student_id"),)

    id: Mapped[uuid.UUID] = uuid_pk()
    tenant_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("tenants.id"), index=True)
    student_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"), index=True)
    status: Mapped[str] = mapped_column(String(16), default="active")
    created_at: Mapped[datetime] = mapped_column(server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(server_default=func.now(), onupdate=func.now())


class Consent(Base):
    __tablename__ = "consents"

    id: Mapped[uuid.UUID] = uuid_pk()
    membership_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("memberships.id"), index=True)
    version: Mapped[str] = mapped_column(String(16))
    scopes: Mapped[list[str]] = mapped_column(ARRAY(String))
    accepted_at: Mapped[datetime] = mapped_column(server_default=func.now())
    revoked_at: Mapped[datetime | None] = mapped_column(index=True)
    document_hash: Mapped[str] = mapped_column(String(64))


class Invitation(Base):
    __tablename__ = "invitations"

    id: Mapped[uuid.UUID] = uuid_pk()
    tenant_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("tenants.id"))
    email: Mapped[str] = mapped_column(String(254))
    token_hash: Mapped[str] = mapped_column(String(64), index=True)
    status: Mapped[str] = mapped_column(String(16), default="pending")
    expires_at: Mapped[datetime] = mapped_column(index=True)
    created_by: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"))
    accepted_at: Mapped[datetime | None]
    created_at: Mapped[datetime] = mapped_column(server_default=func.now())


class AnalyticsSnapshot(Base):
    __tablename__ = "analytics_snapshots"

    id: Mapped[uuid.UUID] = uuid_pk()
    student_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"), unique=True)
    adherence_percent: Mapped[int]
    total_volume_kg: Mapped[float] = mapped_column(Float)
    personal_records: Mapped[int]
    weekly_volume: Mapped[list[dict]] = mapped_column(JSONB, default=list)
    weight_trend: Mapped[list[dict]] = mapped_column(JSONB, default=list)
    bmi_trend: Mapped[list[dict]] = mapped_column(JSONB, default=list)
    generated_at: Mapped[datetime] = mapped_column(server_default=func.now())
