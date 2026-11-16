import time
import uuid
from contextlib import asynccontextmanager
from unittest.mock import AsyncMock
from urllib.parse import parse_qs, urlsplit

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app import worker
from app.db import get_session
from app.exercise_guidance import exercise_guidance
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
        assert execution_guide(row)["hasNarration"] is False


def test_srt_to_vtt_retains_multiline_cues_and_utf8():
    assert exercises.srt_to_vtt("\ufeff1\r\n00:00:01,250 --> 00:00:03,500\r\nAtenção\r\nSegunda linha\r\n\r\n2\r\n00:00:04,000 --> 00:00:05,100\r\nRespire.\r\n") == (
        "WEBVTT\n\n1\n00:00:01.250 --> 00:00:03.500\nAtenção\nSegunda linha\n\n2\n00:00:04.000 --> 00:00:05.100\nRespire.\n"
    )


@pytest.fixture
def client(monkeypatch):
    app = FastAPI()
    app.include_router(exercises.router)
    app.dependency_overrides[get_session] = lambda: None
    app.dependency_overrides[require_user] = lambda: SessionUser(str(uuid.uuid4()), "student")
    monkeypatch.setattr(exercises, "_require_exercise", AsyncMock(return_value=exercise(guidance())))
    with TestClient(app) as client:
        yield client


@pytest.mark.parametrize("query", [
    "kind=audio&expires=invalid&signature=bad", "kind=audio", "kind=audio&expires=1&signature=bad",
    f"kind=audio&expires={int(time.time()) + 300}&signature=bad",
    f"kind=audio&expires={int(time.time()) + 300}&signature={media_signature('test:narration-subtitles', int(time.time()) + 300)}",
])
def test_invalid_narration_signature_returns_403_before_db_access(client, query):
    assert client.get(f"/v1/media/test/narration?{query}").status_code == 403
    exercises._require_exercise.assert_not_awaited()


def test_narration_urls_have_separate_signatures_and_300_second_expiry(client):
    now = int(time.time())
    response = client.get("/v1/exercises/test/narration-url")
    assert response.status_code == 200
    data = response.json()
    for kind, field in (("audio", "audioUrl"), ("subtitles", "subtitlesUrl")):
        parsed = urlsplit(data[field])
        assert parsed.path == "/v1/media/test/narration"
        query = parse_qs(parsed.query)
        expiry = int(query["expires"][0])
        assert now + 300 <= expiry <= int(time.time()) + 300
        assert query["kind"] == [kind]
        assert query["signature"] == [media_signature(f"test:narration-{kind}", expiry)]


def test_missing_narration_returns_404(client):
    exercises._require_exercise.return_value = exercise()
    assert client.get("/v1/exercises/test/narration-url").status_code == 404


@pytest.mark.parametrize("kind", ["audio", "subtitles"])
def test_narration_storage_range_and_vtt_response(client, monkeypatch, kind):
    closed = []
    calls = []
    class Body:
        async def read(self): return "1\n00:00:00,000 --> 00:00:01,000\nAtenção".encode()
        def __aiter__(self): return self.chunks()
        async def chunks(self): yield b"mp3"
    class Storage:
        async def get_object(self, **kwargs):
            calls.append(kwargs)
            return {"Body": Body(), "ContentLength": 3, "ContentRange": "bytes 0-2/10"}
    @asynccontextmanager
    async def storage():
        try: yield Storage()
        finally: closed.append(True)
    monkeypatch.setattr(exercises, "s3_client", storage)
    expires = int(time.time()) + 300
    signature = media_signature(f"test:narration-{kind}", expires)
    response = client.get(f"/v1/media/test/narration?kind={kind}&expires={expires}&signature={signature}", headers={"Range": "bytes=0-2"})
    assert closed == [True]
    assert calls[0]["Bucket"] == "trainow-narracao"
    if kind == "audio":
        assert calls[0]["Key"] == "core/test-antonio.mp3"
        assert calls[0]["Range"] == "bytes=0-2"
        assert response.status_code == 206
        assert response.headers["content-range"] == "bytes 0-2/10"
        assert response.headers["content-type"] == "audio/mpeg"
        assert response.content == b"mp3"
    else:
        assert calls[0]["Key"] == "core/test-antonio.srt"
        assert "Range" not in calls[0]
        assert response.status_code == 200
        assert response.headers["content-type"] == "text/vtt; charset=utf-8"
        assert response.text.startswith("WEBVTT\n\n1\n00:00:00.000")
        assert "Atenção" in response.text


def test_worker_values_include_nullable_guidance():
    item = {"name": "Teste", "musclePrimary": "core", "equipment": "peso_corporal", "targetKey": "core_teste", "video": {}}
    assert worker._exercise_values(item)["guidance"] is None
    assert worker._exercise_values(item, guidance())["guidance"] == guidance()
