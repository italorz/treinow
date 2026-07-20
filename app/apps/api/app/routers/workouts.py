import uuid
from datetime import date, datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from ..db import get_arq_pool, get_session
from ..mappers import session_shape
from ..models import Exercise, Measurement, WorkoutLog, WorkoutPlan, WorkoutSession
from ..numeric import round1
from ..security import SessionUser, assert_student_access, local_date_key, require_user, verify_csrf

router = APIRouter(prefix="/v1", tags=["workouts"], dependencies=[Depends(verify_csrf)])

PHASE_ORDER = {"alongamento": 0, "aquecimento": 1, "principal": 2}


def _js_weekday() -> int:
    # Python date.weekday(): segunda=0..domingo=6; JS Date#getDay(): domingo=0..sabado=6
    return (datetime.now().weekday() + 1) % 7


def _is_uuid(value) -> bool:
    try:
        uuid.UUID(value)
        return True
    except (ValueError, AttributeError, TypeError):
        return False


def _student_id_for(user: SessionUser, request: Request) -> str:
    return user.id if user.role == "student" else str(request.query_params.get("studentId") or "")


async def _resolve_plan_day(db: AsyncSession, student_id: str, weekday: int) -> dict | None:
    plan = (
        await db.execute(
            select(WorkoutPlan).where(WorkoutPlan.student_id == uuid.UUID(student_id), WorkoutPlan.active.is_(True)).order_by(WorkoutPlan.version.desc())
        )
    ).scalars().first()
    day = next((d for d in (plan.days if plan else []) if d.get("weekday") == weekday), None)
    if not day:
        return None

    raw_ids = {item["exerciseId"] for item in day["exercises"]} | {rid for item in day["exercises"] for rid in item.get("reserveExerciseIds", [])}
    ids = [uuid.UUID(rid) for rid in raw_ids if _is_uuid(rid)]
    exercises = (await db.execute(select(Exercise).where(Exercise.id.in_(ids)))).scalars().all() if ids else []
    by_id = {str(e.id): e for e in exercises}

    cutoff = datetime.now(timezone.utc) - timedelta(days=8)
    recent_rows = (
        await db.execute(select(WorkoutLog.exercise_id).where(WorkoutLog.student_id == uuid.UUID(student_id), WorkoutLog.completed_at >= cutoff))
    ).scalars().all()
    familiar = {str(row) for row in recent_rows}

    ordered_items = sorted(day["exercises"], key=lambda item: PHASE_ORDER.get(item["phase"], 99))
    exercises_out = []
    for item in ordered_items:
        exercise = by_id.get(item["exerciseId"])
        exercises_out.append({
            **item,
            "id": item["exerciseId"],
            "name": exercise.name if exercise else None,
            "equipment": exercise.equipment if exercise else None,
            "musclePrimary": exercise.muscle_primary if exercise else None,
            "targetKey": exercise.target_key if exercise else None,
            "warmup": item["phase"] == "aquecimento" or item.get("warmup") is True,
            "reserves": [
                {
                    "id": rid,
                    **({"name": by_id[rid].name, "equipment": by_id[rid].equipment} if rid in by_id else {}),
                    "familiar": rid in familiar,
                }
                for rid in item.get("reserveExerciseIds", [])
            ],
        })
    return {**day, "exercises": exercises_out}


@router.get("/workouts/calendar")
async def calendar(request: Request, db: AsyncSession = Depends(get_session), user: SessionUser = Depends(require_user)):
    student_id = _student_id_for(user, request)
    await assert_student_access(db, user, student_id)
    plan = (
        await db.execute(
            select(WorkoutPlan).where(WorkoutPlan.student_id == uuid.UUID(student_id), WorkoutPlan.active.is_(True)).order_by(WorkoutPlan.version.desc())
        )
    ).scalars().first()
    return {"plan": {"days": plan.days} if plan else None}


@router.get("/workouts/today")
async def today(request: Request, db: AsyncSession = Depends(get_session), user: SessionUser = Depends(require_user)):
    student_id = _student_id_for(user, request)
    await assert_student_access(db, user, student_id)
    return {"day": await _resolve_plan_day(db, student_id, _js_weekday())}


@router.get("/workouts/day/{weekday}")
async def day(weekday: int, request: Request, db: AsyncSession = Depends(get_session), user: SessionUser = Depends(require_user)):
    student_id = _student_id_for(user, request)
    await assert_student_access(db, user, student_id)
    if weekday < 0 or weekday > 6:
        raise HTTPException(400, "Dia inválido")
    return {"day": await _resolve_plan_day(db, student_id, weekday)}


@router.post("/workouts/logs")
async def create_log(request: Request, db: AsyncSession = Depends(get_session), user: SessionUser = Depends(require_user)):
    body = await request.json()
    student_id = user.id if user.role == "student" else str(body.get("studentId") or "")
    await assert_student_access(db, user, student_id)
    log = WorkoutLog(
        student_id=uuid.UUID(student_id), exercise_id=uuid.UUID(body["exerciseId"]),
        sets=min(20, max(1, int(body["sets"]))), reps=min(100, max(1, int(body["reps"]))),
        load_kg=min(1000.0, max(0.0, float(body.get("loadKg") or 0))), completed_at=datetime.now(timezone.utc),
    )
    db.add(log)
    await db.commit()
    pool = await get_arq_pool()
    await pool.enqueue_job("refresh_analytics", student_id, _job_id=f"analytics:{student_id}:{uuid.uuid4()}")
    return {"ok": True}


@router.post("/workouts/sessions/start")
async def start_session(db: AsyncSession = Depends(get_session), user: SessionUser = Depends(require_user)):
    if user.role != "student":
        raise HTTPException(403, "Somente o aluno inicia o treino")
    workout_date = date.fromisoformat(local_date_key())
    stmt = pg_insert(WorkoutSession).values(
        student_id=uuid.UUID(user.id), workout_date=workout_date, selections={}, status="active",
    ).on_conflict_do_nothing(index_elements=["student_id", "workout_date"])
    await db.execute(stmt)
    await db.commit()
    session = (
        await db.execute(select(WorkoutSession).where(WorkoutSession.student_id == uuid.UUID(user.id), WorkoutSession.workout_date == workout_date))
    ).scalar_one()
    return {"session": session_shape(session)}


@router.get("/workouts/sessions/today")
async def session_today(db: AsyncSession = Depends(get_session), user: SessionUser = Depends(require_user)):
    workout_date = date.fromisoformat(local_date_key())
    session = (
        await db.execute(select(WorkoutSession).where(WorkoutSession.student_id == uuid.UUID(user.id), WorkoutSession.workout_date == workout_date))
    ).scalar_one_or_none()
    return {"session": session_shape(session) if session else None}


@router.patch("/workouts/sessions/{session_id}/selection")
async def update_selection(session_id: str, request: Request, db: AsyncSession = Depends(get_session), user: SessionUser = Depends(require_user)):
    body = await request.json()
    slot_exercise_id, selected_exercise_id = body.get("slotExerciseId"), body.get("selectedExerciseId")
    if not _is_uuid(session_id) or not _is_uuid(slot_exercise_id) or (selected_exercise_id and not _is_uuid(selected_exercise_id)):
        raise HTTPException(400, "Seleção inválida")
    day = await _resolve_plan_day(db, user.id, _js_weekday())
    slot = next((item for item in (day or {}).get("exercises", []) if item["id"] == slot_exercise_id), None)
    allowed_ids = {slot["id"], *(reserve["id"] for reserve in slot.get("reserves", []))} if slot else set()
    if not slot or (selected_exercise_id and selected_exercise_id not in allowed_ids):
        raise HTTPException(400, "O exercício selecionado não pertence a este bloco")

    session = (
        await db.execute(select(WorkoutSession).where(WorkoutSession.id == uuid.UUID(session_id), WorkoutSession.student_id == uuid.UUID(user.id), WorkoutSession.status == "active"))
    ).scalar_one_or_none()
    if not session:
        raise HTTPException(404, "Treino ativo não encontrado")
    selections = dict(session.selections or {})
    if selected_exercise_id:
        selections[slot_exercise_id] = selected_exercise_id
    else:
        selections.pop(slot_exercise_id, None)
    session.selections = selections
    await db.commit()
    await db.refresh(session)
    return {"session": session_shape(session)}


@router.post("/workouts/sessions/{session_id}/finish")
async def finish_session(session_id: str, request: Request, db: AsyncSession = Depends(get_session), user: SessionUser = Depends(require_user)):
    body = await request.json()
    if not _is_uuid(session_id):
        raise HTTPException(404, "Treino ativo não encontrado")
    session = (
        await db.execute(select(WorkoutSession).where(WorkoutSession.id == uuid.UUID(session_id), WorkoutSession.student_id == uuid.UUID(user.id), WorkoutSession.status == "active"))
    ).scalar_one_or_none()
    if not session:
        raise HTTPException(404, "Treino ativo não encontrado")

    day = await _resolve_plan_day(db, user.id, _js_weekday())
    valid_selections: dict[str, str] = {}
    for item in (day or {}).get("exercises", []):
        selected_id = (session.selections or {}).get(item["id"])
        allowed_ids = {item["id"], *(reserve["id"] for reserve in item.get("reserves", []))}
        if isinstance(selected_id, str) and selected_id in allowed_ids:
            valid_selections[item["id"]] = selected_id
    missing = [item["id"] for item in (day or {}).get("exercises", []) if item["id"] not in valid_selections]
    if missing and not body.get("confirmIncomplete"):
        return {"requiresConfirmation": True, "missingCount": len(missing)}

    selected = [value for value in valid_selections.values() if _is_uuid(value)]
    now = datetime.now(timezone.utc)
    for exercise_id in selected:
        db.add(WorkoutLog(student_id=uuid.UUID(user.id), exercise_id=uuid.UUID(exercise_id), sets=1, reps=1, load_kg=0, completed_at=now, session_id=session.id))
    session.status = "finished"
    session.comment = str(body.get("comment") or "")[:1000]
    session.missing_exercise_ids = missing
    session.finished_at = now
    await db.commit()

    pool = await get_arq_pool()
    await pool.enqueue_job("refresh_analytics", user.id, _job_id=f"analytics:{user.id}:{uuid.uuid4()}")
    return {"finished": True}


@router.post("/measurements")
async def create_measurement(request: Request, db: AsyncSession = Depends(get_session), user: SessionUser = Depends(require_user)):
    if user.role != "student":
        raise HTTPException(403, "Somente o aluno registra medidas")
    body = await request.json()
    height = float(body["heightCm"])
    weight = float(body["weightKg"])
    db.add(Measurement(
        student_id=uuid.UUID(user.id), measured_at=datetime.now(timezone.utc), weight_kg=weight, height_cm=int(height),
        bmi=round1(weight / ((height / 100) ** 2)), waist_cm=None if body.get("waistCm") is None else float(body["waistCm"]),
    ))
    await db.commit()
    pool = await get_arq_pool()
    await pool.enqueue_job("refresh_analytics", user.id, _job_id=f"analytics:{user.id}:{uuid.uuid4()}")
    return {"ok": True}
