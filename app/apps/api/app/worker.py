import hashlib
import json
import uuid
from datetime import datetime, timezone
from pathlib import Path

from arq import cron
from arq.connections import RedisSettings
from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert as pg_insert

from .analytics import aggregate_progress
from .config import config
from .db import AsyncSessionLocal, s3_client
from .models import AnalyticsSnapshot, Exercise, Measurement, Profile, WorkoutLog, WorkoutPlan
from .plan import normalized_name
from .workout_engine import PlanGenerationError, generate_plan

CATALOG_PATH = Path("/app/catalog/exercises.pt-BR.json")
VIDEOS_DIR = Path("/app/videos")


async def import_catalog(ctx) -> dict:
    items = json.loads(CATALOG_PATH.read_text(encoding="utf-8"))
    imported = 0
    async with AsyncSessionLocal() as db:
        async with s3_client() as s3:
            for item in items:
                local_path = VIDEOS_DIR / item["video"]["fileName"]
                if not local_path.exists():
                    continue
                object_key = item["video"]["objectKey"]
                try:
                    await s3.head_object(Bucket=config.MINIO_BUCKET, Key=object_key)
                except Exception:  # noqa: BLE001 - qualquer erro de HEAD significa "precisa subir"
                    await s3.upload_file(str(local_path), config.MINIO_BUCKET, object_key, ExtraArgs={"ContentType": "video/mp4"})

                values = _exercise_values(item)
                stmt = pg_insert(Exercise).values(**values, slug=item["slug"])
                update_values = {**values, "updated_at": datetime.now(timezone.utc)}
                stmt = stmt.on_conflict_do_update(index_elements=["slug"], set_=update_values)
                await db.execute(stmt)
                imported += 1
                if imported % 50 == 0:
                    await db.commit()
            await db.commit()
    return {"imported": imported}


def _exercise_values(item: dict) -> dict:
    return dict(
        locale=item.get("locale", "pt-BR"), name=item["name"], name_raw=item.get("nameRaw", item["name"]),
        muscle_primary=item["musclePrimary"], secondary_muscles=item.get("secondaryMuscles", []),
        equipment=item["equipment"], complexity=item.get("complexity", "iniciante"),
        movement_pattern=item.get("movementPattern", ""), target_key=item["targetKey"],
        is_unilateral=bool(item.get("isUnilateral")), is_stretch=bool(item.get("isStretch")),
        is_warmup=bool(item.get("isWarmup")), joints=item.get("joints", []),
        contraindications=item.get("contraindications", []),
        requires_high_mind_muscle_awareness=bool(item.get("requiresHighMindMuscleAwareness")),
        search_tokens=item.get("searchTokens", [normalized_name(item["name"])]),
        classification=item.get("classification"), needs_review=bool(item.get("needsReview")),
        video=item["video"],
    )


async def generate_workout(ctx, student_id: str) -> dict:
    async with AsyncSessionLocal() as db:
        try:
            generated = await generate_plan(db, student_id)
        except PlanGenerationError as error:
            raise RuntimeError(str(error)) from error
        current = (
            await db.execute(
                select(WorkoutPlan).where(WorkoutPlan.student_id == uuid.UUID(student_id), WorkoutPlan.active.is_(True)).order_by(WorkoutPlan.version.desc())
            )
        ).scalars().first()
        await db.execute(
            WorkoutPlan.__table__.update().where(WorkoutPlan.student_id == uuid.UUID(student_id), WorkoutPlan.active.is_(True)).values(active=False)
        )
        next_version = (current.version if current else 0) + 1
        db.add(WorkoutPlan(
            student_id=uuid.UUID(student_id), version=next_version, active=True, source=generated.source,
            days=[day.model_dump() for day in generated.plan.days],
        ))
        await db.commit()
        return {
            "version": next_version, "source": generated.source,
            "providerFallback": bool(generated.provider_failures),
        }


async def refresh_analytics(ctx, student_id: str) -> dict:
    async with AsyncSessionLocal() as db:
        student_uuid = uuid.UUID(student_id)
        logs = (await db.execute(select(WorkoutLog).where(WorkoutLog.student_id == student_uuid))).scalars().all()
        measurements = (await db.execute(select(Measurement).where(Measurement.student_id == student_uuid))).scalars().all()
        profile = (await db.execute(select(Profile).where(Profile.student_id == student_uuid))).scalar_one_or_none()

        log_dicts = [{"exerciseId": str(log.exercise_id), "completedAt": log.completed_at, "sets": log.sets, "reps": log.reps, "loadKg": log.load_kg} for log in logs]
        measurement_dicts = [{"measuredAt": m.measured_at, "weightKg": m.weight_kg, "bmi": m.bmi} for m in measurements]
        training_days = len(profile.training_days) if profile and profile.training_days else 3
        snapshot = aggregate_progress(log_dicts, measurement_dicts, training_days)

        stmt = pg_insert(AnalyticsSnapshot).values(
            student_id=student_uuid, adherence_percent=snapshot["adherencePercent"], total_volume_kg=snapshot["totalVolumeKg"],
            personal_records=snapshot["personalRecords"], weekly_volume=snapshot["weeklyVolume"],
            weight_trend=snapshot["weightTrend"], bmi_trend=snapshot["bmiTrend"],
        )
        update_values = {
            "adherence_percent": snapshot["adherencePercent"], "total_volume_kg": snapshot["totalVolumeKg"],
            "personal_records": snapshot["personalRecords"], "weekly_volume": snapshot["weeklyVolume"],
            "weight_trend": snapshot["weightTrend"], "bmi_trend": snapshot["bmiTrend"],
            "generated_at": datetime.now(timezone.utc),
        }
        stmt = stmt.on_conflict_do_update(index_elements=["student_id"], set_=update_values)
        await db.execute(stmt)
        await db.commit()
    return {"ok": True}


async def send_invitation(ctx, email: str, token: str) -> dict:
    # O adaptador SMTP entra aqui; tokens nunca são registrados em log.
    return {"queued": True, "recipientHash": email.split("@")[-1]}


async def rotate_weekly_plans(ctx) -> dict:
    from datetime import timedelta

    cutoff = datetime.now(timezone.utc) - timedelta(days=7)
    async with AsyncSessionLocal() as db:
        due = (
            await db.execute(select(WorkoutPlan.student_id).where(WorkoutPlan.active.is_(True), WorkoutPlan.created_at <= cutoff))
        ).scalars().all()
    due_ids = set(due)
    for student_id in due_ids:
        await ctx["redis"].enqueue_job(
            "generate_workout", str(student_id), _job_id=f"weekly:{student_id}:{datetime.now(timezone.utc).date().isoformat()}",
        )
    return {"queued": len(due_ids)}


async def _startup(ctx) -> None:
    # ctx["redis"] já é o pool arq do próprio worker (arq injeta antes de
    # chamar on_startup); só usamos para enfileirar a importação inicial.
    print("Treinow workers ativos")
    if CATALOG_PATH.exists():
        catalog_hash = hashlib.sha256(CATALOG_PATH.read_bytes()).hexdigest()[:16]
        await ctx["redis"].enqueue_job("import_catalog", _job_id=f"catalog-{catalog_hash}")


class WorkerSettings:
    functions = [import_catalog, generate_workout, refresh_analytics, send_invitation, rotate_weekly_plans]
    cron_jobs = [cron(rotate_weekly_plans, hour=3, minute=15)]
    redis_settings = RedisSettings.from_dsn(config.REDIS_URL)
    on_startup = _startup
    max_jobs = 6
