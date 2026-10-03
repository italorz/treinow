import hashlib
import json
import uuid
from datetime import datetime, timezone
from pathlib import Path

from arq import cron
from arq.connections import RedisSettings
from sqlalchemy import select, delete, func, or_
from botocore.exceptions import ClientError
from sqlalchemy.dialects.postgresql import insert as pg_insert

from .analytics import aggregate_progress
from .config import config
from .catalog import CATALOG_VERSION, PLAN_CATALOG_TAG, active_catalog
from .db import AsyncSessionLocal, s3_client
from .models import AnalyticsSnapshot, Exercise, Measurement, Profile, WorkoutLog, WorkoutPlan, WorkoutSession
from .plan import normalized_name
from .workout_engine import PlanGenerationError, generate_plan

CATALOG_PATH = Path("/app/catalog/exercises.pt-BR.json")
VIDEOS_DIR = Path("/app/videos")
CATALOG_IMPORT_REVISION = 'catalog-v2-cleanup-1'


async def import_catalog(ctx) -> dict:
    items = json.loads(CATALOG_PATH.read_text(encoding="utf-8"))
    if not items or len({i['slug'] for i in items}) != len(items):
        raise ValueError('Empty catalog or duplicate exercise IDs')
    unique_videos = {}
    for item in items:
        if item.get('classification', {}).get('source') != CATALOG_VERSION:
            raise ValueError('Catalog version mismatch')
        for video in item['video']['variants'].values():
            path = VIDEOS_DIR / video['fileName']
            if path.parent.resolve() != VIDEOS_DIR.resolve() or not path.is_file():
                raise ValueError(f"Missing catalog video: {video['fileName']}")
            if hashlib.sha256(path.read_bytes()).hexdigest() != video['sha256']:
                raise ValueError(f"Invalid catalog video hash: {video['fileName']}")
            unique_videos[video['objectKey']] = (path, video)
    imported = 0
    async with AsyncSessionLocal() as db:
        async with s3_client() as s3:
            # Validate/upload the whole collection before activating any database row.
            for object_key, (path, video) in unique_videos.items():
                upload = False
                try:
                    obj = await s3.head_object(Bucket=config.MINIO_BUCKET, Key=object_key)
                    upload = obj['ContentLength'] != path.stat().st_size
                except ClientError as error:
                    if error.response['Error']['Code'] not in ('404', 'NoSuchKey', 'NotFound'):
                        raise
                    upload = True
                if upload:
                    await s3.upload_file(str(path), config.MINIO_BUCKET, object_key, ExtraArgs={'ContentType':'video/mp4','Metadata':{'sha256':video['sha256']}})
                    obj = await s3.head_object(Bucket=config.MINIO_BUCKET, Key=object_key)
                    if obj['ContentLength'] != path.stat().st_size:
                        raise ValueError(f'Incomplete upload: {object_key}')
            for item in items:
                values = _exercise_values(item)
                stmt = pg_insert(Exercise).values(**values, slug=item["slug"])
                update_values = {**values, "updated_at": datetime.now(timezone.utc)}
                stmt = stmt.on_conflict_do_update(index_elements=["slug"], set_=update_values)
                await db.execute(stmt)
                imported += 1
            # Authorized test-data cleanup: remove only the legacy catalog and its dependencies.
            removed, affected_students = await _purge_legacy(db, {i['slug'] for i in items})
            await db.commit()
        active = (await db.execute(select(func.count()).select_from(Exercise).where(active_catalog()))).scalar_one()
        retired = (await db.execute(select(func.count()).select_from(Exercise).where(Exercise.is_active.is_(False)))).scalar_one()
        active_students = select(WorkoutPlan.student_id).where(WorkoutPlan.active.is_(True))
        pending = set((await db.execute(select(Profile.student_id).where(Profile.student_id.not_in(active_students)))).scalars().all())
        current_students = set((await db.execute(active_students)).scalars().all())
        pending.update(affected_students - current_students)
    for student_id in pending:
        await ctx['redis'].enqueue_job('generate_workout', str(student_id), _job_id=f'catalog-plan-v2:{student_id}')
    for student_id in affected_students:
        await ctx['redis'].enqueue_job('refresh_analytics', str(student_id))
    stale_videos = await _purge_stale_videos(unique_videos)
    result = {'imported':imported,'active':active,'retired':retired,'verifiedVideos':len(unique_videos),'deletedVideoObjects':stale_videos,**removed,'plansQueued':len(pending),'catalogVersion':CATALOG_VERSION}
    print('catalog_import ' + ' '.join(f'{key}={value}' for key, value in result.items()))
    return result


async def _purge_stale_videos(expected: dict) -> int:
    """Remove obsolete video objects only; unrelated non-video bucket data is untouched."""
    expected_keys = set(expected)
    async with s3_client() as s3:
        current = await _video_object_keys(s3)
        stale = [{'Key':key} for key in current - expected_keys]
        for offset in range(0, len(stale), 1000):
            response = await s3.delete_objects(Bucket=config.MINIO_BUCKET, Delete={'Objects':stale[offset:offset+1000], 'Quiet':True})
            if response.get('Errors'):
                raise RuntimeError('Storage refused obsolete video deletion')
        remaining = await _video_object_keys(s3)
        if remaining != expected_keys:
            raise RuntimeError(f'Video storage/catalog mismatch: expected={len(expected_keys)} actual={len(remaining)}')
    return len(stale)


async def _video_object_keys(s3) -> set[str]:
    keys: set[str] = set()
    token = None
    while True:
        args = {'Bucket':config.MINIO_BUCKET}
        if token:
            args['ContinuationToken'] = token
        page = await s3.list_objects_v2(**args)
        keys.update(obj['Key'] for obj in page.get('Contents', []) if obj['Key'].lower().endswith(('.mp4','.webm','.mov','.avi')))
        if not page.get('IsTruncated'):
            return keys
        token = page['NextContinuationToken']


def _references(value, ids: set[str]) -> bool:
    if isinstance(value, str):
        return value in ids
    if isinstance(value, dict):
        return any(_references(k, ids) or _references(v, ids) for k, v in value.items())
    if isinstance(value, list):
        return any(_references(v, ids) for v in value)
    return False


async def _purge_legacy(db, slugs: set[str]) -> tuple[dict, set]:
    """FK-ordered, transactional cleanup; never deletes users, profiles or measurements."""
    legacy = set((await db.execute(select(Exercise.id).where(Exercise.slug.not_in(slugs)))).scalars().all())
    legacy_strings = {str(e) for e in legacy}
    plans = (await db.execute(select(WorkoutPlan))).scalars().all()
    old_plans = [p for p in plans if not p.source.endswith(PLAN_CATALOG_TAG) or _references(p.days, legacy_strings)]
    affected = {p.student_id for p in old_plans}
    sessions = (await db.execute(select(WorkoutSession))).scalars().all()
    old_sessions = [s for s in sessions if s.student_id in affected or _references(s.selections, legacy_strings) or _references(s.missing_exercise_ids, legacy_strings)]
    session_ids = [s.id for s in old_sessions]
    affected.update(s.student_id for s in old_sessions)
    log_filter = or_(WorkoutLog.exercise_id.in_(legacy), WorkoutLog.session_id.in_(session_ids))
    affected.update((await db.execute(select(WorkoutLog.student_id).where(log_filter))).scalars().all())
    deleted_logs = (await db.execute(delete(WorkoutLog).where(log_filter))).rowcount
    deleted_sessions = (await db.execute(delete(WorkoutSession).where(WorkoutSession.id.in_(session_ids)))).rowcount
    deleted_plans = (await db.execute(delete(WorkoutPlan).where(WorkoutPlan.id.in_([p.id for p in old_plans])))).rowcount
    deleted_exercises = (await db.execute(delete(Exercise).where(Exercise.id.in_(legacy)))).rowcount
    await db.execute(delete(AnalyticsSnapshot).where(AnalyticsSnapshot.student_id.in_(affected)))
    return {'deletedExercises':deleted_exercises,'deletedPlans':deleted_plans,'deletedSessions':deleted_sessions,'deletedLogs':deleted_logs}, affected


def _exercise_values(item: dict) -> dict:
    return dict(
        is_active=True,
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
        revision = (await db.execute(select(Profile.updated_at).where(Profile.student_id == uuid.UUID(student_id)).with_for_update())).scalar_one_or_none()
        if generated.profile_revision is not None and revision != generated.profile_revision:
            raise RuntimeError("A meta foi alterada durante a geração. Aguarde o treino solicitado pela meta mais recente.")
        current = (
            await db.execute(
                select(WorkoutPlan).where(WorkoutPlan.student_id == uuid.UUID(student_id), WorkoutPlan.active.is_(True)).order_by(WorkoutPlan.version.desc())
            )
        ).scalars().first()
        await db.execute(
            WorkoutPlan.__table__.update().where(WorkoutPlan.student_id == uuid.UUID(student_id), WorkoutPlan.active.is_(True)).values(active=False)
        )
        latest_version = (await db.execute(select(func.max(WorkoutPlan.version)).where(WorkoutPlan.student_id == uuid.UUID(student_id)))).scalar_one()
        next_version = (latest_version or 0) + 1
        db.add(WorkoutPlan(
            student_id=uuid.UUID(student_id), version=next_version, active=True, source=generated.source[:23] + PLAN_CATALOG_TAG,
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
        await ctx["redis"].enqueue_job("import_catalog", _job_id=f"{CATALOG_IMPORT_REVISION}-{catalog_hash}")


class WorkerSettings:
    functions = [import_catalog, generate_workout, refresh_analytics, send_invitation, rotate_weekly_plans]
    cron_jobs = [cron(rotate_weekly_plans, hour=3, minute=15)]
    redis_settings = RedisSettings.from_dsn(config.REDIS_URL)
    on_startup = _startup
    max_jobs = 6
    job_timeout = 1800
