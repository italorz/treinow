import uuid

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from ..db import get_arq_pool, get_session
from ..models import Profile
from ..numeric import round1
from ..schemas.meta import MetaInput
from ..security import SessionUser, assert_student_access, require_user, verify_csrf

router = APIRouter(prefix="/v1", tags=["meta"], dependencies=[Depends(verify_csrf)])


@router.get("/meta")
async def get_meta(db: AsyncSession = Depends(get_session), user: SessionUser = Depends(require_user)):
    if user.role != "student":
        raise HTTPException(403, "Disponível para alunos")
    profile = (await db.execute(select(Profile).where(Profile.student_id == uuid.UUID(user.id)))).scalar_one_or_none()
    return {"meta": _profile_public(profile) if profile else None}


@router.put("/meta")
async def put_meta(request: Request, db: AsyncSession = Depends(get_session), user: SessionUser = Depends(require_user)):
    body = await request.json()
    student_id = user.id if user.role == "student" else str(body.get("studentId") or "")
    await assert_student_access(db, user, student_id)
    raw = body if user.role == "student" else body.get("meta")
    input = MetaInput.model_validate(raw)
    bmi = round1(input.weightKg / ((input.heightCm / 100) ** 2))

    values = dict(
        student_id=uuid.UUID(student_id), goal=input.goal, level=input.level, training_days=input.trainingDays,
        duration_minutes=input.duration_minutes_int, location=input.location, equipment=input.equipment,
        weight_kg=input.weightKg, height_cm=input.heightCm, age=input.age, sex=input.sex,
        priority_muscles=input.priorityMuscles, intensity=input.intensity,
        injuries=[injury.model_dump() for injury in input.injuries], bmi=bmi,
    )
    stmt = pg_insert(Profile).values(**values)
    update_values = {key: value for key, value in values.items() if key != "student_id"}
    stmt = stmt.on_conflict_do_update(index_elements=["student_id"], set_=update_values)
    await db.execute(stmt)
    await db.commit()

    pool = await get_arq_pool()
    job = await pool.enqueue_job("generate_workout", student_id, _job_id=f"workout:{student_id}:{uuid.uuid4()}")
    return {"bmi": bmi, "jobId": job.job_id}


def _profile_public(profile: Profile) -> dict:
    return {
        "goal": profile.goal, "level": profile.level, "trainingDays": profile.training_days,
        "durationMinutes": profile.duration_minutes, "location": profile.location, "equipment": profile.equipment,
        "weightKg": profile.weight_kg, "heightCm": profile.height_cm, "age": profile.age, "sex": profile.sex,
        "priorityMuscles": profile.priority_muscles, "intensity": profile.intensity, "injuries": profile.injuries,
        "bmi": profile.bmi,
    }
