"""Local Kokoro speech, serialized off the event loop and cached by script."""
import asyncio
from concurrent.futures import ThreadPoolExecutor
import logging
from collections import OrderedDict
from dataclasses import dataclass
import hashlib
import io
import json
import os
from pathlib import Path
import tempfile
import threading
import wave

from .config import config

ENGINE_VERSION = "kokoro-int8-multi-lang-v1_0:sherpa-1.12.34:pt-br:pauses-v1"
VOICES = {"pf_dora": 42, "pm_alex": 43, "pm_santa": 44}


class SpeechUnavailable(RuntimeError):
    pass


def split_script(text: str) -> list[tuple[str, float]]:
    """Return spoken lines with the silence preceding each one."""
    result = []
    pause = 0.0
    for line in text.replace("\r\n", "\n").replace("\r", "\n").split("\n"):
        line = line.strip()
        if not line:
            if result:
                pause = 0.8
            continue
        result.append((line, pause if result else 0.0))
        pause = 0.35
    return result


def cache_key(text: str, voice: str, speed: float) -> str:
    return hashlib.sha256(json.dumps([ENGINE_VERSION, voice, speed, text], ensure_ascii=False).encode()).hexdigest()


@dataclass
class Speech:
    audio: bytes
    cues: list[dict]
    duration: float
    format: str = "mp3"

    @property
    def content_type(self):
        return "audio/mpeg" if self.format == "mp3" else "audio/wav"


class SpeechEngine:
    def __init__(self):
        self.lock = threading.Lock()
        self.model = None
        self.model_dir = None
        self.memory: OrderedDict[str, Speech] = OrderedDict()

    def _load(self):
        import sherpa_onnx
        directory = Path(config.TTS_MODELS_DIR)
        if self.model is not None and self.model_dir == directory:
            return self.model
        if not all((directory / name).exists() for name in ("model.int8.onnx", "voices.bin", "tokens.txt", "espeak-ng-data")):
            raise SpeechUnavailable("Modelo de voz indisponível.")
        model = sherpa_onnx.OfflineTtsModelConfig(
            kokoro=sherpa_onnx.OfflineTtsKokoroModelConfig(
                model=str(directory / "model.int8.onnx"), voices=str(directory / "voices.bin"),
                tokens=str(directory / "tokens.txt"), data_dir=str(directory / "espeak-ng-data"), lang="pt-br"),
            num_threads=1, provider="cpu")
        self.model = sherpa_onnx.OfflineTts(sherpa_onnx.OfflineTtsConfig(model=model, max_num_sentences=1))
        self.model_dir = directory
        return self.model

    def synthesize(self, text: str) -> Speech:
        if not config.TTS_ENABLED:
            raise SpeechUnavailable("A voz do instrutor está desabilitada.")
        if config.TTS_VOICE not in VOICES:
            raise SpeechUnavailable("Voz do instrutor inválida.")
        key = cache_key(text, config.TTS_VOICE, config.TTS_SPEED)
        with self.lock:
            cached = self._read(key)
            if cached is not None:
                return cached
            result = self._generate(text)
            try:
                directory = Path(config.TTS_CACHE_DIR)
                directory.mkdir(parents=True, exist_ok=True)
                self._atomic(directory / f"{key}.{result.format}", result.audio)
                self._atomic(directory / f"{key}.json", json.dumps({
                    "cues": result.cues, "durationSeconds": result.duration, "format": result.format,
                }, ensure_ascii=False).encode())
            except OSError:
                self.memory[key] = result
                self.memory.move_to_end(key)
                while len(self.memory) > 50:
                    self.memory.popitem(last=False)
            return result

    @staticmethod
    def _atomic(path: Path, data: bytes):
        temporary = None
        try:
            with tempfile.NamedTemporaryFile(dir=path.parent, delete=False) as file:
                temporary = file.name
                file.write(data)
            os.replace(temporary, path)
        finally:
            if temporary and os.path.exists(temporary):
                os.unlink(temporary)

    def _generate(self, text: str) -> Speech:
        try:
            import numpy as np
            model = self._load()
            parts, cues, count = [], [], 0
            rate = model.sample_rate
            for line, pause in split_script(text):
                silence = int(rate * pause)
                parts.append(np.zeros(silence, dtype=np.float32))
                count += silence
                audio = model.generate(line, sid=VOICES[config.TTS_VOICE], speed=config.TTS_SPEED)
                samples = np.asarray(audio.samples, dtype=np.float32)
                if not len(samples):
                    raise SpeechUnavailable("Não foi possível sintetizar o roteiro.")
                cues.append({"text": line, "start": count / rate, "end": (count + len(samples)) / rate})
                parts.append(samples)
                count += len(samples)
            if not cues:
                raise SpeechUnavailable("Roteiro de voz vazio.")
            pcm = (np.clip(np.concatenate(parts), -1, 1) * 32767).astype('<i2').tobytes()
            try:
                import lameenc
            except ImportError:
                buffer = io.BytesIO()
                with wave.open(buffer, 'wb') as wav:
                    wav.setnchannels(1)
                    wav.setsampwidth(2)
                    wav.setframerate(rate)
                    wav.writeframes(pcm)
                return Speech(buffer.getvalue(), cues, count / rate, "wav")
            encoder = lameenc.Encoder()
            encoder.set_bit_rate(64)
            encoder.set_in_sample_rate(rate)
            encoder.set_channels(1)
            encoder.set_quality(2)
            return Speech(bytes(encoder.encode(pcm) + encoder.flush()), cues, count / rate)
        except SpeechUnavailable:
            raise
        except Exception as exc:
            raise SpeechUnavailable("A voz do instrutor está temporariamente indisponível.") from exc

    def _read(self, key: str) -> Speech | None:
        if key in self.memory:
            self.memory.move_to_end(key)
            return self.memory[key]
        try:
            directory = Path(config.TTS_CACHE_DIR)
            meta = json.loads((directory / f"{key}.json").read_text())
            return Speech((directory / f"{key}.{meta['format']}").read_bytes(), meta['cues'], meta['durationSeconds'], meta['format'])
        except (OSError, ValueError, KeyError, TypeError):
            return None


engine = SpeechEngine()


def _low_priority():
    try:
        os.nice(10)
    except OSError:
        logging.getLogger(__name__).warning("Unable to lower speech thread priority")


# On Linux nice applies to the calling synthesis thread, preserving API priority.
_executor = ThreadPoolExecutor(max_workers=1, initializer=_low_priority, thread_name_prefix="speech")
_pending: dict[str, asyncio.Task] = {}


async def get_speech(text: str) -> Speech:
    return await asyncio.get_running_loop().run_in_executor(_executor, engine.synthesize, text)


async def cached_speech(text: str) -> Speech | None:
    if not config.TTS_ENABLED:
        raise SpeechUnavailable("A voz do instrutor está desabilitada.")
    return await asyncio.to_thread(engine._read, cache_key(text, config.TTS_VOICE, config.TTS_SPEED))


async def schedule_speech(exercise_id: str, text: str) -> None:
    key = cache_key(text, config.TTS_VOICE, config.TTS_SPEED)
    if key in _pending:
        return

    async def prepare():
        from .db import get_arq_pool
        try:
            async with asyncio.timeout(0.5):
                pool = await get_arq_pool()
                await pool.enqueue_job("warm_speech", exercise_id, _job_id=f"speech-{key}")
            # None means the job already exists in arq.
            return
        except Exception:
            logging.getLogger(__name__).info("Speech using local queue: arq unavailable")
        try:
            await get_speech(text)
        except Exception:
            logging.getLogger(__name__).exception("Background speech preparation failed")

    task = asyncio.create_task(prepare())
    _pending[key] = task
    task.add_done_callback(lambda done: _pending.pop(key, None))
