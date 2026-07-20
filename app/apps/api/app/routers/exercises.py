import time
import unicodedata
import uuid

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from starlette.responses import StreamingResponse

from ..config import config
from ..db import get_session, s3_client
from ..mappers import exercise_detail, exercise_related, exercise_summary
from ..models import Exercise
from ..security import SessionUser, media_signature, require_user, safe_equal, verify_csrf

router = APIRouter(prefix="/v1", tags=["exercises"], dependencies=[Depends(verify_csrf)])


def _normalize(value: str) -> str:
    decomposed = unicodedata.normalize("NFD", value)
    without_diacritics = "".join(c for c in decomposed if unicodedata.category(c) != "Mn")
    return "".join(c if c.isalnum() else " " for c in without_diacritics.lower()).strip()


@router.get("/exercises")
async def list_exercises(request: Request, db: AsyncSession = Depends(get_session), _user: SessionUser = Depends(require_user)):
    q = request.query_params
    query = select(Exercise)
    if muscle := q.get("muscle"):
        query = query.where(Exercise.muscle_primary == muscle)
    if equipment := q.get("equipment"):
        query = query.where(Exercise.equipment == equipment)
    if search := q.get("search"):
        query = query.where(Exercise.search_tokens.any(_normalize(search)))
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
    rows = (await db.execute(select(Exercise.muscle_primary, func.count()).group_by(Exercise.muscle_primary))).all()
    return {"counts": {muscle: count for muscle, count in rows}}


@router.get("/exercises/{exercise_id}")
async def get_exercise(exercise_id: str, db: AsyncSession = Depends(get_session), _user: SessionUser = Depends(require_user)):
    exercise = await _require_exercise(db, exercise_id)
    related_query = select(Exercise).where(Exercise.muscle_primary == exercise.muscle_primary, Exercise.id != exercise.id, Exercise.needs_review.is_(False))
    warmups = (await db.execute(related_query.where(Exercise.is_warmup.is_(True)).limit(8))).scalars().all()
    stretches = (await db.execute(related_query.where(Exercise.is_stretch.is_(True)).limit(8))).scalars().all()
    if exercise.muscle_primary == "ombro":
        warmups = sorted(warmups, key=lambda e: e.target_key.startswith("manguito_rotador_"), reverse=True)
    return {
        "exercise": exercise_detail(exercise),
        "warmups": [exercise_related(e) for e in warmups[:3]],
        "stretches": [exercise_related(e) for e in stretches[:3]],
    }


@router.get("/exercises/{exercise_id}/video-url")
async def get_video_url(exercise_id: str, db: AsyncSession = Depends(get_session), _user: SessionUser = Depends(require_user)):
    await _require_exercise(db, exercise_id)
    expires = int(time.time()) + 300
    signature = media_signature(exercise_id, expires)
    return {"url": f"{config.PUBLIC_URL}/v1/media/{exercise_id}?expires={expires}&signature={signature}"}


@router.get("/media/{exercise_id}")
async def get_media(exercise_id: str, request: Request, db: AsyncSession = Depends(get_session)):
    expires = request.query_params.get("expires")
    signature = request.query_params.get("signature")
    expected = media_signature(exercise_id, int(expires or 0))
    if not signature or not expires or int(expires) < time.time() or not safe_equal(signature, expected):
        raise HTTPException(403, "URL de mídia inválida ou expirada")
    exercise = await _require_exercise(db, exercise_id)
    range_header = request.headers.get("range")

    kwargs = {"Bucket": config.MINIO_BUCKET, "Key": exercise.video["objectKey"]}
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
    exercise = (await db.execute(select(Exercise).where(Exercise.id == parsed))).scalar_one_or_none()
    if not exercise:
        raise HTTPException(404, "Exercício não encontrado")
    return exercise
