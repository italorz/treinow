from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.encoders import jsonable_encoder
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from slowapi import _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded
from slowapi.middleware import SlowAPIMiddleware
from starlette.exceptions import HTTPException as StarletteHTTPException

from .config import config
from .db import close_infra, ensure_bucket, get_arq_pool
from .rate_limit import limiter
from .routers import auth, exercises, jobs, meta, trainer, workouts
from .workout_engine import PlanGenerationError

MAX_BODY_BYTES = 256 * 1024


@asynccontextmanager
async def lifespan(_app: FastAPI):
    await ensure_bucket()
    await get_arq_pool()
    yield
    await close_infra()


app = FastAPI(title="Treinow API", version="1.0.0", docs_url="/docs", openapi_url="/docs/openapi.json", lifespan=lifespan)
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)
app.add_middleware(SlowAPIMiddleware)


@app.middleware("http")
async def security_headers(request: Request, call_next):
    content_length = request.headers.get("content-length")
    if content_length and int(content_length) > MAX_BODY_BYTES:
        return JSONResponse({"error": "Corpo da requisição excede o limite permitido"}, status_code=413)
    response = await call_next(request)
    response.headers["x-content-type-options"] = "nosniff"
    response.headers["x-frame-options"] = "DENY"
    response.headers["referrer-policy"] = "no-referrer"
    if config.PUBLIC_URL.startswith("https://"):
        response.headers["strict-transport-security"] = "max-age=15552000; includeSubDomains"
    return response


@app.exception_handler(StarletteHTTPException)
async def http_exception_handler(_request: Request, exc: StarletteHTTPException):
    return JSONResponse({"error": exc.detail}, status_code=exc.status_code)


@app.exception_handler(RequestValidationError)
async def validation_exception_handler(_request: Request, exc: RequestValidationError):
    # Pydantic v2 pode incluir a instância da exceção Python original em ctx,
    # que json puro não serializa; jsonable_encoder resolve com custom_encoder.
    details = jsonable_encoder(exc.errors(), exclude={"input"}, custom_encoder={Exception: str})
    return JSONResponse({"error": "Dados inválidos", "details": details}, status_code=400)


@app.exception_handler(PlanGenerationError)
async def plan_generation_error_handler(_request: Request, exc: PlanGenerationError):
    return JSONResponse({"error": str(exc)}, status_code=400)


@app.exception_handler(Exception)
async def unhandled_exception_handler(_request: Request, _exc: Exception):
    return JSONResponse({"error": "Falha interna"}, status_code=500)


@app.get("/health")
async def health():
    return {"ok": True}


app.include_router(auth.router)
app.include_router(meta.router)
app.include_router(exercises.router)
app.include_router(workouts.router)
app.include_router(trainer.router)
app.include_router(jobs.router)
