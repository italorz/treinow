import builtins
import time
from pathlib import Path
from types import SimpleNamespace

import numpy as np
import pytest

from app.config import config
from app.speech import SpeechEngine, cache_key, split_script


def test_line_and_block_pause_plan():
    assert split_script("\n Prepare.\r\nRespire.\r\n \r\n\r\nMova.\n") == [
        ("Prepare.", 0), ("Respire.", 0.35), ("Mova.", 0.8)]
    assert split_script("\n \n") == []


def test_cache_key_tracks_voice_speed_text_and_engine(monkeypatch):
    from app import speech
    original = cache_key("Mova.\nRespire.", "pm_alex", 0.95)
    assert original == cache_key("Mova.\nRespire.", "pm_alex", 0.95)
    assert len(original) == 64
    assert original != cache_key("Mova. Respire.", "pm_alex", 0.95)
    assert original != cache_key("Mova.\nRespire.", "pf_dora", 0.95)
    assert original != cache_key("Mova.\nRespire.", "pm_alex", 1)
    monkeypatch.setattr(speech, "ENGINE_VERSION", "next")
    assert original != cache_key("Mova.\nRespire.", "pm_alex", 0.95)


@pytest.fixture
def fake_engine(monkeypatch, tmp_path):
    engine = SpeechEngine()
    calls = []
    def generate(text, **kwargs):
        calls.append((text, kwargs))
        return SimpleNamespace(samples=np.zeros(2400, dtype=np.float32))
    monkeypatch.setattr(engine, "_load", lambda: SimpleNamespace(sample_rate=24000, generate=generate))
    monkeypatch.setattr(config, "TTS_ENABLED", True)
    monkeypatch.setattr(config, "TTS_CACHE_DIR", str(tmp_path / "cache"))
    return engine, calls


def test_cues_and_disk_cache(fake_engine):
    engine, calls = fake_engine
    text = "Prepare.\nRespire.\n\nMova."
    result = engine.synthesize(text)
    assert result.cues == [
        {"text": "Prepare.", "start": 0, "end": 0.1},
        {"text": "Respire.", "start": 0.45, "end": 0.55},
        {"text": "Mova.", "start": 1.35, "end": 1.45},
    ]
    assert result.duration == 1.45
    assert len(calls) == 3
    assert calls[0][1] == {"sid": 43, "speed": 0.95}
    assert SpeechEngine().synthesize(text) == result  # no model needed on disk hit
    assert not list(Path(config.TTS_CACHE_DIR).glob('tmp*'))


def test_memory_cache_on_unwritable_directory_and_lru(fake_engine, monkeypatch, tmp_path):
    engine, calls = fake_engine
    blocked = tmp_path / "file"
    blocked.write_text("not a directory")
    monkeypatch.setattr(config, "TTS_CACHE_DIR", str(blocked / "cache"))
    first = engine.synthesize("Linha 0")
    assert engine.synthesize("Linha 0") is first
    assert len(calls) == 1
    for i in range(1, 52):
        engine.synthesize(f"Linha {i}")
    assert len(engine.memory) == 50
    assert cache_key("Linha 0", config.TTS_VOICE, config.TTS_SPEED) not in engine.memory


def test_wav_when_mp3_encoder_missing(fake_engine, monkeypatch):
    original = builtins.__import__
    def without_lame(name, *args, **kwargs):
        if name == 'lameenc':
            raise ImportError()
        return original(name, *args, **kwargs)
    monkeypatch.setattr(builtins, '__import__', without_lame)
    result = fake_engine[0].synthesize("Respire.")
    assert result.format == 'wav'
    assert result.content_type == 'audio/wav'
    assert result.audio.startswith(b'RIFF')


REAL_SCRIPT = """Prepare o corpo para começar o movimento com calma e atenção.
Apoie bem os pés no chão e mantenha os joelhos alinhados.
Deixe os ombros relaxados e olhe para a frente durante a execução.

Inspire antes de iniciar e solte o ar enquanto realiza o esforço.
Faça cada repetição devagar, sentindo o trabalho dos músculos envolvidos.
Evite prender a respiração ou compensar o movimento com as costas.

Escolha uma carga que permita manter o controle do início ao fim.
Se perceber perda de equilíbrio, diminua o peso e ajuste a postura.
Pare imediatamente se sentir dor aguda, tontura ou desconforto nas articulações."""


def test_real_kokoro_cpu(tmp_path, monkeypatch):
    directory = Path(config.TTS_MODELS_DIR)
    if not all((directory / name).exists() for name in ('model.int8.onnx', 'voices.bin', 'tokens.txt', 'espeak-ng-data')):
        pytest.skip('Kokoro model files are not installed')
    monkeypatch.setattr(config, 'TTS_CACHE_DIR', str(tmp_path))
    engine = SpeechEngine()
    started = time.perf_counter()
    result = engine.synthesize(REAL_SCRIPT)
    elapsed = time.perf_counter() - started
    print(f'\nKOKORO_CPU words={len(REAL_SCRIPT.split())} synthesis_including_load={elapsed:.3f}s duration={result.duration:.3f}s')
    assert len(result.cues) == 9
    assert result.duration > 10
    assert result.format == 'mp3'
    assert len(result.audio) > 1000


async def test_schedule_single_flight_arq(monkeypatch):
    import asyncio
    from unittest.mock import AsyncMock
    from app import db, speech
    started, release = asyncio.Event(), asyncio.Event()
    async def enqueue(*args, **kwargs):
        started.set()
        await release.wait()
    pool = SimpleNamespace(enqueue_job=AsyncMock(side_effect=enqueue))
    monkeypatch.setattr(db, 'get_arq_pool', AsyncMock(return_value=pool))
    synthesize = AsyncMock()
    monkeypatch.setattr(speech, 'get_speech', synthesize)
    await speech.schedule_speech('exercise', 'Mova.')
    await started.wait()
    await speech.schedule_speech('exercise', 'Mova.')
    pool.enqueue_job.assert_awaited_once_with('warm_speech', 'exercise',
        _job_id=f'speech-{cache_key("Mova.", config.TTS_VOICE, config.TTS_SPEED)}')
    release.set()
    await asyncio.gather(*speech._pending.values())
    synthesize.assert_not_awaited()


async def test_local_queue_single_flight_and_serial_synthesis(fake_engine, monkeypatch):
    import asyncio
    import threading
    from unittest.mock import AsyncMock
    from app import db, speech
    engine, calls = fake_engine
    monkeypatch.setattr(speech, 'engine', engine)
    monkeypatch.setattr(db, 'get_arq_pool', AsyncMock(side_effect=ConnectionError))
    started, release = threading.Event(), threading.Event()
    original = engine._generate
    def generate(text):
        started.set()
        assert release.wait(5)
        return original(text)
    monkeypatch.setattr(engine, '_generate', generate)
    await speech.schedule_speech('one', 'Um.')
    assert await asyncio.to_thread(started.wait, 5)
    await speech.schedule_speech('one', 'Um.')
    await speech.schedule_speech('two', 'Dois.')
    assert len(speech._pending) == 2
    # The event loop remains free while synthesis waits in its own thread.
    await asyncio.sleep(0)
    release.set()
    await asyncio.gather(*speech._pending.values())
    assert len(calls) == 2
    assert await speech.cached_speech('Um.') is not None
    assert await speech.cached_speech('Dois.') is not None


async def test_warm_speech_writes_shared_cache(fake_engine, monkeypatch):
    import uuid
    from unittest.mock import AsyncMock, MagicMock
    from app import speech, worker
    engine, calls = fake_engine
    monkeypatch.setattr(speech, 'engine', engine)
    row = SimpleNamespace(guidance={'narracao': 'Prepare.\nRespire.'})
    db = MagicMock()
    db.execute = AsyncMock(return_value=MagicMock(scalar_one_or_none=lambda: row))
    session = MagicMock()
    session.__aenter__ = AsyncMock(return_value=db)
    session.__aexit__ = AsyncMock(return_value=None)
    monkeypatch.setattr(worker, 'AsyncSessionLocal', lambda: session)
    assert await worker.warm_speech({}, str(uuid.uuid4())) == {'status': 'ready'}
    key = cache_key(row.guidance['narracao'], config.TTS_VOICE, config.TTS_SPEED)
    assert SpeechEngine()._read(key) is not None
    await worker.warm_speech({}, str(uuid.uuid4()))
    assert len(calls) == 2  # two lines, generated only once


async def test_planned_warming_active_only_skips_cache_and_limits(monkeypatch):
    import uuid
    from unittest.mock import AsyncMock, MagicMock
    from app import worker
    ids = [str(uuid.uuid4()) for _ in range(25)]
    days = [[{'items': [{'exerciseId': item} for item in ids]}]]
    rows = [SimpleNamespace(guidance={'narracao': str(i)}) for i in range(25)]
    db = MagicMock()
    db.execute = AsyncMock(side_effect=[MagicMock(scalars=lambda: SimpleNamespace(all=lambda: days)),
                                       MagicMock(scalars=lambda: SimpleNamespace(all=lambda: rows))])
    session = MagicMock()
    session.__aenter__ = AsyncMock(return_value=db)
    session.__aexit__ = AsyncMock(return_value=None)
    monkeypatch.setattr(worker, 'AsyncSessionLocal', lambda: session)
    monkeypatch.setattr(worker, 'cached_speech', AsyncMock(side_effect=lambda text: object() if text == '0' else None))
    synthesize = AsyncMock()
    monkeypatch.setattr(worker, 'get_speech', synthesize)
    assert await worker.warm_planned_speech({}) == {'warmed': 20}
    assert synthesize.await_count == 20
    assert synthesize.await_args_list[0].args == ('1',)
    assert 'workout_plans.active IS true' in str(db.execute.call_args_list[0].args[0])
