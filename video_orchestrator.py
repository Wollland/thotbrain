"""
ThOTBRAIN — Video Orchestrator
Genera vídeo contextual inmersivo durante la investigación.
Componentes: Prompt Extractor + WanGP Controller + Clip Manager
"""
import os
import json
import time
import asyncio
import logging
import hashlib
import subprocess
from pathlib import Path
from typing import Optional, Dict, List
from dataclasses import dataclass, field

import httpx

log = logging.getLogger("thotbrain.video")

# ── Config ──────────────────────────────────────────────────────────
KIMI_URL = os.environ.get("VLLM_BASE_URL", "http://100.64.0.33:8000")
KIMI_MODEL = os.environ.get("DEFAULT_MODEL", "/models/Kimi-K2.5-Instruct")
WANGP_URL = "http://100.64.0.29:8400"
TTS_URL = "http://100.64.0.29:8600"
ASR_URL = "http://100.64.0.29:8500"

CLIP_DIR = Path("/tmp/thotbrain_clips")
CLIP_DIR.mkdir(exist_ok=True)


# ── Data classes ────────────────────────────────────────────────────
@dataclass
class VideoClip:
    clip_id: str
    path: str
    url: str
    prompt: str
    subtitle: str
    duration: float = 0.0
    has_audio: bool = True

@dataclass
class SessionState:
    topic: str = ""
    is_active: bool = False
    clip_counter: int = 0
    last_frame_path: Optional[str] = None
    last_prompt: Optional[str] = None
    clip_cache: Dict[str, str] = field(default_factory=dict)  # prompt_hash -> clip_url
    pending_clips: List[VideoClip] = field(default_factory=list)
    current_phase: str = "idle"


# ── Prompt Extractor ────────────────────────────────────────────────
VISUAL_PROMPT_SYSTEM = """You are a cinematographer creating video descriptions for ambient background footage.

Rules:
- Describe ONE visual scene that represents the research topic
- Include: camera angle, lighting, movement, atmosphere
- Maximum 40 words in English
- Style: cinematic, atmospheric, documentary
- Include natural ambient sounds (wind, water, machinery, city, etc.)
- If previous context provided, ensure visual continuity
- NO text, NO people talking, NO UI elements — only ambient visuals

Respond ONLY with the scene description, nothing else."""


async def extract_visual_prompt(
    finding_text: str,
    topic: str,
    previous_prompt: Optional[str] = None,
    http_client: Optional[httpx.AsyncClient] = None,
) -> str:
    """
    Convierte un hallazgo de investigación en un prompt visual para LTX-2.3.
    Usa Kimi K2.5 como LLM para la conversión.
    """
    client = http_client or httpx.AsyncClient(timeout=30.0)
    own_client = http_client is None

    user_msg = f"""Research topic: {topic}
Current finding: {finding_text}
Previous visual: {previous_prompt or 'None — this is the first clip'}

Generate the visual scene description."""

    try:
        resp = await client.post(
            f"{KIMI_URL}/v1/chat/completions",
            json={
                "model": KIMI_MODEL,
                "messages": [
                    {"role": "system", "content": VISUAL_PROMPT_SYSTEM},
                    {"role": "user", "content": user_msg},
                ],
                "max_tokens": 80,
                "temperature": 0.7,
            },
        )
        data = resp.json()
        prompt = data["choices"][0]["message"]["content"].strip()
        # Clean up — remove quotes if wrapped
        prompt = prompt.strip('"').strip("'")
        log.info("Visual prompt: %s", prompt)
        return prompt
    except Exception as e:
        log.error("Prompt extraction failed: %s", e)
        # Fallback genérico
        return f"Cinematic establishing shot related to {topic}, atmospheric lighting, slow camera movement"
    finally:
        if own_client:
            await client.aclose()


# ── WanGP Video Generator ──────────────────────────────────────────
async def generate_clip(
    prompt: str,
    session: SessionState,
    http_client: Optional[httpx.AsyncClient] = None,
    resolution: str = "1280x720",
    steps: int = 8,
    video_length: int = 121,  # ~5s at 24fps
) -> Optional[VideoClip]:
    """
    Genera un clip de vídeo via WanGP API en .29.
    Soporta I2V continuity (usa último frame del clip anterior).
    """
    client = http_client or httpx.AsyncClient(timeout=180.0)
    own_client = http_client is None

    session.clip_counter += 1
    clip_id = f"clip_{session.clip_counter:04d}"

    # Check cache
    prompt_hash = hashlib.md5(prompt.encode()).hexdigest()[:12]
    if prompt_hash in session.clip_cache:
        log.info("Cache hit for prompt: %s", prompt[:50])
        cached_url = session.clip_cache[prompt_hash]
        return VideoClip(
            clip_id=clip_id, path="", url=cached_url,
            prompt=prompt, subtitle="", has_audio=True,
        )

    payload = {
        "prompt": prompt,
        "resolution": resolution,
        "num_inference_steps": steps,
        "video_length": video_length,
        "model_type": "ltx2_22B_distilled",
    }

    # I2V: usar último frame para continuidad
    if session.last_frame_path and os.path.exists(session.last_frame_path):
        payload["start_image"] = session.last_frame_path

    try:
        # 1. Submit job
        resp = await client.post(f"{WANGP_URL}/generate", json=payload)
        job = resp.json()
        job_id = job["job_id"]
        log.info("WanGP job %s submitted for: %s", job_id, prompt[:50])

        # 2. Poll until done
        for _ in range(120):  # max 2 min
            await asyncio.sleep(1.0)
            status_resp = await client.get(f"{WANGP_URL}/status/{job_id}")
            status = status_resp.json()

            if status["status"] == "done":
                files = status.get("files", [])
                if files:
                    remote_path = files[0]
                    filename = os.path.basename(remote_path)
                    clip_url = f"/video/videos/{filename}"

                    # Extract last frame for next clip continuity
                    session.last_frame_path = remote_path  # WanGP can use remote paths
                    session.last_prompt = prompt

                    # Cache
                    session.clip_cache[prompt_hash] = clip_url

                    clip = VideoClip(
                        clip_id=clip_id,
                        path=remote_path,
                        url=clip_url,
                        prompt=prompt,
                        subtitle="",
                        has_audio=True,
                    )
                    log.info("Clip %s generated: %s", clip_id, filename)
                    return clip

            elif status["status"] == "error":
                log.error("WanGP error: %s", status.get("error"))
                return None

        log.error("WanGP timeout for job %s", job_id)
        return None

    except Exception as e:
        log.error("Video generation failed: %s", e)
        return None
    finally:
        if own_client:
            await client.aclose()


# ── TTS Narrator ────────────────────────────────────────────────────
async def narrate_finding(
    text: str,
    speaker: str = "serena",
    language: str = "Spanish",
    http_client: Optional[httpx.AsyncClient] = None,
) -> Optional[str]:
    """
    Genera narración TTS de un hallazgo. Devuelve base64 WAV.
    """
    client = http_client or httpx.AsyncClient(timeout=30.0)
    own_client = http_client is None

    try:
        resp = await client.post(
            f"{TTS_URL}/synthesize",
            json={"text": text, "speaker": speaker, "language": language},
        )
        data = resp.json()
        return data.get("audio")  # base64 WAV
    except Exception as e:
        log.error("TTS narration failed: %s", e)
        return None
    finally:
        if own_client:
            await client.aclose()


# ── ASR Transcription ───────────────────────────────────────────────
async def transcribe_audio(
    audio_b64: str,
    audio_format: str = "wav",
    http_client: Optional[httpx.AsyncClient] = None,
) -> Optional[str]:
    """
    Transcribe audio via Qwen3-ASR. Devuelve texto.
    """
    client = http_client or httpx.AsyncClient(timeout=30.0)
    own_client = http_client is None

    try:
        resp = await client.post(
            f"{ASR_URL}/transcribe/b64",
            json={"audio": audio_b64, "format": audio_format},
        )
        data = resp.json()
        return data.get("text")
    except Exception as e:
        log.error("ASR transcription failed: %s", e)
        return None
    finally:
        if own_client:
            await client.aclose()


# ── Main Orchestrator ───────────────────────────────────────────────
class VideoOrchestrator:
    """
    Orquesta la generación de vídeo contextual durante investigaciones.
    Se conecta al flujo de investigación de Kimi y genera clips en paralelo.
    """

    def __init__(self):
        self.sessions: Dict[str, SessionState] = {}
        self.http_client = httpx.AsyncClient(timeout=180.0)
        # Queues per session for WebSocket consumers
        self.clip_queues: Dict[str, asyncio.Queue] = {}
        self.subtitle_queues: Dict[str, asyncio.Queue] = {}

    def get_session(self, session_id: str) -> SessionState:
        if session_id not in self.sessions:
            self.sessions[session_id] = SessionState()
            self.clip_queues[session_id] = asyncio.Queue()
            self.subtitle_queues[session_id] = asyncio.Queue()
        return self.sessions[session_id]

    async def start_session(self, session_id: str, topic: str):
        """Inicia sesión de vídeo con clip de apertura."""
        session = self.get_session(session_id)
        session.topic = topic
        session.is_active = True
        session.current_phase = "starting"

        # Generar prompt de apertura
        opening_prompt = await extract_visual_prompt(
            finding_text=f"Beginning deep research on: {topic}",
            topic=topic,
            http_client=self.http_client,
        )

        # Generar clip de apertura
        clip = await generate_clip(
            prompt=opening_prompt,
            session=session,
            http_client=self.http_client,
        )

        if clip:
            clip.subtitle = f"Investigando: {topic}"
            await self.clip_queues[session_id].put(clip)

        session.current_phase = "researching"

    async def on_finding(self, session_id: str, finding: dict):
        """
        Callback cuando Kimi produce un hallazgo.
        finding: {text, topic, phase, agent_name}
        """
        session = self.get_session(session_id)
        if not session.is_active:
            return

        text = finding.get("text", "")
        topic = finding.get("topic", session.topic)
        phase = finding.get("phase", "researching")
        session.current_phase = phase

        # 1. Enviar subtítulo inmediatamente
        await self.subtitle_queues[session_id].put({
            "text": text[:200],  # Max 200 chars para subtítulo
            "phase": phase,
            "agent": finding.get("agent_name", ""),
        })

        # 2. Generar prompt visual (en paralelo con la investigación)
        visual_prompt = await extract_visual_prompt(
            finding_text=text,
            topic=topic,
            previous_prompt=session.last_prompt,
            http_client=self.http_client,
        )

        # 3. Generar clip y narración en paralelo
        clip_task = generate_clip(
            prompt=visual_prompt,
            session=session,
            http_client=self.http_client,
        )
        narration_task = narrate_finding(
            text=text[:300],  # Max para TTS
            http_client=self.http_client,
        )

        clip, narration_audio = await asyncio.gather(
            clip_task, narration_task, return_exceptions=True
        )

        if isinstance(clip, VideoClip):
            clip.subtitle = text[:200]
            await self.clip_queues[session_id].put({
                "clip": clip,
                "narration": narration_audio if isinstance(narration_audio, str) else None,
            })

    async def stop_session(self, session_id: str):
        """Detiene la sesión de vídeo."""
        if session_id in self.sessions:
            self.sessions[session_id].is_active = False
            self.sessions[session_id].current_phase = "complete"

    def cleanup_session(self, session_id: str):
        """Limpia recursos de una sesión."""
        self.sessions.pop(session_id, None)
        self.clip_queues.pop(session_id, None)
        self.subtitle_queues.pop(session_id, None)


# Singleton
video_orchestrator = VideoOrchestrator()
