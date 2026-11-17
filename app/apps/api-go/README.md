# Trainow Backend (Go)

API and worker implemented in Go, using the existing PostgreSQL, Redis and S3-compatible video storage. The React frontend keeps the same `/v1` contracts.

## Run

Use the existing runtime environment variables from `apps/api/app/config.py`. Python-style `postgresql+asyncpg://` database URLs remain accepted. Secrets must remain runtime-only.

```sh
go build ./cmd/trainow
./trainow api
./trainow worker
```

The API adds missing tables and River migrations on startup. Existing users, password hashes, Redis sessions, exercise UUIDs, profiles, consent, workout plans, logs and measurements are preserved. No production data cleanup is performed.

River provides transactional, durable background jobs in PostgreSQL; Redis continues to hold sessions, rate limits and catalog revision state. This replaces the Python-specific ARQ queue. Weekly renewal stays scheduled at 03:15 UTC and only renews plans older than seven days. Stop accepting changes briefly and drain existing ARQ jobs before switching workers. Keep the old image available for rollback; never run both schedulers concurrently.

The worker streams catalog imports and does not keep a global catalog loaded between jobs. Plan generation loads only the required catalog metadata, excluding narration and guidance bodies. S3 video responses stream with byte ranges; files are not loaded into memory. Passwords retain the Python scrypt format, with a bounded hashing concurrency. Gemini is optional and always falls back to the validated rules engine; no identifying account data enters prompts.

## Authorized Tests Only

```sh
go test ./...
```

Integration tests additionally require explicitly isolated PostgreSQL and Redis instances:

```sh
TRAINOW_TEST_DATABASE_URL=postgresql://USER:PASSWORD@127.0.0.1:PORT/trainow_migration_test \
TRAINOW_TEST_REDIS_URL=redis://127.0.0.1:PORT \
go test ./... -count=1
```

The test database name must be `trainow_migration_test` on loopback. Integration fixtures truncate this database. Never point either test variable at production infrastructure. Tests do not call Gemini or other external services.

Python code is retained as a migration reference and rollback implementation, but is not included or executed in the new runtime image.
