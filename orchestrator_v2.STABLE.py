"""
ThotBrain Agent Swarm Orchestrator v2.1
--------------------------------------
Middleware between frontend (Open WebUI / ThotBrain React) and vLLM,
orchestrating parallel sub-agent execution with Kimi K2.5's native tool calling.

Architecture:
  ThotBrain React :3000 → Orchestrator :8082 → vLLM :8000 (H200)

v2 changes:
  - Connection pooling (shared httpx.AsyncClient)
  - Fixed semaphore for streaming
  - Per-request persona counter (no global race condition)
  - Model passthrough from client
  - Structured SSE events for agent activity
  - Handshake endpoint for UI component discovery
  - Structured synthesis output (DynamicBlock JSON)
  - Logging throughout
  - Deduped tool call handlers
  - Retry on vLLM 5xx
"""

import asyncio
import re
import hashlib
import json
import logging
import os
import secrets
import time
import base64
import uuid
from contextlib import asynccontextmanager
from typing import AsyncIterator

import httpx
from fastapi import FastAPI, Request, HTTPException, Depends
from fastapi.responses import StreamingResponse, Response, JSONResponse, HTMLResponse, FileResponse
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

# ─── Logging ─────────────────────────────────────────────────────────────────

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    datefmt="%H:%M:%S",
)
log = logging.getLogger("orchestrator")

# ─── Config ──────────────────────────────────────────────────────────────────

VLLM_BASE_URL = os.environ.get("VLLM_BASE_URL", "http://100.64.0.33:8000")
DEFAULT_MODEL = os.environ.get("DEFAULT_MODEL", "kimi-k25-agent")
MAX_RECURSION_DEPTH = 2      # No sub-tasks: wide attack (20 agents), no depth
MAX_PARALLEL_AGENTS = 20
AGENT_TIMEOUT = 120
MAX_CONCURRENT_VLLM = 24     # 8x H200 on .198 can handle 20+ parallel requests
MAX_CONTEXTUAL_IMAGES = 8    # One image per agent, based on their conclusion
VLLM_RETRY_ATTEMPTS = 2
VLLM_RETRY_DELAY = 1.0

# ─── Kimi K2.5 Profiles (per Moonshot recommendations) ──────────────────────
# top_p=0.95 across all profiles (Moonshot official)
# thinking=false → extra_body.chat_template_kwargs.thinking=false for vLLM

PROFILE_AGENT_CONTROL = {
    "temperature": 0.1,
    "top_p": 0.95,
    "max_tokens": 2048,  # needs room for 8-12 tool calls (~70 tokens each)
    "chat_template_kwargs": {"thinking": False},
}

PROFILE_DEEP_RESEARCH = {
    "temperature": 1.0,
    "top_p": 0.95,
    "max_tokens": 8192,
    # thinking ON (no chat_template_kwargs override)
}

PROFILE_SYNTHESIS = {
    "temperature": 0.3,
    "top_p": 0.95,
    "max_tokens": 4096,
    "chat_template_kwargs": {"thinking": False},
}

SERPER_API_KEY = os.environ.get("SERPER_API_KEY", "93590639c1581e3624301f244b7a9e96914c05ab")
SERPER_URL = "https://google.serper.dev/search"
JINA_API_KEY = os.environ.get("JINA_API_KEY", "jina_e66a7cc87e244d3d9adb4c72a7c9ead9HjjUaBjcawvMIBpcqsIK2P-jYK95")
JINA_READER_URL = "https://r.jina.ai/"

# ─── Presentation Layer (Qwen3-Omni + Z-Image) ─────────────────────────────
OMNI_BASE_URL = os.environ.get("OMNI_BASE_URL", "http://100.64.0.29:8200")
OMNI_MODEL = os.environ.get("OMNI_MODEL", "/secondary/models/Qwen3-Omni-30B-A3B-Instruct")
ZIMAGE_BASE_URL = os.environ.get("ZIMAGE_BASE_URL", "http://100.64.0.29:8100")

# ─── JSX Code Generation (Qwen3-Coder) ──────────────────────────────────────
CODER_BASE_URL = os.environ.get("CODER_BASE_URL", "http://100.64.0.29:8300")
CODER_MODEL = os.environ.get("CODER_MODEL", "/secondary/models/Qwen3-Coder-30B-A3B-Instruct")

# ─── Agent Personas ──────────────────────────────────────────────────────────

AGENT_PERSONAS = [
    {"name": "Iker",    "display": "Elena Rostova",  "role": "Ingeniero",          "roleBadge": "INGENIERO"},
    {"name": "Miren",   "display": "Marcus Chen",    "role": "Comercial",          "roleBadge": "COMERCIAL"},
    {"name": "Asier",   "display": "Sofia Al-Fayed", "role": "Experto en Marketing","roleBadge": "MARKETING"},
    {"name": "Ziortza", "display": "David Thorne",   "role": "Asesor Legal",       "roleBadge": "ASESOR LEGAL"},
    {"name": "Jon",     "display": "Carmen Vega",    "role": "Asesor Laboral",     "roleBadge": "LABORAL"},
    {"name": "Ana",     "display": "Raj Patel",      "role": "Data Scientist",     "roleBadge": "DATA"},
    {"name": "Unai",    "display": "Yuki Tanaka",    "role": "Systems Engineer",   "roleBadge": "SISTEMAS"},
    {"name": "Leire",   "display": "Anna Kowalski",  "role": "Research Lead",      "roleBadge": "RESEARCH"},
    {"name": "Gorka",   "display": "Amir Hassan",    "role": "Analista Financiero", "roleBadge": "FINANZAS"},
    {"name": "Nerea",   "display": "Lisa Park",      "role": "Estratega",          "roleBadge": "ESTRATEGIA"},
    {"name": "Mikel",   "display": "James Wright",   "role": "Analista Sectorial", "roleBadge": "SECTOR"},
    {"name": "Ane",     "display": "Priya Sharma",   "role": "Investigadora",      "roleBadge": "INVESTIGACIÓN"},
]

# ─── System Prompt for Agent Swarm ────────────────────────────────────────────

SWARM_SYSTEM_PROMPT = """You are ThotBrain, an advanced AI assistant with access to a swarm of specialized research agents.

You have TWO modes of interaction:

MODE 1 — DIRECT CONVERSATION (no tools needed):
Use this when the user is:
- Asking a follow-up question about something already discussed
- Asking for your opinion, clarification, or summary
- Making a comment, correction, or casual remark
- Asking a simple factual question you can answer from the conversation context
- Continuing a dialogue naturally

In this mode, respond directly, naturally, and conversationally. Use the information already gathered in the conversation. Do NOT re-launch agents or re-research topics already covered.

MODE 2 — DEEP RESEARCH (use spawn_agent):
Use this when the user is:
- Asking a NEW topic that requires fresh research
- Explicitly requesting investigation, analysis, or comparison of something not yet discussed
- Asking for current/real-time data you don't have
- Requesting a completely different subject from the conversation so far

HOW TO USE spawn_agent (only in Mode 2):
- Spawn 7 to 8 agents, each with a DIFFERENT specialized angle
- More agents = more diverse perspectives. Each agent should explore a UNIQUE line of investigation
- Keep each agent's task focused and specific (not broad). Narrow scope per agent, wide coverage overall
- Example: instead of 1 agent doing "analyze everything about X", split into: history, technology, economics, competitors, regulations, user experience, future trends, regional differences
- Each agent_id should reflect their specialty

You also have web_search and fetch_url for quick lookups (useful in both modes).

CRITICAL RULES: 1) If user CORRECTS you or says you are wrong: IMMEDIATELY spawn new agents with corrected focus. Do NOT apologize. 2) NEVER say 'I made errors' - you have web_search, USE IT. 3) NEVER apologize more than one sentence. Act, dont grovel. 4) When the user is angry: spawn agents and deliver better results.

Respond in the same language as the user."""

def make_persona_assigner():
    """Create a per-request persona counter to avoid global state race conditions."""
    counter = 0
    def assign(agent_id: str) -> dict:
        nonlocal counter
        persona = AGENT_PERSONAS[counter % len(AGENT_PERSONAS)]
        counter += 1
        return {
            "id": agent_id,
            "orchName": persona["name"],
            "display_name": persona["display"],
            "role": persona["role"],
            "roleBadge": persona["roleBadge"],
        }
    return assign

# ─── API Keys ────────────────────────────────────────────────────────────────

API_KEYS_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "api_keys.json")

def load_api_keys() -> dict:
    if os.path.exists(API_KEYS_FILE):
        with open(API_KEYS_FILE) as f:
            return json.load(f)
    return {}

def save_api_keys(keys: dict):
    with open(API_KEYS_FILE, "w") as f:
        json.dump(keys, f, indent=2)

def hash_key(key: str) -> str:
    return hashlib.sha256(key.encode()).hexdigest()

def generate_api_key(name: str) -> str:
    key = f"sk-kimi-{secrets.token_hex(24)}"
    keys = load_api_keys()
    keys[hash_key(key)] = {"name": name, "created": time.strftime("%Y-%m-%d %H:%M:%S")}
    save_api_keys(keys)
    return key

security = HTTPBearer(auto_error=False)

async def verify_api_key(credentials: HTTPAuthorizationCredentials = Depends(security)):
    if credentials is None:
        raise HTTPException(status_code=401, detail="Missing API key")
    key = credentials.credentials
    if key == "no-key":
        return "open-webui"
    keys = load_api_keys()
    h = hash_key(key)
    if h not in keys:
        raise HTTPException(status_code=403, detail="Invalid API key")
    return keys[h]["name"]

# ─── UI Component Registry (Handshake) ───────────────────────────────────────

# Stores registered UI components per session. In-memory for now.
_ui_capabilities: dict[str, list[dict]] = {}

DEFAULT_UI_COMPONENTS = [
    {"type": "SummaryCard",    "props_schema": {"title": "string", "content": "string"}},
    {"type": "DataTable",      "props_schema": {"title": "string", "columns": "array", "rows": "array"}},
    {"type": "MetricGrid",     "props_schema": {"title": "string", "metrics": "array"}},
    {"type": "MarketingChart", "props_schema": {"title": "string", "description": "string", "data": "array"}},
    {"type": "TechSpecs",      "props_schema": {"title": "string", "specs": "array"}},
    {"type": "LegalReport",    "props_schema": {"title": "string", "documentType": "string", "clauses": "array"}},
    {"type": "SandboxJSX",     "props_schema": {"code": "string"}},
]

def get_ui_components(session_id: str | None = None) -> list[dict]:
    if session_id and session_id in _ui_capabilities:
        return _ui_capabilities[session_id]
    return DEFAULT_UI_COMPONENTS

def build_synthesis_prompt(components: list[dict]) -> str:
    """Build synthesis prompt that produces CLEAN output — no agent references."""
    return """You are an elite analyst. Produce a CONCISE, elegant executive brief.

CRITICAL: Maximum 600 words. This is a screen read, not a document.

VOICE: Direct expert. No hedging. NEVER mention agents, sources, or research process.

FORMAT — use generous whitespace and visual breathing room:

# Title
(one line, punchy)

> **Key finding in 1-2 bold sentences as blockquote**

---

## Section Title

Short paragraph of 2-3 sentences max. Leave a blank line between every paragraph.

Key numbers always in **bold**: **$42B**, **+25%**, **3.2x**.

---

## Section with Data

| Column A | Column B | Column C |
|----------|----------|----------|
| data     | data     | data     |

Tables: max 4-5 rows. One or two tables total.

---

## Verdict

2-3 sentences with a clear opinion. End strong.

---

SPACING RULES (CRITICAL for readability):
- ALWAYS leave a blank line between paragraphs
- ALWAYS put --- between every section
- ALWAYS leave a blank line before and after tables
- ALWAYS leave a blank line before and after blockquotes
- Paragraphs: 2-3 sentences maximum, never more
- Prefer multiple short paragraphs over one long one

ANTI-PATTERNS (DO NOT):
- NO walls of text. Break everything into short paragraphs.
- NO bullet point lists. Use flowing prose and tables.
- No paragraphs longer than 3 sentences.
- No disclaimers, filler, or "it is important to note".
- No source attribution or references at the end.

Write in the same language as the original question."""

# ─── Swarm Tools ─────────────────────────────────────────────────────────────

SWARM_TOOLS = [
    {
        "type": "function",
        "function": {
            "name": "spawn_agent",
            "description": "Spawn a sub-agent to research or work on a specific subtask in parallel. Each agent works independently and returns its findings.",
            "parameters": {
                "type": "object",
                "properties": {
                    "task": {"type": "string", "description": "Detailed description of what this sub-agent should research or accomplish"},
                    "agent_id": {"type": "string", "description": "A descriptive identifier for this agent (e.g., 'hardware_researcher')"},
                },
                "required": ["task", "agent_id"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "web_search",
            "description": "Search the web for current information on a topic. Returns titles, snippets and URLs from Google.",
            "parameters": {
                "type": "object",
                "properties": {"query": {"type": "string", "description": "The search query"}},
                "required": ["query"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "fetch_url",
            "description": "Fetch and read the full content of a web page URL. Returns the page content as clean markdown text.",
            "parameters": {
                "type": "object",
                "properties": {"url": {"type": "string", "description": "The full URL to fetch"}},
                "required": ["url"],
            },
        },
    },
]

# ─── App Lifespan (shared httpx client) ──────────────────────────────────────

http_client: httpx.AsyncClient | None = None
vllm_semaphore: asyncio.Semaphore | None = None

@asynccontextmanager
async def lifespan(app: FastAPI):
    global http_client, vllm_semaphore
    http_client = httpx.AsyncClient(
        timeout=httpx.Timeout(connect=30, read=600, write=30, pool=120),
        limits=httpx.Limits(max_connections=100, max_keepalive_connections=30),
    )
    vllm_semaphore = asyncio.Semaphore(MAX_CONCURRENT_VLLM)
    log.info("Orchestrator started — vLLM: %s, model: %s", VLLM_BASE_URL, DEFAULT_MODEL)
    yield
    await http_client.aclose()
    log.info("Orchestrator stopped")

app = FastAPI(title="ThotBrain Agent Swarm Orchestrator", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ─── External API Helpers ────────────────────────────────────────────────────

async def serper_search(query: str, num_results: int = 5) -> str:
    if not SERPER_API_KEY:
        return "Search unavailable: SERPER_API_KEY not configured"
    payload = {"q": query, "num": num_results}
    headers = {"X-API-KEY": SERPER_API_KEY, "Content-Type": "application/json"}
    try:
        resp = await http_client.post(SERPER_URL, json=payload, headers=headers)
        data = resp.json()
        lines = []
        for i, item in enumerate(data.get("organic", []), 1):
            lines.append(f"{i}. **{item.get('title', '')}**\n   {item.get('snippet', '')}\n   URL: {item.get('link', '')}")
        if data.get("knowledgeGraph"):
            kg = data["knowledgeGraph"]
            lines.insert(0, f"**{kg.get('title', '')}**: {kg.get('description', '')}")
        return "\n\n".join(lines) if lines else "No results found."
    except Exception as e:
        log.error("Serper search failed: %s", e)
        return f"Search error: {e}"


async def jina_fetch(url: str, max_chars: int = 3000) -> str:
    if not JINA_API_KEY:
        return "Fetch unavailable: JINA_API_KEY not configured"
    headers = {
        "Authorization": f"Bearer {JINA_API_KEY}",
        "Accept": "text/markdown",
        "X-No-Cache": "true",
    }
    try:
        resp = await http_client.get(f"{JINA_READER_URL}{url}", headers=headers)
        if resp.status_code == 200:
            text = resp.text[:max_chars]
            if len(resp.text) > max_chars:
                text += f"\n\n[... truncated, {len(resp.text)} chars total]"
            return text
        return f"Fetch error: HTTP {resp.status_code}"
    except Exception as e:
        log.error("Jina fetch failed for %s: %s", url, e)
        return f"Fetch error: {e}"

# ─── vLLM Client with retry ─────────────────────────────────────────────────

async def call_vllm(
    messages: list,
    model: str | None = None,
    tools: list | None = None,
    profile: dict | None = None,
) -> dict:
    """Non-streaming call to vLLM with semaphore, retry, and profile support."""
    prof = profile or PROFILE_SYNTHESIS  # default to synthesis profile
    payload = {
        "model": DEFAULT_MODEL,  # always use served model name
        "messages": messages,
        "max_tokens": prof.get("max_tokens", 4096),
        "temperature": prof.get("temperature", 0.7),
        "top_p": prof.get("top_p", 0.95),
        "stream": False,
    }
    if "chat_template_kwargs" in prof:
        payload["chat_template_kwargs"] = prof["chat_template_kwargs"]
    if tools:
        payload["tools"] = tools
        payload["tool_choice"] = "auto"

    log.info("call_vllm: model=%s, temp=%.1f, max_tokens=%d, tools=%s, thinking=%s",
             payload["model"], payload["temperature"], payload["max_tokens"],
             bool(tools), payload.get("chat_template_kwargs", {}).get("thinking", "NOT SET"))

    async with vllm_semaphore:
        for attempt in range(VLLM_RETRY_ATTEMPTS + 1):
            try:
                resp = await http_client.post(
                    f"{VLLM_BASE_URL}/v1/chat/completions",
                    json=payload,
                )
                if resp.status_code >= 500 and attempt < VLLM_RETRY_ATTEMPTS:
                    log.warning("vLLM returned %d, retrying (%d/%d)", resp.status_code, attempt + 1, VLLM_RETRY_ATTEMPTS)
                    await asyncio.sleep(VLLM_RETRY_DELAY)
                    continue
                data = resp.json()
                ch = data.get("choices", [{}])[0]
                log.info("call_vllm response: finish=%s, has_tool_calls=%s, content_len=%d",
                         ch.get("finish_reason"), bool(ch.get("message", {}).get("tool_calls")),
                         len(ch.get("message", {}).get("content") or ""))
                return data
            except httpx.TimeoutException:
                if attempt < VLLM_RETRY_ATTEMPTS:
                    log.warning("vLLM timeout, retrying (%d/%d)", attempt + 1, VLLM_RETRY_ATTEMPTS)
                    await asyncio.sleep(VLLM_RETRY_DELAY)
                    continue
                raise
    return {"choices": [{"message": {"content": "Error: vLLM unavailable after retries"}}]}

# ─── SSE Helpers ─────────────────────────────────────────────────────────────

def _sse_chunk(content: str, model: str = "") -> str:
    """Create an SSE data line with content delta."""
    chunk = {
        "id": f"chatcmpl-{uuid.uuid4().hex[:12]}",
        "object": "chat.completion.chunk",
        "created": int(time.time()),
        "model": model or DEFAULT_MODEL,
        "choices": [{"index": 0, "delta": {"content": content}, "finish_reason": None}],
    }
    return f"data: {json.dumps(chunk, ensure_ascii=False)}\n\n"


def _sse_event(event_type: str, data: dict) -> str:
    """Create a typed SSE event for structured agent activity."""
    return f"event: {event_type}\ndata: {json.dumps(data, ensure_ascii=False)}\n\n"

# ─── Presentation Layer Helpers ─────────────────────────────────────────────

COVER_PROMPT_SYSTEM = """You create image prompts for FLUX diffusion model. Given a topic, output ONE English prompt (max 40 words).

ABSOLUTE RULES:
- PHOTOGRAPHY ONLY: real-world scenes, NO screens, NO monitors, NO presentations, NO slides, NO infographics
- ZERO TEXT: NO words, NO letters, NO logos, NO labels, NO signs, NO writing of any kind in the scene
- NO PEOPLE FACES: use hands, silhouettes, or objects instead
- Describe a real photographic scene: objects, materials, lighting, atmosphere
- Style: editorial photography, shallow depth of field, cinematic lighting
- Output ONLY the prompt, nothing else."""

JSX_PRESENTER_SYSTEM = """You are an elite UI designer who creates stunning React data visualizations.

TECHNICAL RULES:
1. Output ONLY the JSX code — no markdown fences, no explanation, no comments before or after
2. Component MUST be named "App" using: function App() { ... }
3. NO imports, NO exports — React and Recharts are available as globals
4. Recharts globals: BarChart, Bar, LineChart, Line, PieChart, Pie, Cell, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, AreaChart, Area, RadarChart, Radar, PolarGrid, PolarAngleAxis, PolarRadiusAxis
5. Use ONLY inline styles (no CSS classes, no Tailwind)
6. Max 150 lines
7. Self-contained with hardcoded data extracted from the synthesis

DESIGN SYSTEM:
- Header: background linear-gradient(135deg, #18181b, #27272a), color white, accent #D4AF37
- Cards: background white, border 1px solid #e4e4e7, borderRadius 12px, boxShadow "0 1px 3px rgba(0,0,0,0.08)"
- KPI numbers: fontSize 28-36, fontWeight 800, color #18181b
- KPI labels: fontSize 11, textTransform "uppercase", letterSpacing 1, color #71717a
- Body: fontFamily "-apple-system,BlinkMacSystemFont,sans-serif", background "#fafafa"
- Colors: #D4AF37 (gold), #3b82f6 (blue), #10b981 (green), #ef4444 (red), #8b5cf6 (purple), #f59e0b (amber)
- Use ResponsiveContainer width="100%" height={250} for all charts
- Tables: clean, compact, alternating backgrounds

LAYOUT: Pick best fit:
A) DASHBOARD: Header + KPI row (3-5 metrics) + chart + detail grid
B) COMPARISON: Side-by-side cards + chart + verdict
C) REPORT: Header + summary + table + conclusion

CRITICAL: Start output DIRECTLY with function App() { — nothing before it."""


async def generate_cover_image(query: str) -> str | None:
    """Generate a single cover image. Returns URL path or None."""
    return await _generate_image(query, width=800, height=300, label="cover")


async def generate_contextual_image(agent_report: str, agent_name: str) -> dict | None:
    """Generate a contextual image from an agent's research report.
    Returns dict with image_base64 and metadata, or None on failure."""
    result = await _generate_image(
        agent_report[:500],  # First 500 chars of report for context
        width=512, height=512, label=f"contextual/{agent_name}",
    )
    if result:
        return {"image": result, "agent": agent_name}
    return None


async def _generate_image(context: str, width: int, height: int, label: str) -> str | None:
    """Internal: context → Coder (prompt) → Z-Image (render). Returns base64 or None."""
    try:
        # Step 1: Coder generates image prompt from context (fast, <100ms)
        resp = await http_client.post(
            f"{CODER_BASE_URL}/v1/chat/completions",
            json={
                "model": CODER_MODEL,
                "messages": [
                    {"role": "system", "content": COVER_PROMPT_SYSTEM},
                    {"role": "user", "content": context},
                ],
                "max_tokens": 80,
                "temperature": 1.2,
                "stream": False,
            "chat_template_kwargs": {"thinking": False},
            },
            timeout=10.0,
        )
        if resp.status_code != 200:
            log.warning("[%s] Coder prompt failed: HTTP %d", label, resp.status_code)
            return None

        content = resp.json()["choices"][0]["message"].get("content", "")
        image_prompt = content.strip() if content else context[:100]
        log.info("[%s] Image prompt: %s", label, image_prompt[:80])

        # Step 2: Flux Klein generates the image (8 steps, random seed for variety)
        import random
        img_resp = await http_client.post(
            f"{ZIMAGE_BASE_URL}/generate",
            json={
                "prompt": image_prompt,
                "width": width,
                "height": height,
                "num_steps": 4,
                "seed": random.randint(0, 2**32 - 1),
            },
            timeout=30.0,
        )
        if img_resp.status_code != 200:
            log.warning("[%s] Z-Image failed: HTTP %d", label, img_resp.status_code)
            return None

        # Z-Image may return raw PNG bytes or JSON with base64
        content_type = img_resp.headers.get("content-type", "")
        if "image/" in content_type or img_resp.content[:4] == b'\x89PNG':
            # Raw image bytes — save directly
            image_bytes = img_resp.content
            image_b64 = None
        else:
            data = img_resp.json()
            image_b64 = data.get("image", "") or data.get("image_base64", "")
            if not image_b64:
                log.warning("[%s] Empty image data", label)
                return None
            image_bytes = base64.b64decode(image_b64)
        # Save as static file and return URL path
        img_id = uuid.uuid4().hex[:12]
        img_filename = f"cover-{img_id}.png"
        static_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'thotbrain-dist', 'assets')
        os.makedirs(static_dir, exist_ok=True)
        img_path = os.path.join(static_dir, img_filename)
        with open(img_path, 'wb') as imgf:
            imgf.write(image_bytes)
        img_url = f"/assets/{img_filename}"
        log.info("[%s] Image saved: %s (%d bytes), %dx%d", label, img_url, len(image_bytes), width, height)
        return img_url

    except Exception as e:
        log.error("[%s] Image pipeline failed: %s", label, e)
        return None


async def generate_jsx_presentation(synthesis: str, original_query: str) -> str | None:
    """Send synthesis to Qwen3-Coder to generate a JSX React component for visualization.
    Uses Coder (MoE 3B active) for fast JSX generation, freeing Kimi for research.
    Returns JSX code string or None on failure."""
    try:
        trunc = synthesis[:6000] if len(synthesis) > 6000 else synthesis
        if len(synthesis) > 6000:
            log.info("Truncated synthesis from %d to 6000 chars for JSX gen", len(synthesis))
        payload = {
            "model": CODER_MODEL,
            "messages": [
                {"role": "system", "content": JSX_PRESENTER_SYSTEM},
                {"role": "user", "content": f"Original question: {original_query}\n\nResearch synthesis to visualize:\n\n{trunc}"},
            ],
            "max_tokens": 4096,
            "temperature": 0.3,
            "stream": False,
            "chat_template_kwargs": {"thinking": False},
        }
        resp = await http_client.post(
            f"{CODER_BASE_URL}/v1/chat/completions",
            json=payload,
            timeout=60.0,
        )
        if resp.status_code != 200:
            log.warning("Omni JSX generation failed: HTTP %d", resp.status_code)
            return None

        raw_content = resp.json()["choices"][0]["message"].get("content")
        if not raw_content:
            log.warning("JSX generation returned empty content (model may have used reasoning only)")
            return None
        jsx_code = raw_content.strip()

        # Clean up: remove markdown code fences if present
        if jsx_code.startswith("```"):
            lines = jsx_code.split("\n")
            # Remove first line (```jsx or ```) and last line (```)
            lines = [l for l in lines if not l.strip().startswith("```")]
            jsx_code = "\n".join(lines)

        # Clean imports and exports (iframe uses globals, not modules)
        # Remove import/export lines (iframe uses globals, not ES modules)
        jsx_lines = [l for l in jsx_code.splitlines() if not l.strip().startswith("import ")]
        jsx_code = "\n".join(jsx_lines)
        jsx_code = jsx_code.replace("export default ", "")
        jsx_code = re.sub(r"^export\s+", "", jsx_code, flags=re.MULTILINE)
        jsx_code = jsx_code.strip()

        # Sanitize JSX to fix LLM-generated syntax errors (< > in text nodes)
        jsx_code = sanitize_jsx(jsx_code)

        # Validate it looks like JSX
        if not any(x in jsx_code for x in ["function ", "const ", "class ", "React.createElement"]):
            log.warning("Generated JSX doesn't contain component, skipping")
            return None

        log.info("JSX presentation generated: %d chars", len(jsx_code))
        return jsx_code

    except Exception as e:
        log.error("JSX presentation pipeline failed: %s", e)
        return None

# ─── Kimi K2.5 Raw Token Cleanup (vLLM parser bug workaround) ───────────────

# Regex to strip raw tool call tokens that leak into content
_RAW_TOOL_TOKENS_RE = re.compile(
    r"<\|tool_calls?_(?:section_)?(?:begin|end)\|>"
    r"|<\|tool_call_(?:argument_)?(?:begin|end)\|>"
    r"|functions\.\w+:\d+"
)

def clean_kimi_content(content: str) -> str:
    """Strip raw Kimi tool call tokens from content. vLLM parser bug workaround."""
    if not content or "<|tool_call" not in content:
        return content
    # Remove everything from the first raw token to the end (tool call garbage)
    idx = content.find("<|tool_call")
    cleaned = content[:idx].rstrip()
    if cleaned != content:
        log.warning("Stripped %d chars of raw tool call tokens from content", len(content) - len(cleaned))
    return cleaned


def sanitize_jsx(jsx_code: str) -> str:
    """Fix common JSX issues from LLM generation.
    Strips non-code preamble and trailing text. Does NOT touch < > (they are valid JSX)."""
    if not jsx_code:
        return jsx_code
    
    # 1. Remove <think>...</think> blocks
    jsx_code = re.sub(r"<think>.*?</think>\s*", "", jsx_code, flags=re.DOTALL)
    
    # 2. Strip everything before the first function/const/class declaration
    for pattern in [r"^function\s+\w+", r"^const\s+\w+\s*=", r"^class\s+\w+"]:
        m = re.search(pattern, jsx_code, re.MULTILINE)
        if m:
            if m.start() > 0:
                log.info("Stripped %d chars of preamble before JSX function", m.start())
            jsx_code = jsx_code[m.start():]
            break
    
    # 3. Remove any trailing text after the last top-level closing brace
    brace_depth = 0
    last_zero = -1
    for i, ch in enumerate(jsx_code):
        if ch == '{':
            brace_depth += 1
        elif ch == '}':
            brace_depth -= 1
            if brace_depth == 0:
                last_zero = i
    if last_zero > 0 and last_zero < len(jsx_code) - 1:
        trailing = jsx_code[last_zero + 1:].strip()
        if trailing and not trailing.startswith(("function ", "const ", "class ")):
            log.info("Stripped %d chars of trailing text after JSX", len(trailing))
            jsx_code = jsx_code[:last_zero + 1]
    
    return jsx_code

# ─── Tool Call Parsing ───────────────────────────────────────────────────────

def parse_tool_calls(tool_calls: list) -> tuple[list, list, list]:
    spawn_tasks, search_tasks, fetch_tasks = [], [], []
    for tc in tool_calls:
        func = tc.get("function", {})
        name = func.get("name", "")
        try:
            args = json.loads(func.get("arguments", "{}"))
        except json.JSONDecodeError:
            args = {}
        if name == "spawn_agent":
            spawn_tasks.append((tc["id"], args.get("agent_id", f"agent_{len(spawn_tasks)}"), args.get("task", "")))
        elif name == "web_search":
            search_tasks.append((tc["id"], args.get("query", "")))
        elif name == "fetch_url":
            fetch_tasks.append((tc["id"], args.get("url", "")))
    return spawn_tasks, search_tasks, fetch_tasks

# ─── Sub-Agent Execution ────────────────────────────────────────────────────

async def execute_sub_agent(
    agent_id: str,
    task: str,
    depth: int,
    model: str,
    activity_queue: asyncio.Queue | None = None,
) -> tuple[str, str, float]:
    """Execute a sub-agent. Reports activity via queue if provided."""
    t0 = time.time()
    log.info("Agent '%s' started (depth=%d): %s", agent_id, depth, task[:100])

    async def report(event_type: str, detail: str = ""):
        if activity_queue:
            await activity_queue.put({
                "agent": agent_id, "type": event_type,
                "detail": detail, "t": time.time() - t0,
            })

    await report("start", task[:150])
    try:

        from datetime import datetime
        now = datetime.now()
        date_str = now.strftime("%Y-%m-%d %H:%M")
        system_prompt = (
            f"You are research agent '{agent_id}'. "
            f"IMPORTANT: Today is {date_str}. The current year is {now.year}. "
            f"Always search for the MOST RECENT information available in {now.year}. "
            "Your task is below. "
            "Be thorough, specific, and provide detailed findings with data and sources. "
            "Use web_search and fetch_url tools to gather real information. "
            "Do NOT spawn sub-agents — complete the research yourself directly."
        )
        messages = [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": task},
        ]

        # Agents get search/fetch tools but NOT spawn_agent (no recursion)
        AGENT_TOOLS = [t for t in SWARM_TOOLS if t["function"]["name"] != "spawn_agent"]
        tools = AGENT_TOOLS if depth <= MAX_RECURSION_DEPTH else None
        await report("thinking", "Analyzing task and planning approach...")
        # Sub-agents use AGENT_CONTROL (thinking OFF) so tool_calls are structured, not raw tokens
        result = await call_vllm(messages, model=model, tools=tools, profile=PROFILE_AGENT_CONTROL)

        choice = result.get("choices", [{}])[0]
        message = choice.get("message", {})

        if choice.get("finish_reason") == "tool_calls" and message.get("tool_calls"):
            # Execute tool calls
            await report("executing_tools", f"{len(message['tool_calls'])} tools")
            tool_results = await _handle_tool_calls(
                message["tool_calls"], depth + 1, model, activity_queue, agent_id,
            )

            # No per-agent synthesis — return raw tool results for the final orchestrator synthesis
            await report("done", "data collected")
            text = "TOOL RESULTS:\n"
            for tr in tool_results:
                text += f"\n{tr.get('content', '')}\n"
        else:
            reasoning = clean_kimi_content(message.get("reasoning") or "")
            content = clean_kimi_content(message.get("content") or "")
            if reasoning:
                await report("reasoning", reasoning[:200])
            text = ""
            if reasoning:
                text += f"REASONING:\n{reasoning}\n\n"
            text += f"CONCLUSION:\n{content}"

        elapsed = time.time() - t0
        await report("done", f"{elapsed:.1f}s")
        log.info("Agent '%s' completed in %.1fs", agent_id, elapsed)
        return agent_id, text, elapsed

    except Exception as e:
        elapsed = time.time() - t0
        log.error("Agent '%s' failed after %.1fs: %s", agent_id, elapsed, e)
        await report("done", f"error after {elapsed:.1f}s")
        return agent_id, f"CONCLUSION:\nAgent encountered an error: {e}", elapsed


async def _handle_tool_calls(
    tool_calls: list,
    depth: int,
    model: str,
    activity_queue: asyncio.Queue | None = None,
    parent_agent: str = "",
) -> list:
    """Unified tool call handler. Works with or without activity queue."""
    spawn_tasks, search_tasks, fetch_tasks = parse_tool_calls(tool_calls)
    results = []

    async def do_search(call_id: str, query: str):
        if activity_queue:
            await activity_queue.put({"agent": parent_agent, "type": "searching", "detail": query, "t": 0})
        r = await serper_search(query)
        if activity_queue:
            await activity_queue.put({"agent": parent_agent, "type": "search_done", "detail": f"{query} ({len(r)} chars)", "t": 0})
        return {"role": "tool", "tool_call_id": call_id, "content": f"Search results for '{query}':\n\n{r}"}

    async def do_fetch(call_id: str, url: str):
        if activity_queue:
            await activity_queue.put({"agent": parent_agent, "type": "fetching", "detail": url[:80], "t": 0})
        r = await jina_fetch(url)
        if activity_queue:
            await activity_queue.put({"agent": parent_agent, "type": "fetch_done", "detail": f"{url[:60]} ({len(r)} chars)", "t": 0})
        return {"role": "tool", "tool_call_id": call_id, "content": f"Content from {url}:\n\n{r}"}

    # Execute searches and fetches in parallel
    io_coros = [do_search(cid, q) for cid, q in search_tasks] + [do_fetch(cid, u) for cid, u in fetch_tasks]
    if io_coros:
        io_results = await asyncio.gather(*io_coros, return_exceptions=True)
        for r in io_results:
            if isinstance(r, Exception):
                results.append({"role": "tool", "tool_call_id": "error", "content": f"Error: {r}"})
            else:
                results.append(r)

    # Execute sub-agents in parallel
    if spawn_tasks:
        limited = spawn_tasks[:MAX_PARALLEL_AGENTS]
        coros = [execute_sub_agent(aid, task, depth, model, activity_queue) for _, aid, task in limited]
        outcomes = await asyncio.gather(*coros, return_exceptions=True)
        for (call_id, agent_id, _), outcome in zip(limited, outcomes):
            if isinstance(outcome, Exception):
                results.append({"role": "tool", "tool_call_id": call_id, "content": f"Agent '{agent_id}' failed: {outcome}"})
            else:
                _, text, elapsed = outcome
                results.append({"role": "tool", "tool_call_id": call_id, "content": f"=== Report from agent '{agent_id}' ({elapsed:.1f}s) ===\n{text}"})

    return results


# ─── Message Sanitization ───────────────────────────────────────────────────

def sanitize_messages(messages: list) -> list:
    """Clean messages before sending to vLLM.
    Strips <think> blocks, enforces user/assistant alternation, limits history."""
    THINK_RE = re.compile(r"<think>.*?</think>\s*", re.DOTALL)

    system_msgs = []
    chat_msgs = []
    for m in messages:
        role = m.get("role", "")
        c = m.get("content", "") or ""
        if role == "system":
            system_msgs.append({"role": "system", "content": c})
            continue
        if role not in ("user", "assistant"):
            continue
        if role == "assistant":
            c = THINK_RE.sub("", c).strip()
        if not c:
            continue
        chat_msgs.append({"role": role, "content": c})

    # Limit history
    if len(chat_msgs) > 12:
        chat_msgs = chat_msgs[-12:]

    # Merge consecutive same-role messages
    merged = []
    for m in chat_msgs:
        if merged and merged[-1]["role"] == m["role"]:
            merged[-1]["content"] += "\n\n" + m["content"]
        else:
            merged.append(dict(m))

    # Ensure starts with user
    if merged and merged[0]["role"] == "assistant":
        merged = merged[1:]

    # Ensure ends with user
    if merged and merged[-1]["role"] != "user":
        merged = merged[:-1]

    return system_msgs + merged

# ─── Streaming Orchestration ────────────────────────────────────────────────


async def generate_visual_prompts(query, agent_tasks):
    try:
        resp = await http_client.post(
            f"{VLLM_BASE_URL}/v1/chat/completions",
            json={
                "model": DEFAULT_MODEL,
                "messages": [
                    {"role": "system", "content": "Generate 5 visual scene descriptions for ambient video based on the user question. English only, max 25 words each, cinematic style. One per line, no numbering."},
                    {"role": "user", "content": f"User question: {query[:300]}"}
                ],
                "max_tokens": 300,
                "temperature": 0.8,
                "chat_template_kwargs": {"thinking": False},
            },
            timeout=15.0,
        )
        data = resp.json()
        text = data["choices"][0]["message"]["content"]
        prompts = [l.strip().lstrip("0123456789.-) ") for l in text.strip().split("\n") if l.strip() and len(l.strip()) > 15]
        if prompts:
            log.info("Generated %d visual prompts", len(prompts))
            return prompts[:5]
    except Exception as e:
        log.warning("Visual prompt generation failed: %s", e)
    return ["Cinematic establishing shot, modern research facility, soft lighting",
            "Macro close-up of relevant objects on reflective surface, warm light",
            "Aerial drone shot of urban landscape at golden hour",
            "Abstract data visualization, glowing particles in dark space",
            "Atmospheric timelapse, dramatic sunset lighting"]


async def orchestrate_stream(
    messages: list,
    max_tokens: int,
    temperature: float,
    model: str,
    session_id: str | None = None,
) -> AsyncIterator[str]:
    """Main streaming orchestration: stream directly, handle tool calls if detected."""
    log.info("Stream request: model=%s, msgs=%d", model, len(messages))

    # Cover image launched after Kimi generates plan text (better prompt than raw query)
    original_query = messages[-1].get("content", "") if messages else ""
    cover_tasks = []
    covers_delivered = 0
    plan_text_parts = []  # Collect Kimi's plan text for cover image prompt

    # Inject swarm system prompt if not already present
    has_system = any(m.get("role") == "system" for m in messages)
    if not has_system:
        messages = [{"role": "system", "content": SWARM_SYSTEM_PROMPT}] + messages

    # Sanitize messages: strip <think> blocks, limit history, clean fields
    messages = sanitize_messages(messages)
    log.info("Sanitized messages: %d msgs, roles=%s", len(messages), [m["role"] for m in messages])

    # Always use DEFAULT_MODEL for vLLM calls — frontend model name is informational only
    vllm_model = DEFAULT_MODEL
    payload = {
        "model": vllm_model,
        "messages": messages,
        "max_tokens": PROFILE_AGENT_CONTROL["max_tokens"],
        "temperature": PROFILE_AGENT_CONTROL["temperature"],
        "top_p": PROFILE_AGENT_CONTROL["top_p"],
        "stream": True,
        "tools": SWARM_TOOLS,
        "tool_choice": "auto",
        "chat_template_kwargs": {"thinking": False},
    }

    tool_calls_detected = False
    assembled_tool_calls = {}
    reasoning_started = False
    content_started = False
    direct_content_parts = []  # Collect content when Kimi answers directly (no tools)

    # Acquire semaphore for the streaming request
    await vllm_semaphore.acquire()
    import time as _time
    _last_heartbeat = _time.monotonic()
    try:
        async with http_client.stream(
            "POST",
            f"{VLLM_BASE_URL}/v1/chat/completions",
            json=payload,
            timeout=httpx.Timeout(connect=10.0, read=120.0, write=10.0, pool=30.0),
        ) as resp:
            async for line in resp.aiter_lines():
                # Send heartbeat every 10s to keep Cloudflare connection alive
                _now = _time.monotonic()
                if _now - _last_heartbeat > 10:
                    yield ": heartbeat\n\n"
                    _last_heartbeat = _now
                if not line.startswith("data: "):
                    continue
                raw = line[6:]
                if raw.strip() == "[DONE]":
                    if not tool_calls_detected:
                        if reasoning_started and not content_started:
                            yield _sse_chunk("\n</think>\n\n", model)
                        # Don't yield [DONE] yet — we'll handle cover + JSX after loop
                    break

                try:
                    chunk = json.loads(raw)
                except json.JSONDecodeError:
                    if not tool_calls_detected:
                        yield f"{line}\n\n"
                    continue

                delta = chunk.get("choices", [{}])[0].get("delta", {})

                # Assemble tool calls
                if delta.get("tool_calls"):
                    if not tool_calls_detected:
                        # First tool call detected — launch cover with Kimi's plan text
                        plan_text = "".join(plan_text_parts)
                        if plan_text and len(plan_text) > 20:
                            import random
                            cover_tasks = [
                                asyncio.ensure_future(_generate_image(plan_text, width=800, height=300, label="cover-0"))
                            ]
                            log.info("Cover image launched from plan text: %s", plan_text[:80])
                    tool_calls_detected = True
                    for tc_delta in delta["tool_calls"]:
                        idx = tc_delta.get("index", 0)
                        if idx not in assembled_tool_calls:
                            assembled_tool_calls[idx] = {
                                "id": tc_delta.get("id", f"call_{idx}"),
                                "type": "function",
                                "function": {"name": "", "arguments": ""},
                            }
                        fn = tc_delta.get("function", {})
                        if fn.get("name"):
                            assembled_tool_calls[idx]["function"]["name"] = fn["name"]
                        if fn.get("arguments"):
                            assembled_tool_calls[idx]["function"]["arguments"] += fn["arguments"]
                    continue

                if tool_calls_detected:
                    continue

                # Convert reasoning → content wrapped in <think> for Open WebUI
                if delta.get("reasoning"):
                    if not reasoning_started:
                        reasoning_started = True
                        yield _sse_chunk("<think>\n", model)
                    yield _sse_chunk(delta["reasoning"], model)
                    continue

                if delta.get("content"):
                    chunk_text = delta["content"]
                    plan_text_parts.append(chunk_text)  # Collect for cover image
                    # Stop streaming if raw tool tokens appear (vLLM parser bug)
                    if "<|tool_call" in chunk_text:
                        log.warning("Raw tool tokens in stream content, truncating")
                        break
                    if reasoning_started and not content_started:
                        content_started = True
                        yield _sse_chunk("\n</think>\n\n", model)
                    direct_content_parts.append(chunk_text)
                    yield _sse_chunk(chunk_text, model)
                    continue

                # Pass through role assignments etc.
                if not tool_calls_detected:
                    yield f"{line}\n\n"
    finally:
        vllm_semaphore.release()

    # Deliver cover image (once only)
    for ct in cover_tasks:
        if ct.done() and not ct.cancelled() and covers_delivered == 0:
            try:
                url = ct.result()
                if url:
                    yield _sse_chunk(f"\n![cover]({url})\n")
                    covers_delivered += 1
                    cover_tasks = []  # prevent re-delivery
            except Exception:
                pass

    # If NO tool calls detected → deliver cover + JSX from direct content, then [DONE]
    if not tool_calls_detected:
        # Wait for and deliver cover image if not yet delivered
        if covers_delivered < 1 and cover_tasks:
            try:
                for ct in list(cover_tasks):
                    if not ct.done():
                        try:
                            await asyncio.wait_for(asyncio.shield(ct), timeout=3.0)
                        except (asyncio.TimeoutError, Exception):
                            pass
                    if ct.done() and not ct.cancelled():
                        try:
                            url = ct.result()
                            if url:
                                yield _sse_chunk(f"\n![cover]({url})\n")
                                covers_delivered += 1
                        except Exception:
                            pass
                    log.info("Cover image delivered after direct answer")
                    pass  # cover handled by task list
            except Exception as e:
                log.warning("Cover image failed: %s", e)

        # Generate JSX from the direct content
        direct_text = "".join(direct_content_parts)
        # Only generate JSX for substantial research content, not conversational replies
        _skip_jsx_patterns = ["tienes razón", "disculpa", "permíteme aclarar", "lo siento", "he cometido", "te pido", "me equivoqué", "error"]
        _is_conversational = direct_text and any(p in direct_text.lower()[:200] for p in _skip_jsx_patterns)
        if direct_text and len(direct_text) > 1500 and not _is_conversational:
            yield _sse_event("presentation_start", {"status": "generating_jsx"})

            jsx_task = asyncio.ensure_future(
                generate_jsx_presentation(synthesis_text, original_query)
            )
            while not jsx_task.done():
                await asyncio.sleep(3)
                yield ": heartbeat\n\n"

            try:
                jsx_code = jsx_task.result()
                if jsx_code:
                    yield _sse_chunk("\n\n```jsx\n" + jsx_code + "\n```\n")
                    log.info("JSX presentation sent for direct answer")
                else:
                    log.info("JSX presentation skipped for direct answer")
            except Exception as e:
                log.error("JSX generation error: %s", e)

        yield "data: [DONE]\n\n"
        return

    # Fallback: tool_calls_detected but no actual tool calls assembled
    if not assembled_tool_calls:
        log.warning("Tool calls flag set but no calls assembled — falling back to direct response")
        # Deliver cover image
        if covers_delivered < 1 and cover_tasks:
            try:
                for ct in list(cover_tasks):
                    if not ct.done():
                        try:
                            await asyncio.wait_for(asyncio.shield(ct), timeout=3.0)
                        except (asyncio.TimeoutError, Exception):
                            pass
                    if ct.done() and not ct.cancelled():
                        try:
                            url = ct.result()
                            if url:
                                yield _sse_chunk(f"\n![cover]({url})\n")
                                covers_delivered += 1
                        except Exception:
                            pass
                    pass  # cover handled by task list
            except Exception:
                pass
        yield _sse_chunk("Lo siento, no he podido planificar los agentes. Reintenta la consulta.", model)
        yield "data: [DONE]\n\n"
        return

    # If tool calls detected → execute and stream synthesis
    if assembled_tool_calls:
        tool_calls_list = [assembled_tool_calls[i] for i in sorted(assembled_tool_calls.keys())]
        log.info("Tool calls detected: %s", [tc["function"]["name"] for tc in tool_calls_list])

        # Per-request persona assignment
        assign_persona = make_persona_assigner()
        spawn_tasks, search_tasks, fetch_tasks = parse_tool_calls(tool_calls_list)

        # --- Stream search/fetch status ---
        for _, query in search_tasks:
            yield _sse_chunk(f"  🌐 Searching: *{query}*\n", model)
            yield _sse_event("activity", {"agent": "Orchestrator", "type": "search", "detail": query})

        for _, url in fetch_tasks:
            short_url = url[:60] + "..." if len(url) > 60 else url
            yield _sse_chunk(f"  📄 Fetching: *{short_url}*\n", model)
            yield _sse_event("activity", {"agent": "Orchestrator", "type": "fetch", "detail": short_url})

        # --- Stream agent swarm launch ---
        if spawn_tasks:
            limited = spawn_tasks[:MAX_PARALLEL_AGENTS]
            n = len(limited)

            agent_display = {}
            for _, agent_id, _ in limited:
                persona = assign_persona(agent_id)
                agent_display[agent_id] = persona

            # Swarm start header
            header = f"\n---\n**🚀 AGENT SWARM** — Launching {n} agents\n\n"
            for i, (_, agent_id, task) in enumerate(limited, 1):
                short_task = task[:100] + "..." if len(task) > 100 else task
                display = agent_display[agent_id]
                header += f"  `{i}/{n}` **{display['display_name']}** — {short_task}\n"
            header += "\n---\n\n"
            yield _sse_chunk(header, model)

            # Emit typed swarm_start event
            agent_tasks_for_video = [task for _, _, task in limited]
            video_prompts = await generate_visual_prompts(original_query, agent_tasks_for_video)
            yield _sse_event("swarm_start", {
                "count": n,
                "agents": [
                    {"name": agent_display[aid]["display_name"], "orchName": agent_display[aid]["orchName"],
                     "role": agent_display[aid]["role"], "task": task[:150]}
                    for _, aid, task in limited
                ],
                "video_prompts": video_prompts,
            })

            # Cover images delivered later (pre-synthesis) to avoid duplicates

            # Activity queue for real-time reporting
            activity_queue = asyncio.Queue()

            # Launch agents with display names
            futures = []
            for call_id, agent_id, task in limited:
                display_name = agent_display[agent_id]["display_name"]
                coro = execute_sub_agent(display_name, task, 1, model, activity_queue)
                fut = asyncio.ensure_future(coro)
                fut._meta = (call_id, agent_id, display_name)
                futures.append(fut)

            completed = 0
            pending = set(futures)
            tool_results = []
            contextual_image_tasks = []  # Track contextual image generation
            contextual_images_launched = 0

            while pending:
                # Drain activity queue
                while not activity_queue.empty():
                    try:
                        act = activity_queue.get_nowait()
                        # Resolve orchName for activity
                        for aid, disp in agent_display.items():
                            if disp.get("display_name") == act.get("agent"):
                                act["orchName"] = disp["orchName"]
                                break
                        yield _sse_event("activity", act)
                        yield _sse_chunk(f"[ACTIVITY:{act['agent']}:{act['type']}] {act.get('detail', '')}\n", model)
                    except asyncio.QueueEmpty:
                        break

                # Cover delivered pre-synthesis to avoid duplicates

                # Deliver completed contextual images as inline markdown
                for cit in list(contextual_image_tasks):
                    if cit.done():
                        contextual_image_tasks.remove(cit)
                        try:
                            img_data = cit.result()
                            if img_data and img_data.get("image"):
                                yield _sse_chunk(f"\n\n![{img_data['agent']}]({img_data['image']})\n\n", model)
                                log.info("Contextual image delivered inline for '%s'", img_data["agent"])
                        except Exception as e:
                            log.warning("Contextual image failed: %s", e)

                done_set, pending = await asyncio.wait(pending, return_when=asyncio.FIRST_COMPLETED, timeout=0.5)
                yield ": heartbeat\n\n"  # Keep Cloudflare alive during agent execution

                for future in done_set:
                    call_id, agent_id, display_name = future._meta
                    completed += 1
                    try:
                        _, text, elapsed = future.result()
                        yield _sse_chunk(f"  ✅ `{completed}/{n}` **{display_name}** completed ({elapsed:.1f}s)\n", model)
                        yield _sse_event("agent_done", {"agent": display_name, "orchName": agent_display[agent_id]["orchName"], "elapsed": elapsed})
                        yield _sse_chunk(f"\n[AGENT_REPORT:{display_name}]\n{text}\n[/AGENT_REPORT]\n\n", model)
                        tool_results.append({
                            "role": "tool", "tool_call_id": call_id,
                            "content": f"=== Report from agent '{display_name}' ({elapsed:.1f}s) ===\n{text}",
                        })

                        # Generate and deliver contextual image RIGHT AFTER agent report
                        if contextual_images_launched < MAX_CONTEXTUAL_IMAGES and text and len(text) > 50:
                            contextual_images_launched += 1
                            try:
                                img_data = await asyncio.wait_for(
                                    generate_contextual_image(text, display_name), timeout=15.0
                                )
                                if img_data and img_data.get("image"):
                                    yield _sse_chunk(f"\n![{display_name}]({img_data['image']})\n\n", model)
                                    log.info("Contextual image inline for '%s'", display_name)
                            except (asyncio.TimeoutError, Exception) as img_err:
                                log.warning("Contextual image for '%s' failed: %s", display_name, img_err)
                    except Exception as e:
                        log.error("Agent '%s' failed: %s", display_name, e)
                        yield _sse_chunk(f"  ❌ `{completed}/{n}` **{display_name}** failed: {e}\n", model)
                        tool_results.append({
                            "role": "tool", "tool_call_id": call_id,
                            "content": f"Agent '{display_name}' failed: {e}",
                        })

            # Final activity drain
            while not activity_queue.empty():
                try:
                    act = activity_queue.get_nowait()
                    # Resolve orchName for activity
                    for aid, disp in agent_display.items():
                        if disp.get("display_name") == act.get("agent"):
                            act["orchName"] = disp["orchName"]
                            break
                    yield _sse_event("activity", act)
                except asyncio.QueueEmpty:
                    break

            # Wait for any remaining contextual images and deliver inline
            for cit in contextual_image_tasks:
                if not cit.done():
                    try:
                        await asyncio.wait_for(cit, timeout=10.0)
                    except asyncio.TimeoutError:
                        log.warning("Contextual image timed out")
                if cit.done() and not cit.cancelled():
                    try:
                        img_data = cit.result()
                        if img_data and img_data.get("image"):
                            yield _sse_chunk(f"\n\n![{img_data['agent']}]({img_data['image']})\n\n", model)
                            log.info("Final contextual image inline for '%s'", img_data["agent"])
                    except Exception:
                        pass

            yield _sse_event("swarm_complete", {"count": n})
            yield _sse_chunk(f"\n**✅ All {n} agents completed.** Synthesizing final answer...\n\n---\n\n", model)
        else:
            # No spawn tasks — just execute searches/fetches
            tool_results = await _handle_tool_calls(tool_calls_list, 1, model)

        # --- Synthesis ---
        reports_text = "\n\n".join(tr["content"][:10000] for tr in tool_results)
        if len(reports_text) > 80000:
            reports_text = reports_text[:80000]

        # Deliver any ready cover images (non-blocking, 3s max)
        if cover_tasks:
            for ct in list(cover_tasks):
                if not ct.done():
                    try:
                        await asyncio.wait_for(asyncio.shield(ct), timeout=3.0)
                    except (asyncio.TimeoutError, Exception):
                        pass
                if ct.done() and not ct.cancelled():
                    try:
                        url = ct.result()
                        if url:
                            yield _sse_chunk(f"\n![cover]({url})\n")
                            covers_delivered += 1
                    except Exception:
                        pass
            log.info("Cover images before synthesis: %d delivered", covers_delivered)

        ui_components = get_ui_components(session_id)
        synthesis_system = build_synthesis_prompt(ui_components)

        synth_messages = [
            {"role": "system", "content": synthesis_system},
            {"role": "user", "content": f"FECHA ACTUAL: {datetime.now().strftime(chr(37)+"Y-"+chr(37)+"m-"+chr(37)+"d")} — PREGUNTA ORIGINAL: {original_query}\n\nINFORMES DE INVESTIGACIÓN:\n\n{reports_text}\n\nINSTRUCCIONES CRÍTICAS:\n1. NO resumas cada informe por separado — SINTETIZA toda la información en una respuesta coherente y unificada.\n2. Escribe como si TÚ supieras directamente toda esta información. NUNCA menciones agentes, investigadores, informes o fuentes internas.\n3. Estructura la respuesta por TEMAS, no por origen de la información.\n4. Incluye datos concretos (cifras, nombres, fechas) cuando estén disponibles.\n5. Si hay datos contradictorios entre informes, usa el más fiable o menciona la discrepancia.\n6. Responde en el mismo idioma que la pregunta original."},
        ]

        synth_payload = {
            "model": DEFAULT_MODEL,  # always use served model name
            "messages": synth_messages,
            "max_tokens": PROFILE_SYNTHESIS["max_tokens"],
            "temperature": PROFILE_SYNTHESIS["temperature"],
            "top_p": PROFILE_SYNTHESIS["top_p"],
            "stream": True,
            "chat_template_kwargs": {"thinking": False},
        }

        synth_reasoning = False
        synth_content = False
        full_synthesis = []  # Collect full synthesis for JSX generation

        yield _sse_event("synthesis_start", {"status": "generating"})

        await vllm_semaphore.acquire()
        try:
            async with http_client.stream(
                "POST",
                f"{VLLM_BASE_URL}/v1/chat/completions",
                json=synth_payload,
                timeout=300.0,
            ) as resp:
                _synth_hb = __import__("time").monotonic()
                async for line in resp.aiter_lines():
                    # Heartbeat every 8s to keep Cloudflare alive during synthesis
                    _now_hb = __import__("time").monotonic()
                    if _now_hb - _synth_hb > 8:
                        yield ": heartbeat\n\n"

                        _synth_hb = _now_hb
                    if not line.startswith("data: "):
                        continue
                    raw = line[6:]
                    if raw.strip() == "[DONE]":
                        if synth_reasoning and not synth_content:
                            yield _sse_chunk("\n</think>\n\n", model)
                        break
                    try:
                        chunk = json.loads(raw)
                    except json.JSONDecodeError:
                        yield f"{line}\n\n"
                        continue
                    delta = chunk.get("choices", [{}])[0].get("delta", {})
                    if delta.get("reasoning"):
                        if not synth_reasoning:
                            synth_reasoning = True
                            yield _sse_chunk("<think>\n", model)
                        yield _sse_chunk(delta["reasoning"], model)
                    elif delta.get("content"):
                        text = delta["content"]
                        # Stop if raw tool tokens leak (vLLM parser bug)
                        if "<|tool_call" in text:
                            log.warning("Raw tool tokens in synthesis stream, truncating")
                            break
                        if synth_reasoning and not synth_content:
                            synth_content = True
                            yield _sse_chunk("\n</think>\n\n", model)
                        full_synthesis.append(text)
                        yield _sse_chunk(text, model)
                    else:
                        yield f"{line}\n\n"
        finally:
            vllm_semaphore.release()

        yield _sse_event("synthesis_complete", {"status": "done"})
        log.info("Synthesis complete: %d chars collected", sum(len(s) for s in full_synthesis))

        # --- JSX Presentation ---
        synthesis_text = "".join(full_synthesis)
        log.info("JSX check: synthesis_text length = %d", len(synthesis_text))
        if synthesis_text and len(synthesis_text) > 800:
            yield _sse_event("presentation_start", {"status": "generating_jsx"})

            # Run JSX generation with heartbeat to keep SSE alive
            jsx_task = asyncio.ensure_future(
                generate_jsx_presentation(synthesis_text, original_query)
            )
            while not jsx_task.done():
                await asyncio.sleep(3)
                yield ": heartbeat\n\n"  # SSE comment, keeps connection alive

            try:
                jsx_code = jsx_task.result()
                if jsx_code:
                    yield _sse_chunk("\n\n```jsx\n" + jsx_code + "\n```\n")
                    log.info("JSX presentation sent to frontend")
                else:
                    log.info("JSX presentation skipped (generation failed or too short)")
            except Exception as e:
                log.error("JSX generation error: %s", e)

        # Final DONE
        yield "data: [DONE]\n\n"


# ─── Non-streaming Orchestration ────────────────────────────────────────────

async def orchestrate(messages: list, max_tokens: int, temperature: float, model: str) -> dict:
    has_system = any(m.get("role") == "system" for m in messages)
    if not has_system:
        messages = [{"role": "system", "content": SWARM_SYSTEM_PROMPT}] + messages
    result = await call_vllm(messages, model=model, tools=SWARM_TOOLS, profile=PROFILE_AGENT_CONTROL)
    choice = result.get("choices", [{}])[0]
    message = choice.get("message", {})

    if choice.get("finish_reason") == "tool_calls" and message.get("tool_calls"):
        tool_results = await _handle_tool_calls(message["tool_calls"], depth=1, model=model)
        reports_text = "\n\n".join(tr["content"][:10000] for tr in tool_results)
        if len(reports_text) > 80000:
            reports_text = reports_text[:80000]
        synth_messages = [
            {"role": "system", "content": "You are a research synthesis assistant. Synthesize the agent reports into a comprehensive answer. Do NOT call any functions."},
            messages[-1],
            {"role": "assistant", "content": "I dispatched specialized research agents. Here are their reports:"},
            {"role": "user", "content": f"AGENT REPORTS:\n\n{reports_text}\n\nProvide a comprehensive synthesized answer."},
        ]
        return await call_vllm(synth_messages, model=model, profile=PROFILE_SYNTHESIS)
    return result

# ─── API Endpoints ───────────────────────────────────────────────────────────

@app.get("/api/info")
async def api_info():
    return {
        "service": "ThotBrain Agent Swarm Orchestrator",
        "version": "2.1-stage2a",
        "model": DEFAULT_MODEL,
        "tools": ["web_search", "fetch_url", "spawn_agent"],
        "endpoints": {
            "chat": "POST /v1/chat/completions",
            "models": "GET /v1/models",
            "health": "GET /health",
            "handshake": "POST /v1/handshake",
            "cover": "POST /v1/cover",
            "present": "POST /v1/present",
        },
        "config": {
            "max_parallel_agents": MAX_PARALLEL_AGENTS,
            "max_concurrent_vllm": MAX_CONCURRENT_VLLM,
            "agent_timeout": AGENT_TIMEOUT,
        },
    }


@app.get("/health")
async def health():
    checks = {}
    for name, url in [("vllm", VLLM_BASE_URL), ("omni", OMNI_BASE_URL), ("zimage", ZIMAGE_BASE_URL), ("coder", CODER_BASE_URL)]:
        try:
            resp = await http_client.get(f"{url}/health", timeout=5.0)
            checks[name] = resp.status_code == 200
        except Exception:
            checks[name] = False
    all_ok = all(checks.values())
    return {"status": "ok" if all_ok else "degraded", **checks}


@app.get("/warmup")
async def warmup():
    """Warmup all backends with a small generation to wake up GPU caches.
    Call this before testing to ensure fast first responses."""
    import time as _time
    results = {}

    # 1. Health check all backends
    for name, url in [("kimi", VLLM_BASE_URL), ("omni", OMNI_BASE_URL), ("zimage", ZIMAGE_BASE_URL), ("coder", CODER_BASE_URL)]:
        try:
            resp = await http_client.get(f"{url}/health", timeout=5.0)
            results[name] = {"health": resp.status_code == 200}
        except Exception as e:
            results[name] = {"health": False, "error": str(e)}

    # 2. Warmup Kimi with mini generation + tool call test
    t0 = _time.time()
    try:
        resp = await http_client.post(
            f"{VLLM_BASE_URL}/v1/chat/completions",
            json={
                "model": DEFAULT_MODEL,
                "messages": [{"role": "user", "content": "Say OK"}],
                "max_tokens": 5, "temperature": 0, "stream": False,
            "chat_template_kwargs": {"thinking": False},
                "tools": SWARM_TOOLS, "tool_choice": "auto",
            },
            timeout=30.0,
        )
        data = resp.json()
        has_tools = bool(data.get("choices", [{}])[0].get("message", {}).get("tool_calls"))
        results["kimi"]["warmup_ms"] = int((_time.time() - t0) * 1000)
        results["kimi"]["tool_calls_working"] = has_tools
        results["kimi"]["content"] = (data.get("choices", [{}])[0].get("message", {}).get("content") or "")[:50]
    except Exception as e:
        results["kimi"]["warmup_error"] = str(e)

    # 3. Warmup Coder with mini generation
    t0 = _time.time()
    try:
        resp = await http_client.post(
            f"{CODER_BASE_URL}/v1/chat/completions",
            json={
                "model": CODER_MODEL,
                "messages": [{"role": "user", "content": "Say OK"}],
                "max_tokens": 5, "temperature": 0, "stream": False,
            "chat_template_kwargs": {"thinking": False},
            },
            timeout=30.0,
        )
        results["coder"]["warmup_ms"] = int((_time.time() - t0) * 1000)
    except Exception as e:
        results["coder"]["warmup_error"] = str(e)

    # 4. Warmup Z-Image with tiny image
    t0 = _time.time()
    try:
        resp = await http_client.post(
            f"{ZIMAGE_BASE_URL}/generate",
            json={"prompt": "test warmup", "width": 256, "height": 256},
            timeout=15.0,
        )
        results["zimage"]["warmup_ms"] = int((_time.time() - t0) * 1000)
        results["zimage"]["image_ok"] = resp.status_code == 200
    except Exception as e:
        results["zimage"]["warmup_error"] = str(e)

    all_healthy = all(r.get("health", False) for r in results.values())
    return {"status": "ready" if all_healthy else "degraded", "backends": results}


@app.get("/v1/models")
async def list_models(user: str = Depends(verify_api_key)):
    resp = await http_client.get(f"{VLLM_BASE_URL}/v1/models")
    return resp.json()


@app.post("/v1/handshake")
async def handshake(request: Request, user: str = Depends(verify_api_key)):
    """Client registers its UI rendering capabilities."""
    body = await request.json()
    session_id = body.get("session_id", str(uuid.uuid4()))
    components = body.get("components", DEFAULT_UI_COMPONENTS)
    _ui_capabilities[session_id] = components
    log.info("Handshake from '%s': %d components registered (session=%s)",
             user, len(components), session_id)
    return {
        "session_id": session_id,
        "registered_components": [c["type"] for c in components],
        "agents": [{"name": p["display"], "role": p["role"]} for p in AGENT_PERSONAS],
    }


@app.post("/v1/chat/completions")
async def chat_completions(request: Request, user: str = Depends(verify_api_key)):
    body = await request.json()
    messages = body.get("messages", [])
    max_tokens = body.get("max_tokens", 4096)
    temperature = body.get("temperature", 0.7)
    stream = body.get("stream", False)
    model = body.get("model", DEFAULT_MODEL)
    session_id = body.get("session_id") or request.headers.get("X-Session-ID")
    images = body.get("images", [])

    # If images are attached, convert the last user message to multimodal format
    if images and messages:
        for i in range(len(messages) - 1, -1, -1):
            if messages[i].get("role") == "user":
                text_content = messages[i].get("content", "")
                # Build multimodal content array
                content_parts = [{"type": "text", "text": text_content}]
                for img in images:
                    data_url = img.get("data", "")
                    if data_url.startswith("data:"):
                        content_parts.append({
                            "type": "image_url",
                            "image_url": {"url": data_url}
                        })
                        log.info("Attached image: %s", img.get("name", "unknown"))
                messages[i]["content"] = content_parts
                break

    log.info("Chat request: user=%s, model=%s, stream=%s, msgs=%d, images=%d",
             user, model, stream, len(messages), len(images))

    if stream:
        return StreamingResponse(
            orchestrate_stream(messages, max_tokens, temperature, model, session_id),
            media_type="text/event-stream; charset=utf-8",
        )
    else:
        result = await orchestrate(messages, max_tokens, temperature, model)
        return JSONResponse(result)


@app.get("/ui")
async def ui_page():
    ui_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "ui", "index.html")
    if os.path.exists(ui_path):
        return FileResponse(ui_path, media_type="text/html")
    return HTMLResponse("<h1>UI not found</h1><p>Place index.html in ./ui/</p>", status_code=404)


@app.post("/admin/create-key")
async def create_key(request: Request):
    client_ip = request.client.host
    if client_ip not in ("127.0.0.1", "::1", "localhost"):
        raise HTTPException(status_code=403, detail="Admin endpoints only from localhost")
    body = await request.json()
    name = body.get("name", "unnamed")
    key = generate_api_key(name)
    return {"api_key": key, "name": name, "message": "Save this key - it cannot be retrieved later"}


@app.get("/admin/list-keys")
async def list_keys(request: Request):
    client_ip = request.client.host
    if client_ip not in ("127.0.0.1", "::1", "localhost"):
        raise HTTPException(status_code=403, detail="Admin endpoints only from localhost")
    keys = load_api_keys()
    return [{"name": v["name"], "created": v["created"]} for v in keys.values()]


@app.post("/v1/cover")
async def api_cover(request: Request):
    """Generate a cover image from a query."""
    body = await request.json()
    query = body.get("query", "")
    if not query:
        raise HTTPException(status_code=400, detail="query is required")
    image_b64 = await generate_cover_image(query)
    if image_b64:
        return {"image_base64": image_b64}
    raise HTTPException(status_code=502, detail="Image generation failed")


@app.post("/v1/present")
async def api_present(request: Request):
    """Generate a JSX presentation from synthesis text."""
    body = await request.json()
    synthesis = body.get("synthesis", "")
    query = body.get("query", "")
    if not synthesis:
        raise HTTPException(status_code=400, detail="synthesis is required")
    jsx_code = await generate_jsx_presentation(synthesis, query)
    if jsx_code:
        return {"jsx": jsx_code}
    raise HTTPException(status_code=502, detail="JSX generation failed")


@app.post("/api/coder/generate")
async def api_coder_generate(request: Request):
    """Proxy to Qwen3-Coder for JSX generation — used by sandbox page."""
    body = await request.json()
    messages = body.get("messages", [])
    max_tokens = body.get("max_tokens", 4096)
    temperature = body.get("temperature", 0.3)
    if not messages:
        return {"error": "messages required"}
    try:
        payload = {
            "model": CODER_MODEL,
            "messages": messages,
            "max_tokens": max_tokens,
            "temperature": temperature,
            "stream": False,
            "chat_template_kwargs": {"thinking": False},
            "chat_template_kwargs": {"thinking": False},
        }
        resp = await http_client.post(
            f"{CODER_BASE_URL}/v1/chat/completions",
            json=payload,
            timeout=90.0,
        )
        if resp.status_code != 200:
            return {"error": f"Coder returned HTTP {resp.status_code}"}
        data = resp.json()
        content = data["choices"][0]["message"].get("content", "")
        # Strip <think> blocks if present
        import re
        content = re.sub(r"<think>.*?</think>\s*", "", content, flags=re.DOTALL).strip()
        return {"jsx": content}
    except Exception as e:
        return {"error": str(e)}


@app.get("/sandbox")
async def serve_sandbox():
    """Serve the Coder JSX sandbox page."""
    sandbox_path = os.path.join(STATIC_DIR, 'sandbox.html')
    if os.path.exists(sandbox_path):
        return FileResponse(sandbox_path, media_type="text/html", headers={
            "Cache-Control": "no-cache, no-store, must-revalidate",
        })
    return HTMLResponse('<h1>Sandbox not found</h1>', status_code=404)


# ── Static Files & SPA ───────────────────────────────────────────────────────

STATIC_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'thotbrain-dist')

if os.path.isdir(os.path.join(STATIC_DIR, 'assets')):
    app.mount('/assets', StaticFiles(directory=os.path.join(STATIC_DIR, 'assets')), name='static-assets')
    log.info('Mounted ThotBrain React UI from %s', STATIC_DIR)

@app.get('/reset')
async def reset_page():
    return HTMLResponse('''<!doctype html><html><head><title>Reset</title></head>
<body style="font-family:sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;background:#FAF8F2">
<div style="text-align:center"><h1>Limpiando ThotBrain...</h1>
<script>localStorage.clear();sessionStorage.clear();setTimeout(function(){window.location.href='/'},1000);</script>
<p>Redirigiendo...</p></div></body></html>''')

@app.get('/')
async def serve_spa_root():
    index = os.path.join(STATIC_DIR, 'index.html')
    if os.path.exists(index):
        return FileResponse(index, media_type="text/html", headers={
            "Cache-Control": "no-cache, no-store, must-revalidate",
            "Pragma": "no-cache",
            "Expires": "0",
        })
    return HTMLResponse('<h1>ThotBrain UI not found</h1>', status_code=404)

@app.get('/favicon.svg')
async def serve_favicon():
    fav = os.path.join(STATIC_DIR, 'favicon.svg')
    if os.path.exists(fav):
        return FileResponse(fav, media_type="image/svg+xml")
    return HTMLResponse('', status_code=404)




# Proxies for ASR, TTS, Video, Coder
import httpx as _httpx

ASR_BASE = "http://100.64.0.29:8500"
TTS_BASE = "http://100.64.0.29:8600"
VIDEO_BASE = "http://100.64.0.29:8400"

@app.api_route("/asr/{path:path}", methods=["GET", "POST"])
async def asr_proxy(path: str, request: Request):
    url = f"{ASR_BASE}/{path}"
    h = dict(request.headers); h.pop("host", None)
    body = await request.body()
    async with _httpx.AsyncClient(timeout=60.0) as c:
        r = await c.request(request.method, url, headers=h, content=body)
        return Response(content=r.content, status_code=r.status_code, headers={"content-type": r.headers.get("content-type", "application/json")})

@app.api_route("/tts/{path:path}", methods=["GET", "POST"])
async def tts_proxy(path: str, request: Request):
    url = f"{TTS_BASE}/{path}"
    h = dict(request.headers); h.pop("host", None)
    body = await request.body()
    async with _httpx.AsyncClient(timeout=60.0) as c:
        r = await c.request(request.method, url, headers=h, content=body)
        return Response(content=r.content, status_code=r.status_code, headers={"content-type": r.headers.get("content-type", "application/json")})

@app.api_route("/video/{path:path}", methods=["GET", "POST", "HEAD"])
async def video_proxy(path: str, request: Request):
    try:
        url = f"{VIDEO_BASE}/{path}"
        h = dict(request.headers); h.pop("host", None)
        body = await request.body()
        async with _httpx.AsyncClient(timeout=30.0) as c:
            r = await c.request(request.method, url, headers=h, content=body)
            rh = {k: r.headers[k] for k in ["content-type", "content-length", "accept-ranges"] if k in r.headers}
            return Response(content=r.content, status_code=r.status_code, headers=rh)
    except Exception:
        return JSONResponse({"error": "video service unavailable"}, status_code=503)

@app.api_route("/coder/{path:path}", methods=["GET", "POST"])
async def coder_proxy(path: str, request: Request):
    url = f"{CODER_BASE_URL}/{path}"
    h = dict(request.headers); h.pop("host", None)
    body = await request.body()
    async with _httpx.AsyncClient(timeout=120.0) as c:
        r = await c.request(request.method, url, headers=h, content=body)
        return Response(content=r.content, status_code=r.status_code, headers={"content-type": r.headers.get("content-type", "application/json")})

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8082)
