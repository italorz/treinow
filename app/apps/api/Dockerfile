FROM debian:bookworm-slim AS models
RUN apt-get update && apt-get install -y --no-install-recommends bzip2 ca-certificates curl \
    && mkdir -p /models && cd /models \
    && curl -fsSL https://github.com/k2-fsa/sherpa-onnx/releases/download/tts-models/kokoro-int8-multi-lang-v1_0.tar.bz2 | tar xj \
       kokoro-int8-multi-lang-v1_0/model.int8.onnx kokoro-int8-multi-lang-v1_0/voices.bin \
       kokoro-int8-multi-lang-v1_0/tokens.txt kokoro-int8-multi-lang-v1_0/espeak-ng-data

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
RUN apt-get update && apt-get install -y --no-install-recommends libstdc++6 \
    && rm -rf /var/lib/apt/lists/* \
    && groupadd -r app && useradd -r -g app app \
    && mkdir -p /data/tts-cache && chown app:app /data/tts-cache
WORKDIR /app
ENV PATH="/app/.venv/bin:$PATH" PYTHONUNBUFFERED=1 PYTHONDONTWRITEBYTECODE=1
COPY --from=build /app/.venv .venv
COPY --from=build /app/alembic.ini ./
COPY --from=build /app/alembic alembic
COPY --from=build /app/app app
COPY --from=models /models /app/models
COPY catalog ./catalog
COPY ["packages/acervo-videos/HD/Sem categoria", "./videos"]
USER app
EXPOSE 3000
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "3000"]
