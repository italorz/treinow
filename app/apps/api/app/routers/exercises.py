import time
import unicodedata
import uuid

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from starlette.responses import StreamingResponse

from ..config import config
from ..catalog import active_catalog, profile_catalog, planning_exercise, preferred_video_variant
from ..db import get_session, s3_client
from ..mappers import exercise_detail, exercise_related, exercise_summary
from ..models import Exercise, Profile
from ..security import SessionUser, media_signature, require_user, safe_equal, verify_csrf
from ..preparation import injury_compatible

router = APIRouter(prefix="/v1", tags=["exercises"], dependencies=[Depends(verify_csrf)])


def _normalize(value: str) -> str:
    decomposed = unicodedata.normalize("NFD", value)
    without_diacritics = "".join(c for c in decomposed if unicodedata.category(c) != "Mn")
    return "".join(c if c.isalnum() else " " for c in without_diacritics.lower()).strip()


@router.get("/exercises")
async def list_exercises(request: Request, db: AsyncSession = Depends(get_session), _user: SessionUser = Depends(require_user)):
    q = request.query_params
    profile = await _user_profile(db, _user)
    query = select(Exercise).where(profile_catalog(profile.sex if profile else None))
    if exercise_type := q.get("type"):
        if exercise_type == "warmup":
            query = query.where(Exercise.is_warmup.is_(True), Exercise.is_stretch.is_(False))
        elif exercise_type in ("Strength", "Stretching", "Aerobic"):
            query = query.where(Exercise.classification['knowledge']['exerciseType'].astext == exercise_type)
        else:
            raise HTTPException(400, "Categoria de exercício inválida")
    if muscle := q.get("muscle"):
        query = query.where((Exercise.muscle_primary == muscle) | Exercise.classification['knowledge']['targetMuscles'].contains([muscle]))
    if equipment := q.get("equipment"):
        query = query.where(Exercise.equipment == equipment)
    if search := q.get("search"):
        for token in _normalize(search).split():
            query = query.where(Exercise.search_tokens.any(token))
    cursor = q.get("cursor")
    if cursor:
        try:
            query = query.where(Exercise.id > uuid.UUID(cursor))
        except ValueError:
            pass
    limit = min(max(int(q.get("limit", 9) or 9), 1), 24)
    rows = (await db.execute(query.order_by(Exercise.id).limit(limit))).scalars().all()
    return {
        "items": [exercise_summary(row) for row in rows],
        "nextCursor": str(rows[-1].id) if len(rows) == limit else None,
    }


@router.get("/exercises/muscle-summary")
async def muscle_summary(db: AsyncSession = Depends(get_session), _user: SessionUser = Depends(require_user)):
    profile = await _user_profile(db, _user)
    targets = select(func.jsonb_array_elements_text(Exercise.classification['knowledge']['targetMuscles']).label('muscle')).where(profile_catalog(profile.sex if profile else None)).subquery()
    rows = (await db.execute(select(targets.c.muscle, func.count()).group_by(targets.c.muscle))).all()
    return {"counts": {muscle: count for muscle, count in rows}}


@router.get("/exercises/{exercise_id}")
async def get_exercise(exercise_id: str, db: AsyncSession = Depends(get_session), _user: SessionUser = Depends(require_user)):
    exercise = await _require_exercise(db, exercise_id)
    profile = await _user_profile(db, _user)
    related_query = select(Exercise).where(profile_catalog(profile.sex if profile else None), Exercise.id != exercise.id, Exercise.needs_review.is_(False), (Exercise.is_warmup.is_(True) | Exercise.is_stretch.is_(True)))
    related = (await db.execute(related_query)).scalars().all()
    available = set(profile.equipment or []) | {"peso_corporal"} if profile else None
    related = [e for e in related if (not profile or injury_compatible(planning_exercise(e), profile.injuries or []))
               and (available is None or set(planning_exercise(e).required_equipment).issubset(available))]
    targets = set(planning_exercise(exercise).target_muscles) | {exercise.muscle_primary}
    related = [e for e in related if targets & set(planning_exercise(e).target_muscles)
               or exercise.muscle_primary == "ombro" and e.target_key.startswith("manguito_rotador_")]
    warmups = sorted([e for e in related if e.is_warmup and not e.is_stretch], key=lambda e: (not e.target_key.startswith("manguito_rotador_"), e.complexity != "iniciante", e.name))
    stretches = sorted([e for e in related if e.is_stretch], key=lambda e: (e.complexity != "iniciante", e.name))
    return {
        "exercise": exercise_detail(exercise),
        "warmups": [exercise_related(e) for e in warmups[:3]],
        "stretches": [exercise_related(e) for e in stretches[:3]],
    }


@router.get("/exercises/{exercise_id}/video-url")
async def get_video_url(exercise_id: str, db: AsyncSession = Depends(get_session), _user: SessionUser = Depends(require_user), variant: str | None = None):
    exercise = await _require_exercise(db, exercise_id)
    profile = await _user_profile(db, _user)
    variants = exercise.video.get("variants", {})
    preferred = preferred_video_variant(profile.sex if profile else None)
    if variant is not None and variant not in variants:
        raise HTTPException(400, 'Variante de vídeo indisponível')
    if variant is None and preferred and preferred not in variants:
        raise HTTPException(404, "Não há demonstração disponível para o sexo informado no perfil.")
    variant = variant or preferred or next(iter(variants), "padrao")
    expires = int(time.time()) + 300
    signature = media_signature(f"{exercise_id}:{variant}", expires)
    return {"url": f"{config.PUBLIC_URL}/v1/media/{exercise_id}?variant={variant}&expires={expires}&signature={signature}"}


async def _user_profile(db: AsyncSession, user: SessionUser) -> Profile | None:
    return (await db.execute(select(Profile).where(Profile.student_id == uuid.UUID(user.id)))).scalar_one_or_none()


@router.get("/media/{exercise_id}")
async def get_media(exercise_id: str, request: Request, db: AsyncSession = Depends(get_session)):
    expires = request.query_params.get("expires")
    signature = request.query_params.get("signature")
    variant = request.query_params.get("variant", "padrao")
    try:
        expiry = int(expires or 0)
    except ValueError:
        raise HTTPException(403, 'Expiração de mídia inválida')
    expected = media_signature(f"{exercise_id}:{variant}", expiry)
    if not signature or not expires or expiry < time.time() or not safe_equal(signature, expected):
        raise HTTPException(403, "URL de mídia inválida ou expirada")
    exercise = await _require_exercise(db, exercise_id)
    range_header = request.headers.get("range")

    variants = exercise.video.get("variants", {})
    selected_video = variants.get(variant) if variants else exercise.video
    if not selected_video:
        raise HTTPException(404, "Variante de vídeo não encontrada")
    kwargs = {"Bucket": config.MINIO_BUCKET, "Key": selected_video["objectKey"]}
    if range_header:
        kwargs["Range"] = range_header

    s3_context = s3_client()
    s3 = await s3_context.__aenter__()
    try:
        obj = await s3.get_object(**kwargs)
    except Exception:
        await s3_context.__aexit__(None, None, None)
        raise

    headers = {"cache-control": "private, max-age=86400", "accept-ranges": "bytes", "content-length": str(obj.get("ContentLength", ""))}
    status_code = 200
    if range_header and obj.get("ContentRange"):
        headers["content-range"] = obj["ContentRange"]
        status_code = 206

    async def body_stream():
        try:
            async for chunk in obj["Body"]:
                yield chunk
        finally:
            await s3_context.__aexit__(None, None, None)

    return StreamingResponse(body_stream(), status_code=status_code, media_type=obj.get("ContentType", "video/mp4"), headers=headers)


async def _require_exercise(db: AsyncSession, exercise_id: str) -> Exercise:
    try:
        parsed = uuid.UUID(exercise_id)
    except ValueError:
        raise HTTPException(400, "Exercício inválido")
    exercise = (await db.execute(select(Exercise).where(Exercise.id == parsed, active_catalog()))).scalar_one_or_none()
    if not exercise:
        raise HTTPException(404, "Exercício não encontrado")
    return exercise
