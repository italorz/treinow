FROM python:3.12-slim AS build
COPY --from=ghcr.io/astral-sh/uv:0.11 /uv /uvx /bin/
WORKDIR /app
ENV UV_COMPILE_BYTECODE=1 UV_LINK_MODE=copy
COPY apps/api/pyproject.toml apps/api/uv.lock ./
RUN uv sync --frozen --no-dev --no-install-project
COPY apps/api/alembic.ini ./
COPY apps/api/alembic alembic
COPY apps/api/app app
RUN uv sync --frozen --no-dev

FROM python:3.12-slim
RUN groupadd -r app && useradd -r -g app app
WORKDIR /app
ENV PATH="/app/.venv/bin:$PATH" PYTHONUNBUFFERED=1 PYTHONDONTWRITEBYTECODE=1
COPY --from=build /app/.venv .venv
COPY --from=build /app/alembic.ini ./
COPY --from=build /app/alembic alembic
COPY --from=build /app/app app
COPY catalog ./catalog
COPY videos ./videos
USER app
EXPOSE 3000
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "3000"]
