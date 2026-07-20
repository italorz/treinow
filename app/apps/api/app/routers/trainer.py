import hashlib
import secrets
import uuid
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from ..config import config
from ..db import get_arq_pool, get_session
from ..mappers import snapshot_public
from ..models import AnalyticsSnapshot, Consent, Invitation, Membership, Tenant, User
from ..security import SessionUser, assert_student_access, require_user, verify_csrf

router = APIRouter(prefix="/v1", tags=["trainer"], dependencies=[Depends(verify_csrf)])


def _hash(value: str) -> str:
    return hashlib.sha256(value.encode()).hexdigest()


@router.post("/trainer/invitations")
async def create_invitation(request: Request, db: AsyncSession = Depends(get_session), user: SessionUser = Depends(require_user)):
    if user.role != "trainer" or not user.tenant_id:
        raise HTTPException(403, "Somente personal")
    body = await request.json()
    email = str(body.get("email") or "").strip().lower()
    if "@" not in email:
        raise HTTPException(400, "E-mail inválido")
    token = secrets.token_urlsafe(32)
    invitation = Invitation(
        tenant_id=uuid.UUID(user.tenant_id), email=email, token_hash=_hash(token), status="pending",
        expires_at=datetime.now(timezone.utc) + timedelta(days=7), created_by=uuid.UUID(user.id),
    )
    db.add(invitation)
    await db.commit()
    pool = await get_arq_pool()
    await pool.enqueue_job("send_invitation", email, token, _job_id=f"invite:{_hash(token)}")
    result = {"ok": True}
    if config.NODE_ENV == "development":
        result["inviteUrl"] = f"{config.PUBLIC_URL}/convite/{token}"
    return result


@router.post("/invitations/{token}/accept")
async def accept_invitation(token: str, db: AsyncSession = Depends(get_session), user: SessionUser = Depends(require_user)):
    if user.role != "student":
        raise HTTPException(403, "Convite destinado a aluno")
    token_hash = _hash(token)
    invitation = (
        await db.execute(
            select(Invitation).where(Invitation.token_hash == token_hash, Invitation.status == "pending", Invitation.expires_at > datetime.now(timezone.utc))
        )
    ).scalar_one_or_none()
    if not invitation:
        raise HTTPException(404, "Convite inválido ou expirado")

    stmt = pg_insert(Membership).values(
        tenant_id=invitation.tenant_id, student_id=uuid.UUID(user.id), status="active",
    ).on_conflict_do_update(index_elements=["tenant_id", "student_id"], set_={"status": "active"})
    await db.execute(stmt)
    membership = (
        await db.execute(select(Membership).where(Membership.tenant_id == invitation.tenant_id, Membership.student_id == uuid.UUID(user.id)))
    ).scalar_one()
    db.add(Consent(
        membership_id=membership.id, version="1.0", scopes=["progress", "meta", "workouts"],
        document_hash=_hash("consent-v1-full-access"),
    ))
    invitation.status = "accepted"
    invitation.accepted_at = datetime.now(timezone.utc)
    await db.commit()
    return {"ok": True}


@router.post("/memberships/{membership_id}/revoke")
async def revoke_membership(membership_id: str, db: AsyncSession = Depends(get_session), user: SessionUser = Depends(require_user)):
    if user.role != "student":
        raise HTTPException(403, "Somente o aluno revoga")
    try:
        parsed_id = uuid.UUID(membership_id)
    except ValueError:
        raise HTTPException(404, "Vínculo não encontrado")
    membership = (
        await db.execute(select(Membership).where(Membership.id == parsed_id, Membership.student_id == uuid.UUID(user.id)))
    ).scalar_one_or_none()
    if not membership:
        raise HTTPException(404, "Vínculo não encontrado")
    consents = (await db.execute(select(Consent).where(Consent.membership_id == membership.id, Consent.revoked_at.is_(None)))).scalars().all()
    now = datetime.now(timezone.utc)
    for consent in consents:
        consent.revoked_at = now
    membership.status = "revoked"
    await db.commit()
    return {"ok": True}


@router.get("/memberships")
async def list_memberships(db: AsyncSession = Depends(get_session), user: SessionUser = Depends(require_user)):
    if user.role != "student":
        raise HTTPException(403, "Somente o aluno")
    memberships = (await db.execute(select(Membership).where(Membership.student_id == uuid.UUID(user.id), Membership.status == "active"))).scalars().all()
    tenant_ids = [m.tenant_id for m in memberships]
    tenants = (await db.execute(select(Tenant).where(Tenant.id.in_(tenant_ids)))).scalars().all() if tenant_ids else []
    names = {str(t.id): t.name for t in tenants}
    return {"memberships": [{"id": str(m.id), "tenantName": names.get(str(m.tenant_id), "Personal")} for m in memberships]}


@router.get("/trainer/students")
async def list_students(db: AsyncSession = Depends(get_session), user: SessionUser = Depends(require_user)):
    if user.role != "trainer" or not user.tenant_id:
        raise HTTPException(403, "Somente personal")
    memberships = (await db.execute(select(Membership).where(Membership.tenant_id == uuid.UUID(user.tenant_id), Membership.status == "active"))).scalars().all()
    student_ids = [m.student_id for m in memberships]
    students = (await db.execute(select(User).where(User.id.in_(student_ids)))).scalars().all() if student_ids else []
    return {"students": [{"id": str(s.id), "name": s.name, "email": s.email} for s in students]}


@router.get("/trainer/students/{student_id}/progress")
async def student_progress(student_id: str, db: AsyncSession = Depends(get_session), user: SessionUser = Depends(require_user)):
    await assert_student_access(db, user, student_id)
    snapshot = (
        await db.execute(select(AnalyticsSnapshot).where(AnalyticsSnapshot.student_id == uuid.UUID(student_id)))
    ).scalar_one_or_none()
    return {"snapshot": snapshot_public(snapshot)}
