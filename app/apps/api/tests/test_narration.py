import uuid

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app import worker
from app.db import get_session
from app.exercise_guidance import exercise_guidance
from app.main import http_exception_handler
from starlette.exceptions import HTTPException as StarletteHTTPException
from app.mappers import exercise_detail, execution_guide
from app.models import Exercise
from app.routers import exercises
from app.security import SessionUser, require_user


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
def client():
    app = FastAPI()
    app.add_exception_handler(StarletteHTTPException, http_exception_handler)
    app.include_router(exercises.router)
    app.dependency_overrides[get_session] = lambda: None
    app.dependency_overrides[require_user] = lambda: SessionUser(str(uuid.uuid4()), "student")
    with TestClient(app) as client:
        yield client


def test_server_speech_endpoints_are_gone(client):
    assert client.get("/v1/exercises/test/speech").status_code == 404
    assert client.get("/v1/media/test/speech").status_code == 404


def test_worker_values_include_nullable_guidance():
    item = {"name": "Teste", "musclePrimary": "core", "equipment": "peso_corporal", "targetKey": "core_teste", "video": {}}
    assert worker._exercise_values(item)["guidance"] is None
    assert worker._exercise_values(item, guidance())["guidance"] == guidance()
