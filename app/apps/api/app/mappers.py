"""Converte modelos ORM (app/models.py) em dicts públicos serializáveis.

Nunca devolvemos uma instância SQLAlchemy diretamente numa resposta HTTP —
isso evitaria vazar colunas sensíveis (password_hash) e acopla a API ao
schema interno do banco.
"""

from .models import AnalyticsSnapshot, Exercise, Tenant, User, WorkoutSession


def public_user(user: User) -> dict:
    return {
        "id": str(user.id), "name": user.name, "email": user.email, "role": user.role,
        "tenantId": str(user.tenant_id) if user.tenant_id else None,
    }


def exercise_summary(exercise: Exercise) -> dict:
    return {
        "id": str(exercise.id), "slug": exercise.slug, "name": exercise.name,
        "musclePrimary": exercise.muscle_primary, "equipment": exercise.equipment,
        "complexity": exercise.complexity,
        "requiresHighMindMuscleAwareness": exercise.requires_high_mind_muscle_awareness,
        "video": exercise.video,
    }


def exercise_detail(exercise: Exercise) -> dict:
    return {
        "id": str(exercise.id), "slug": exercise.slug, "name": exercise.name,
        "musclePrimary": exercise.muscle_primary, "secondaryMuscles": exercise.secondary_muscles,
        "equipment": exercise.equipment, "complexity": exercise.complexity,
        "movementPattern": exercise.movement_pattern, "targetKey": exercise.target_key,
        "isUnilateral": exercise.is_unilateral, "isWarmup": exercise.is_warmup, "isStretch": exercise.is_stretch,
        "joints": exercise.joints, "requiresHighMindMuscleAwareness": exercise.requires_high_mind_muscle_awareness,
    }


def exercise_related(exercise: Exercise) -> dict:
    return {"id": str(exercise.id), "name": exercise.name, "equipment": exercise.equipment}


def exercise_catalog_row(exercise: Exercise) -> dict:
    return {
        "id": str(exercise.id), "name": exercise.name, "equipment": exercise.equipment,
        "musclePrimary": exercise.muscle_primary, "targetKey": exercise.target_key,
    }


def session_shape(session: WorkoutSession) -> dict:
    return {
        "id": str(session.id), "status": session.status, "selections": session.selections or {},
        "startedAt": session.started_at, "finishedAt": session.finished_at,
    }


def tenant_name(tenant: Tenant) -> dict:
    return {"id": str(tenant.id), "name": tenant.name}


def snapshot_public(snapshot: AnalyticsSnapshot | None) -> dict | None:
    if snapshot is None:
        return None
    return {
        "adherencePercent": snapshot.adherence_percent, "totalVolumeKg": snapshot.total_volume_kg,
        "personalRecords": snapshot.personal_records, "weeklyVolume": snapshot.weekly_volume,
        "weightTrend": snapshot.weight_trend, "bmiTrend": snapshot.bmi_trend,
        "generatedAt": snapshot.generated_at,
    }
