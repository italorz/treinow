import time
import uuid
from unittest.mock import AsyncMock
from urllib.parse import parse_qs, urlsplit

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app import worker
from app.config import config
from app.speech import Speech
from app.db import get_session
from app.exercise_guidance import exercise_guidance
from app.main import http_exception_handler
from starlette.exceptions import HTTPException as StarletteHTTPException
from app.mappers import exercise_detail, execution_guide
from app.models import Exercise
from app.routers import exercises
from app.security import SessionUser, media_signature, require_user


def guidance():
    return {
        "execucao": ["Mova com controle."], "evitarLesoes": ["Evite compensações."],
        "cargaExcessiva": {"normal": "Esforço muscular.", "alerta": ["Perda de controle."], "pare": "Dor aguda."},
        "narracao": "Mova com controle.", "reviewed": False,
        "narration": {"voice": "pt-BR-AntonioNeural", "audioKey": "core/test-antonio.mp3", "subtitlesKey": "core/test-antonio.srt"},
    }


def exercise(guide=None):
    return Exercise(id=uuid.uuid4(), slug="test", name="Teste", muscle_primary="core", equipment="peso_corporal",
                    complexity="iniciante", target_key="core_teste", classification={}, video={}, guidance=guide)


@pytest.mark.parametrize("guide", [None, guidance()])
def test_mapper_keeps_fallback_and_exposes_execution_guide(guide):
    row = exercise(guide)
    result = exercise_detail(row)
    assert result["guidance"] == exercise_guidance(row)
    assert "narration" not in (result["executionGuide"] or {})
    if guide is None:
        assert result["executionGuide"] is None
    else:
        assert result["executionGuide"] == {**{key: guide[key] for key in ("execucao", "evitarLesoes", "cargaExcessiva", "narracao")},
                                             "disclaimer": "Orientação geral, não substitui um profissional.", "hasNarration": True}
        guide["narration"] = None
        assert execution_guide(row)["hasNarration"] is True


@pytest.fixture
def client(monkeypatch):
    app = FastAPI()
    app.add_exception_handler(StarletteHTTPException, http_exception_handler)
    app.include_router(exercises.router)
    app.dependency_overrides[get_session] = lambda: None
    app.dependency_overrides[require_user] = lambda: SessionUser(str(uuid.uuid4()), "student")
    monkeypatch.setattr(exercises, "_require_exercise", AsyncMock(return_value=exercise(guidance())))
    with TestClient(app) as client:
        yield client


@pytest.mark.parametrize("query", [
    "expires=invalid&signature=bad", "", "expires=1&signature=bad",
    f"expires={int(time.time()) + 300}&signature=bad",
])
def test_invalid_speech_signature_returns_403_before_db_access(client, query):
    assert client.get(f"/v1/media/test/speech?{query}").status_code == 403
    exercises._require_exercise.assert_not_awaited()


def test_speech_url_and_metadata(client, monkeypatch):
    monkeypatch.setattr(exercises, "cached_speech", AsyncMock(return_value=Speech(b"mp3", [{"text": "Mova", "start": 0, "end": 1}], 1)))
    now = int(time.time())
    response = client.get("/v1/exercises/test/speech")
    assert response.status_code == 200
    data = response.json()
    parsed = urlsplit(data["audioUrl"])
    assert parsed.path == "/v1/media/test/speech"
    query = parse_qs(parsed.query)
    expiry = int(query["expires"][0])
    assert now + 900 <= expiry <= int(time.time()) + 900
    assert query["signature"] == [media_signature("test:speech", expiry)]
    assert data["status"] == "ready"
    assert data["durationSeconds"] == 1
    assert data["cues"] == [{"text": "Mova", "start": 0, "end": 1}]
    assert data["text"] == "Mova com controle."


@pytest.mark.parametrize("guide", [None, {}, {"narracao": ""}])
def test_missing_script_returns_404(client, guide):
    exercises._require_exercise.return_value = exercise(guide)
    assert client.get("/v1/exercises/test/speech").status_code == 404


def test_disabled_speech_returns_503(client, monkeypatch):
    monkeypatch.setattr(config, "TTS_ENABLED", False)
    response = client.get("/v1/exercises/test/speech")
    assert response.status_code == 503
    assert "desabilitada" in response.json()["detail"]


def test_uncached_speech_returns_preparing(client, monkeypatch):
    monkeypatch.setattr(exercises, "cached_speech", AsyncMock(return_value=None))
    schedule = AsyncMock()
    monkeypatch.setattr(exercises, "schedule_speech", schedule)
    response = client.get("/v1/exercises/test/speech")
    assert response.status_code == 202
    assert response.json() == {"status": "preparing", "text": "Mova com controle.",
                               "lines": [{"text": "Mova com controle.", "pause": 0}]}
    schedule.assert_awaited_once_with("test", "Mova com controle.")


@pytest.mark.parametrize("range_header,status,body,content_range", [
    (None, 200, b"0123456789", None), ("bytes=2-4", 206, b"234", "bytes 2-4/10"),
    ("bytes=-3", 206, b"789", "bytes 7-9/10"), ("bytes=8-", 206, b"89", "bytes 8-9/10"),
    ("bytes=99-", 416, b"", "bytes */10"), ("bytes=bad", 416, b"", "bytes */10"),
    ("bytes=3-1", 416, b"", "bytes */10"), ("bytes=-0", 416, b"", "bytes */10"),
])
def test_speech_media_range(client, monkeypatch, range_header, status, body, content_range):
    monkeypatch.setattr(exercises, "cached_speech", AsyncMock(return_value=Speech(b"0123456789", [], 1)))
    expiry = int(time.time()) + 900
    signature = media_signature("test:speech", expiry)
    response = client.get(f"/v1/media/test/speech?expires={expiry}&signature={signature}",
                          headers={"Range": range_header} if range_header else {})
    assert response.status_code == status
    assert response.content == body
    assert response.headers.get("content-range") == content_range
    assert response.headers["cache-control"] == "private, max-age=86400"
    if status != 416:
        assert response.headers["content-type"] == "audio/mpeg"


def test_worker_values_include_nullable_guidance():
    item = {"name": "Teste", "musclePrimary": "core", "equipment": "peso_corporal", "targetKey": "core_teste", "video": {}}
    assert worker._exercise_values(item)["guidance"] is None
    assert worker._exercise_values(item, guidance())["guidance"] == guidance()
