import base64
import hashlib
import hmac
import json
import os
import secrets
import uuid
from dataclasses import dataclass
from datetime import UTC, datetime

from fastapi import Cookie, HTTPException, Request, Response
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from .config import config
from .db import redis
from .models import Consent, Membership

SESSION_TTL_SECONDS = 60 * 60 * 24 * 14
SCRYPT_N, SCRYPT_R, SCRYPT_P, SCRYPT_DKLEN = 16384, 8, 1, 64


@dataclass
class SessionUser:
    id: str
    role: str
    tenant_id: str | None = None


def _sign(value: str, secret: str) -> str:
    digest = hmac.new(secret.encode(), value.encode(), hashlib.sha256).digest()
    return base64.urlsafe_b64encode(digest).rstrip(b"=").decode()


def hash_password(password: str) -> str:
    salt = os.urandom(16)
    derived = hashlib.scrypt(password.encode(), salt=salt, n=SCRYPT_N, r=SCRYPT_R, p=SCRYPT_P, dklen=SCRYPT_DKLEN)
    return f"scrypt${SCRYPT_N}${SCRYPT_R}${SCRYPT_P}${base64.b64encode(salt).decode()}${base64.b64encode(derived).decode()}"


def verify_password(password: str, stored: str) -> bool:
    try:
        _, n, r, p, salt_b64, hash_b64 = stored.split("$")
        salt, expected = base64.b64decode(salt_b64), base64.b64decode(hash_b64)
        derived = hashlib.scrypt(password.encode(), salt=salt, n=int(n), r=int(r), p=int(p), dklen=len(expected))
        return hmac.compare_digest(derived, expected)
    except (ValueError, TypeError):
        return False


async def create_session(response: Response, user: SessionUser) -> str:
    session_id = secrets.token_urlsafe(32)
    csrf = secrets.token_urlsafe(24)
    await redis.set(f"session:{session_id}", json.dumps({"id": user.id, "role": user.role, "tenant_id": user.tenant_id}), ex=SESSION_TTL_SECONDS)
    secure = config.PUBLIC_URL.startswith("https://")
    response.set_cookie("tw_session", f"{session_id}.{_sign(session_id, config.SESSION_SECRET)}", httponly=True, secure=secure, samesite="strict", path="/", max_age=SESSION_TTL_SECONDS)
    response.set_cookie("tw_csrf", f"{csrf}.{_sign(csrf, config.CSRF_SECRET)}", httponly=False, secure=secure, samesite="strict", path="/", max_age=SESSION_TTL_SECONDS)
    return csrf


async def destroy_session(request: Request, response: Response) -> None:
    raw = request.cookies.get("tw_session")
    if raw:
        session_id = raw.split(".")[0]
        await redis.delete(f"session:{session_id}")
    response.delete_cookie("tw_session", path="/")
    response.delete_cookie("tw_csrf", path="/")


async def require_user(request: Request, tw_session: str | None = Cookie(default=None)) -> SessionUser:
    if not tw_session:
        raise HTTPException(401, "Não autenticado")
    session_id, _, signature = tw_session.partition(".")
    if not session_id or not signature or _sign(session_id, config.SESSION_SECRET) != signature:
        raise HTTPException(401, "Sessão inválida")
    stored = await redis.get(f"session:{session_id}")
    if not stored:
        raise HTTPException(401, "Sessão expirada")
    data = json.loads(stored)
    return SessionUser(id=data["id"], role=data["role"], tenant_id=data.get("tenant_id"))


def verify_csrf(request: Request, tw_csrf: str | None = Cookie(default=None)) -> None:
    if request.method in ("GET", "HEAD", "OPTIONS"):
        return
    header = request.headers.get("x-csrf-token")
    token, _, signature = (tw_csrf or "").partition(".")
    if not token or not signature or header != token or _sign(token, config.CSRF_SECRET) != signature:
        raise HTTPException(403, "Token CSRF inválido")


async def assert_student_access(db: AsyncSession, user: SessionUser, student_id: str) -> None:
    if user.role == "student":
        if user.id != student_id:
            raise HTTPException(403, "Acesso negado")
        return
    membership = (
        await db.execute(
            select(Membership).where(
                Membership.tenant_id == uuid.UUID(user.tenant_id),
                Membership.student_id == uuid.UUID(student_id),
                Membership.status == "active",
            )
        )
    ).scalar_one_or_none()
    if not membership:
        raise HTTPException(403, "Vínculo inexistente")
    consent = (
        await db.execute(select(Consent).where(Consent.membership_id == membership.id, Consent.revoked_at.is_(None)))
    ).scalar_one_or_none()
    if not consent:
        raise HTTPException(403, "Consentimento revogado")


def public_user(user) -> dict:
    return {
        "id": str(user.id),
        "name": user.name,
        "email": user.email,
        "role": user.role,
        "tenantId": str(user.tenant_id) if user.tenant_id else None,
    }


def media_signature(exercise_id: str, expires: int) -> str:
    return hmac.new(config.SESSION_SECRET.encode(), f"{exercise_id}:{expires}".encode(), hashlib.sha256).hexdigest()


def safe_equal(a: str, b: str) -> bool:
    return hmac.compare_digest(a, b)


def local_date_key() -> str:
    from zoneinfo import ZoneInfo

    return datetime.now(ZoneInfo("America/Sao_Paulo")).date().isoformat()


def now_utc() -> datetime:
    return datetime.now(UTC)
