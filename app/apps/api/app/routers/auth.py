import uuid

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from ..db import get_session
from ..mappers import public_user
from ..models import Tenant, User
from ..rate_limit import limiter
from ..schemas.auth import LoginInput, RegisterInput
from ..security import SessionUser, create_session, destroy_session, hash_password, require_user, verify_csrf, verify_password

router = APIRouter(prefix="/v1/auth", tags=["auth"])


@router.get("/me")
async def me(db: AsyncSession = Depends(get_session), user: SessionUser = Depends(require_user)):
    row = (await db.execute(select(User).where(User.id == uuid.UUID(user.id)))).scalar_one_or_none()
    return {"user": public_user(row) if row else None}


@router.post("/register", status_code=201)
@limiter.limit("8 per hour")
async def register(request: Request, input: RegisterInput, response: Response, db: AsyncSession = Depends(get_session)):
    password_hash = hash_password(input.password)
    user = User(name=input.name, email=input.email, password_hash=password_hash, role=input.role)
    try:
        async with db.begin():
            db.add(user)
            await db.flush()
            if input.role == "trainer":
                tenant = Tenant(name=f"Equipe de {input.name}", owner_id=user.id)
                db.add(tenant)
                await db.flush()
                user.tenant_id = tenant.id
    except IntegrityError as error:
        raise HTTPException(409, "E-mail já cadastrado") from error
    csrf = await create_session(response, SessionUser(id=str(user.id), role=user.role, tenant_id=str(user.tenant_id) if user.tenant_id else None))
    return {"user": public_user(user), "csrf": csrf}


@router.post("/login")
@limiter.limit("10 per 15 minutes")
async def login(request: Request, input: LoginInput, response: Response, db: AsyncSession = Depends(get_session)):
    user = (await db.execute(select(User).where(User.email == input.email))).scalar_one_or_none()
    if not user or not verify_password(input.password, user.password_hash):
        raise HTTPException(401, "Credenciais inválidas")
    csrf = await create_session(response, SessionUser(id=str(user.id), role=user.role, tenant_id=str(user.tenant_id) if user.tenant_id else None))
    return {"user": public_user(user), "csrf": csrf}


@router.post("/logout")
async def logout(request: Request, response: Response):
    verify_csrf(request, request.cookies.get("tw_csrf"))
    await destroy_session(request, response)
    return {"ok": True}
