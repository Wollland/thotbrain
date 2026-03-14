"""
ThotBrain Agent Swarm Orchestrator v2
--------------------------------------
Middleware between frontend (Open WebUI / ThotBrain React) and vLLM,
orchestrating parallel sub-agent execution with Kimi K2.5's native tool calling.

Architecture:
  ThotBrain React :3000 → Orchestrator :8081 → vLLM :8000 (H200)

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
import hashlib
import json
import logging
import os
import secrets
import time
import uuid
from contextlib import asynccontextmanager
from typing import AsyncIterator

import httpx
from fastapi import FastAPI, Request, HTTPException, Depends
from fastapi.responses import StreamingResponse, JSONResponse, HTMLResponse, FileResponse
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
DEFAULT_MODEL = os.environ.get("DEFAULT_MODEL", "kimi2.5")
MAX_RECURSION_DEPTH = 3
MAX_PARALLEL_AGENTS = 20
AGENT_TIMEOUT = 120
MAX_CONCURRENT_VLLM = 8
VLLM_RETRY_ATTEMPTS = 2
VLLM_RETRY_DELAY = 1.0

SERPER_API_KEY = os.environ.get("SERPER_API_KEY", "")
SERPER_URL = "https://google.serper.dev/search"
JINA_API_KEY = os.environ.get("JINA_API_KEY", "")
JINA_READER_URL = "https://r.jina.ai/"

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
]

# ─── System Prompt for Agent Swarm ────────────────────────────────────────────

SWARM_SYSTEM_PROMPT = """You are ThotBrain, an advanced AI orchestrator that commands a swarm of specialized research agents.

CRITICAL INSTRUCTION: For ANY question that requires research, analysis, comparison, or in-depth investigation, you MUST use the spawn_agent tool to delegate work to multiple specialized agents working in parallel.

WHEN TO USE spawn_agent (ALWAYS for these types):
- Questions asking to "analyze", "compare", "research", "investigate", "evaluate"
- Questions about products, technologies, markets, trends
- Questions requiring multiple perspectives (technical, commercial, legal, etc.)
- Any question that would benefit from parallel research by specialists

HOW TO USE spawn_agent:
- Spawn 3-6 agents with different specialized roles
- Each agent_id should reflect their specialty (e.g., "technical_analyst", "market_researcher", "legal_advisor")
- Each task should be specific and focused on one aspect of the question
- Be specific in the task description so each agent knows exactly what to research

Example: For "Compare Kubernetes vs Docker Swarm", spawn:
1. spawn_agent(agent_id="infrastructure_expert", task="Analyze Kubernetes architecture, scalability, and production readiness")
2. spawn_agent(agent_id="devops_analyst", task="Analyze Docker Swarm simplicity, learning curve, and deployment workflow")
3. spawn_agent(agent_id="cost_analyst", task="Compare total cost of ownership, licensing, and resource requirements")
4. spawn_agent(agent_id="enterprise_advisor", task="Evaluate enterprise adoption, community support, and ecosystem maturity")

You can also use web_search to find current information, and fetch_url to read specific web pages.

For simple greetings or trivial questions, respond directly without tools.

IMPORTANT: When in doubt, USE spawn_agent. The user expects to see the agent swarm in action."""

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
    """Build the synthesis system prompt that tells the LLM which UI components are available."""
    comp_descriptions = []
    for c in components:
        props = ", ".join(f'"{k}": {v}' for k, v in c.get("props_schema", {}).items())
        comp_descriptions.append(f'  - type: "{c["type"]}", props: {{{props}}}')
    comp_list = "\n".join(comp_descriptions)

    return f"""You are a research synthesis assistant. You receive reports from specialized research agents
and must synthesize them into a comprehensive, well-structured final answer.

You have TWO output modes:

MODE 1 — STRUCTURED (when the frontend supports dynamic rendering):
Return a JSON object with this exact structure:
{{
  "text": "Your markdown summary text here",
  "blocks": [
    {{"id": "unique-id", "type": "ComponentType", "props": {{...}}}}
  ]
}}

Available UI components for blocks:
{comp_list}

MODE 2 — TEXT ONLY (default):
Write the answer directly as markdown text. Do NOT call any functions or tools.

Use MODE 1 only when the user's question naturally maps to structured data (metrics, charts, tables, legal analysis).
For simple conversational answers, use MODE 2.

Write the answer directly. Be comprehensive and well-structured."""

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
        timeout=httpx.Timeout(connect=10, read=300, write=10, pool=30),
        limits=httpx.Limits(max_connections=50, max_keepalive_connections=20),
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

async def serper_search(query: str, num_results: int = 8) -> str:
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


async def jina_fetch(url: str, max_chars: int = 8000) -> str:
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
    max_tokens: int = 4096,
    temperature: float = 0.7,
) -> dict:
    """Non-streaming call to vLLM with semaphore and retry."""
    payload = {
        "model": model or DEFAULT_MODEL,
        "messages": messages,
        "max_tokens": max_tokens,
        "temperature": temperature,
        "stream": False,
    }
    if tools:
        payload["tools"] = tools
        payload["tool_choice"] = "auto"

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
                return resp.json()
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
    return f"data: {json.dumps(chunk)}\n\n"


def _sse_event(event_type: str, data: dict) -> str:
    """Create a typed SSE event for structured agent activity."""
    return f"event: {event_type}\ndata: {json.dumps(data)}\n\n"

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

    system_prompt = (
        f"You are sub-agent '{agent_id}'. Your task is below. "
        "Be thorough, specific, and provide detailed findings. "
        "If the task requires further decomposition, you may spawn additional sub-agents."
    )
    messages = [
        {"role": "system", "content": system_prompt},
        {"role": "user", "content": task},
    ]

    tools = SWARM_TOOLS if depth < MAX_RECURSION_DEPTH else None
    await report("thinking", "Analyzing task and planning approach...")
    result = await call_vllm(messages, model=model, tools=tools, max_tokens=4096, temperature=0.5)

    choice = result.get("choices", [{}])[0]
    message = choice.get("message", {})

    if choice.get("finish_reason") == "tool_calls" and message.get("tool_calls"):
        # Execute tool calls
        await report("executing_tools", f"{len(message['tool_calls'])} tools")
        tool_results = await _handle_tool_calls(
            message["tool_calls"], depth + 1, model, activity_queue, agent_id,
        )

        await report("synthesizing", "Processing results and forming conclusions...")
        messages.append(message)
        messages.extend(tool_results)
        final = await call_vllm(messages, model=model, max_tokens=4096, temperature=0.5)
        final_msg = final.get("choices", [{}])[0].get("message", {})

        reasoning = final_msg.get("reasoning") or ""
        content = final_msg.get("content") or ""

        text = ""
        if reasoning:
            await report("reasoning", reasoning[:200])
            text += f"REASONING:\n{reasoning}\n\n"
        text += f"CONCLUSION:\n{content}"
    else:
        reasoning = message.get("reasoning") or ""
        content = message.get("content") or ""
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

# ─── Streaming Orchestration ────────────────────────────────────────────────

async def orchestrate_stream(
    messages: list,
    max_tokens: int,
    temperature: float,
    model: str,
    session_id: str | None = None,
) -> AsyncIterator[str]:
    """Main streaming orchestration: stream directly, handle tool calls if detected."""
    log.info("Stream request: model=%s, msgs=%d", model, len(messages))

    # Inject swarm system prompt if not already present
    has_system = any(m.get("role") == "system" for m in messages)
    if not has_system:
        messages = [{"role": "system", "content": SWARM_SYSTEM_PROMPT}] + messages

    payload = {
        "model": model,
        "messages": messages,
        "max_tokens": max_tokens,
        "temperature": temperature,
        "stream": True,
        "tools": SWARM_TOOLS,
        "tool_choice": "auto",
    }

    tool_calls_detected = False
    assembled_tool_calls = {}
    reasoning_started = False
    content_started = False

    # Acquire semaphore for the streaming request
    await vllm_semaphore.acquire()
    try:
        async with http_client.stream(
            "POST",
            f"{VLLM_BASE_URL}/v1/chat/completions",
            json=payload,
        ) as resp:
            async for line in resp.aiter_lines():
                if not line.startswith("data: "):
                    continue
                raw = line[6:]
                if raw.strip() == "[DONE]":
                    if not tool_calls_detected:
                        if reasoning_started and not content_started:
                            yield _sse_chunk("\n</think>\n\n", model)
                        yield f"{line}\n\n"
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
                    if reasoning_started and not content_started:
                        content_started = True
                        yield _sse_chunk("\n</think>\n\n", model)
                    yield _sse_chunk(delta["content"], model)
                    continue

                # Pass through role assignments etc.
                if not tool_calls_detected:
                    yield f"{line}\n\n"
    finally:
        vllm_semaphore.release()

    # If tool calls detected → execute and stream synthesis
    if tool_calls_detected and assembled_tool_calls:
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
            yield _sse_event("swarm_start", {
                "count": n,
                "agents": [
                    {"name": agent_display[aid]["display_name"], "orchName": agent_display[aid]["orchName"],
                     "role": agent_display[aid]["role"], "task": task[:150]}
                    for _, aid, task in limited
                ],
            })

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

            while pending:
                # Drain activity queue
                while not activity_queue.empty():
                    try:
                        act = activity_queue.get_nowait()
                        yield _sse_event("activity", act)
                        yield _sse_chunk(f"[ACTIVITY:{act['agent']}:{act['type']}] {act.get('detail', '')}\n", model)
                    except asyncio.QueueEmpty:
                        break

                done_set, pending = await asyncio.wait(pending, return_when=asyncio.FIRST_COMPLETED, timeout=0.5)

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
                    yield _sse_event("activity", act)
                except asyncio.QueueEmpty:
                    break

            yield _sse_event("swarm_complete", {"count": n})
            yield _sse_chunk(f"\n**✅ All {n} agents completed.** Synthesizing final answer...\n\n---\n\n", model)
        else:
            # No spawn tasks — just execute searches/fetches
            tool_results = await _handle_tool_calls(tool_calls_list, 1, model)

        # --- Synthesis ---
        reports_text = "\n\n".join(tr["content"] for tr in tool_results)

        ui_components = get_ui_components(session_id)
        synthesis_system = build_synthesis_prompt(ui_components)

        synth_messages = [
            {"role": "system", "content": synthesis_system},
            messages[-1],  # Original user question
            {"role": "assistant", "content": "I dispatched specialized research agents to investigate this. Here are their completed reports:"},
            {"role": "user", "content": f"AGENT REPORTS:\n\n{reports_text}\n\nBased on these reports, provide a comprehensive synthesized answer to my original question."},
        ]

        synth_payload = {
            "model": model,
            "messages": synth_messages,
            "max_tokens": max_tokens,
            "temperature": temperature,
            "stream": True,
        }

        synth_reasoning = False
        synth_content = False

        await vllm_semaphore.acquire()
        try:
            async with http_client.stream(
                "POST",
                f"{VLLM_BASE_URL}/v1/chat/completions",
                json=synth_payload,
            ) as resp:
                async for line in resp.aiter_lines():
                    if not line.startswith("data: "):
                        continue
                    raw = line[6:]
                    if raw.strip() == "[DONE]":
                        if synth_reasoning and not synth_content:
                            yield _sse_chunk("\n</think>\n\n", model)
                        yield f"{line}\n\n"
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
                        if synth_reasoning and not synth_content:
                            synth_content = True
                            yield _sse_chunk("\n</think>\n\n", model)
                        yield _sse_chunk(delta["content"], model)
                    else:
                        yield f"{line}\n\n"
        finally:
            vllm_semaphore.release()


# ─── Non-streaming Orchestration ────────────────────────────────────────────

async def orchestrate(messages: list, max_tokens: int, temperature: float, model: str) -> dict:
    has_system = any(m.get("role") == "system" for m in messages)
    if not has_system:
        messages = [{"role": "system", "content": SWARM_SYSTEM_PROMPT}] + messages
    result = await call_vllm(messages, model=model, tools=SWARM_TOOLS, max_tokens=max_tokens, temperature=temperature)
    choice = result.get("choices", [{}])[0]
    message = choice.get("message", {})

    if choice.get("finish_reason") == "tool_calls" and message.get("tool_calls"):
        tool_results = await _handle_tool_calls(message["tool_calls"], depth=1, model=model)
        reports_text = "\n\n".join(tr["content"] for tr in tool_results)
        synth_messages = [
            {"role": "system", "content": "You are a research synthesis assistant. Synthesize the agent reports into a comprehensive answer. Do NOT call any functions."},
            messages[-1],
            {"role": "assistant", "content": "I dispatched specialized research agents. Here are their reports:"},
            {"role": "user", "content": f"AGENT REPORTS:\n\n{reports_text}\n\nProvide a comprehensive synthesized answer."},
        ]
        return await call_vllm(synth_messages, model=model, max_tokens=max_tokens, temperature=temperature)
    return result

# ─── API Endpoints ───────────────────────────────────────────────────────────

@app.get("/api/info")
async def api_info():
    return {
        "service": "ThotBrain Agent Swarm Orchestrator",
        "version": "2.0",
        "model": DEFAULT_MODEL,
        "tools": ["web_search", "fetch_url", "spawn_agent"],
        "endpoints": {
            "chat": "POST /v1/chat/completions",
            "models": "GET /v1/models",
            "health": "GET /health",
            "handshake": "POST /v1/handshake",
        },
        "config": {
            "max_parallel_agents": MAX_PARALLEL_AGENTS,
            "max_concurrent_vllm": MAX_CONCURRENT_VLLM,
            "agent_timeout": AGENT_TIMEOUT,
        },
    }


@app.get("/health")
async def health():
    try:
        resp = await http_client.get(f"{VLLM_BASE_URL}/health")
        vllm_ok = resp.status_code == 200
    except Exception:
        vllm_ok = False
    return {"status": "ok" if vllm_ok else "degraded", "vllm": vllm_ok}


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

    log.info("Chat request: user=%s, model=%s, stream=%s, msgs=%d",
             user, model, stream, len(messages))

    if stream:
        return StreamingResponse(
            orchestrate_stream(messages, max_tokens, temperature, model, session_id),
            media_type="text/event-stream",
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


# ── Static Files & SPA ───────────────────────────────────────────────────────

STATIC_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'thotbrain-dist')

if os.path.isdir(os.path.join(STATIC_DIR, 'assets')):
    app.mount('/assets', StaticFiles(directory=os.path.join(STATIC_DIR, 'assets')), name='static-assets')
    log.info('Mounted ThotBrain React UI from %s', STATIC_DIR)

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


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8081)
