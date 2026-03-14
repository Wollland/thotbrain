"""
Kimi K2.5 Agent Swarm Orchestrator
-----------------------------------
Middleware that sits between the frontend (Open WebUI) and vLLM,
orchestrating parallel sub-agent execution when Kimi K2.5 generates
spawn_agent tool calls.

Architecture:
  Open WebUI :3000 → Orchestrator :8080 → vLLM :8000 (H200)
"""

import asyncio
import hashlib
import json
import os
import secrets
import time
import uuid
from typing import AsyncIterator

import httpx
from fastapi import FastAPI, Request, HTTPException, Depends
from fastapi.responses import StreamingResponse, JSONResponse, HTMLResponse, FileResponse
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from pydantic import BaseModel

# --- Config ---
VLLM_BASE_URL = "http://100.64.0.33:8000"
MAX_RECURSION_DEPTH = 3
MAX_PARALLEL_AGENTS = 20
AGENT_TIMEOUT = 120  # seconds per sub-agent
MAX_CONCURRENT_VLLM = 8  # concurrent requests to vLLM (NVLink active, AER enabled)
MODEL_NAME = "kimi2.5"
SERPER_API_KEY = os.environ.get("SERPER_API_KEY", "21d092b6bdc3a8f3382a6ea19ad34cc571cb1c00")
SERPER_URL = "https://google.serper.dev/search"
JINA_API_KEY = os.environ.get("JINA_API_KEY", "jina_e66a7cc87e244d3d9adb4c72a7c9ead9HjjUaBjcawvMIBpcqsIK2P-jYK95")
JINA_READER_URL = "https://r.jina.ai/"

# --- Agent personas from Aeternalmentis mockup ---
AGENT_PERSONAS = [
    {"name": "Iker",    "role": "Data Architect"},
    {"name": "Miren",   "role": "Financial Analyst"},
    {"name": "Asier",   "role": "Pipeline Scientist"},
    {"name": "Ziortza", "role": "Market Strategist"},
    {"name": "Jon",     "role": "Risk Assessor"},
    {"name": "Ana",     "role": "Visual Designer"},
    {"name": "Unai",    "role": "Systems Engineer"},
    {"name": "Leire",   "role": "Research Lead"},
]
_persona_counter = 0

def get_agent_persona(agent_id: str) -> dict:
    """Map an agent_id to a persona name/role from the mockup."""
    global _persona_counter
    persona = AGENT_PERSONAS[_persona_counter % len(AGENT_PERSONAS)]
    _persona_counter += 1
    return {"id": agent_id, "display_name": persona["name"], "role": persona["role"]}

# --- API Keys ---
# Format: {"key_hash": {"name": "...", "created": "..."}}
API_KEYS_FILE = os.path.join(os.path.dirname(__file__), "api_keys.json")

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
    """Generate a new API key and store its hash."""
    key = f"sk-kimi-{secrets.token_hex(24)}"
    keys = load_api_keys()
    keys[hash_key(key)] = {"name": name, "created": time.strftime("%Y-%m-%d %H:%M:%S")}
    save_api_keys(keys)
    return key

security = HTTPBearer(auto_error=False)

async def verify_api_key(credentials: HTTPAuthorizationCredentials = Depends(security)):
    """Verify API key from Authorization header."""
    if credentials is None:
        raise HTTPException(status_code=401, detail="Missing API key. Use: Authorization: Bearer sk-kimi-...")
    key = credentials.credentials
    if key == "no-key":
        # Allow Open WebUI internal access without key
        return "open-webui"
    keys = load_api_keys()
    h = hash_key(key)
    if h not in keys:
        raise HTTPException(status_code=403, detail="Invalid API key")
    return keys[h]["name"]

# --- Tools that Kimi K2.5 can use for Agent Swarm ---
SWARM_TOOLS = [
    {
        "type": "function",
        "function": {
            "name": "spawn_agent",
            "description": "Spawn a sub-agent to research or work on a specific subtask in parallel. Each agent works independently and returns its findings.",
            "parameters": {
                "type": "object",
                "properties": {
                    "task": {
                        "type": "string",
                        "description": "Detailed description of what this sub-agent should research or accomplish"
                    },
                    "agent_id": {
                        "type": "string",
                        "description": "A descriptive identifier for this agent (e.g., 'hardware_researcher')"
                    }
                },
                "required": ["task", "agent_id"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "web_search",
            "description": "Search the web for current information on a topic. Returns titles, snippets and URLs from Google.",
            "parameters": {
                "type": "object",
                "properties": {
                    "query": {
                        "type": "string",
                        "description": "The search query"
                    }
                },
                "required": ["query"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "fetch_url",
            "description": "Fetch and read the full content of a web page URL. Returns the page content as clean markdown text. Use this after web_search to read full articles, documentation, or any web page.",
            "parameters": {
                "type": "object",
                "properties": {
                    "url": {
                        "type": "string",
                        "description": "The full URL to fetch (e.g. https://example.com/article)"
                    }
                },
                "required": ["url"]
            }
        }
    }
]

from fastapi.middleware.cors import CORSMiddleware

app = FastAPI(title="Kimi K2.5 Agent Swarm Orchestrator")

# Allow CORS for UI access from any origin
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
vllm_semaphore = asyncio.Semaphore(MAX_CONCURRENT_VLLM)


async def serper_search(query: str, num_results: int = 8) -> str:
    """Search Google via Serper API and return formatted results."""
    payload = {"q": query, "num": num_results}
    headers = {"X-API-KEY": SERPER_API_KEY, "Content-Type": "application/json"}
    try:
        async with httpx.AsyncClient(timeout=15) as client:
            resp = await client.post(SERPER_URL, json=payload, headers=headers)
            data = resp.json()
        lines = []
        for i, item in enumerate(data.get("organic", []), 1):
            title = item.get("title", "")
            snippet = item.get("snippet", "")
            link = item.get("link", "")
            lines.append(f"{i}. **{title}**\n   {snippet}\n   URL: {link}")
        if data.get("knowledgeGraph"):
            kg = data["knowledgeGraph"]
            lines.insert(0, f"**{kg.get('title', '')}**: {kg.get('description', '')}")
        return "\n\n".join(lines) if lines else "No results found."
    except Exception as e:
        return f"Search error: {str(e)}"


async def jina_fetch(url: str, max_chars: int = 8000) -> str:
    """Fetch a URL via Jina Reader API and return clean markdown text."""
    headers = {
        "Authorization": f"Bearer {JINA_API_KEY}",
        "Accept": "text/markdown",
        "X-No-Cache": "true",
    }
    try:
        async with httpx.AsyncClient(timeout=30) as client:
            resp = await client.get(f"{JINA_READER_URL}{url}", headers=headers)
            if resp.status_code == 200:
                text = resp.text[:max_chars]
                if len(resp.text) > max_chars:
                    text += f"\n\n[... truncated, {len(resp.text)} chars total]"
                return text
            else:
                return f"Fetch error: HTTP {resp.status_code}"
    except Exception as e:
        return f"Fetch error: {str(e)}"


async def call_vllm(
    messages: list,
    tools: list | None = None,
    max_tokens: int = 4096,
    temperature: float = 0.7,
    stream: bool = False,
) -> dict | AsyncIterator:
    """Make a request to the vLLM API. Uses semaphore to limit concurrent requests."""
    payload = {
        "model": MODEL_NAME,
        "messages": messages,
        "max_tokens": max_tokens,
        "temperature": temperature,
        "stream": stream,
    }
    if tools:
        payload["tools"] = tools
        payload["tool_choice"] = "auto"

    async with vllm_semaphore:
        async with httpx.AsyncClient(timeout=AGENT_TIMEOUT) as client:
            if stream:
                return client.stream(
                    "POST",
                    f"{VLLM_BASE_URL}/v1/chat/completions",
                    json=payload,
                    headers={"Content-Type": "application/json"},
                )
            else:
                resp = await client.post(
                    f"{VLLM_BASE_URL}/v1/chat/completions",
                    json=payload,
                    headers={"Content-Type": "application/json"},
                )
                return resp.json()


async def execute_sub_agent(
    agent_id: str, task: str, depth: int,
    activity_queue: asyncio.Queue | None = None,
) -> tuple[str, str, float]:
    """Execute a sub-agent with real-time activity reporting via queue."""
    t0 = time.time()

    async def report(event_type: str, detail: str = ""):
        if activity_queue:
            await activity_queue.put({"agent": agent_id, "type": event_type, "detail": detail, "t": time.time() - t0})

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
    result = await call_vllm(messages, tools=tools, max_tokens=4096, temperature=0.5)

    choice = result.get("choices", [{}])[0]
    message = choice.get("message", {})

    if choice.get("finish_reason") == "tool_calls" and message.get("tool_calls"):
        # Report each tool call in real-time
        activity_lines = []
        for tc in message.get("tool_calls", []):
            func = tc.get("function", {})
            name = func.get("name", "")
            try:
                args = json.loads(func.get("arguments", "{}"))
            except json.JSONDecodeError:
                args = {}
            if name == "web_search":
                q = args.get("query", "")
                await report("search", q)
                activity_lines.append(f"🔍 Search: {q}")
            elif name == "fetch_url":
                u = args.get("url", "")[:100]
                await report("fetch", u)
                activity_lines.append(f"📄 Fetch: {u}")
            elif name == "spawn_agent":
                a = args.get("agent_id", "")
                await report("spawn", f"{a} — {args.get('task', '')[:80]}")
                activity_lines.append(f"🤖 Spawn: {a}")

        await report("executing_tools", f"{len(message['tool_calls'])} tools")

        # Execute tools with activity reporting for sub-agent searches
        tool_results = await handle_tool_calls_with_activity(
            message["tool_calls"], depth + 1, agent_id, activity_queue
        )

        # Capture source snippets
        sources = []
        for tr in tool_results:
            c = tr.get("content", "")
            sources.append(c[:800])

        await report("synthesizing", "Processing results and forming conclusions...")

        messages.append(message)
        for tr in tool_results:
            messages.append(tr)
        final = await call_vllm(messages, max_tokens=4096, temperature=0.5)
        final_choice = final.get("choices", [{}])[0]
        final_msg = final_choice.get("message", {})

        reasoning = final_msg.get("reasoning") or ""
        if reasoning:
            # Report first 200 chars of reasoning
            await report("reasoning", reasoning[:200])

        content = final_msg.get("content") or ""
        if content:
            await report("conclusion", content[:200])

        # Build verbose report
        text = ""
        if activity_lines:
            text += "ACTIONS:\n" + "\n".join(activity_lines) + "\n\n"
        if sources:
            text += "SOURCES:\n" + "\n---\n".join(sources) + "\n\n"
        if reasoning:
            text += "REASONING:\n" + reasoning + "\n\n"
        text += "CONCLUSION:\n" + content
    else:
        reasoning = message.get("reasoning") or ""
        content_text = message.get("content") or ""
        if reasoning:
            await report("reasoning", reasoning[:200])
        if content_text:
            await report("conclusion", content_text[:200])
        text = ""
        if reasoning:
            text += "REASONING:\n" + reasoning + "\n\n"
        text += "CONCLUSION:\n" + content_text

    await report("done", f"{time.time() - t0:.1f}s")
    return agent_id, text, time.time() - t0


async def handle_tool_calls_with_activity(
    tool_calls: list, depth: int, parent_agent: str,
    activity_queue: asyncio.Queue | None = None,
) -> list:
    """Process tool calls for sub-agents, reporting activity to the queue."""
    spawn_tasks, search_tasks, fetch_tasks = parse_tool_calls(tool_calls)
    results = []

    async def do_search(call_id, query):
        if activity_queue:
            await activity_queue.put({"agent": parent_agent, "type": "searching", "detail": query, "t": 0})
        r = await serper_search(query)
        if activity_queue:
            await activity_queue.put({"agent": parent_agent, "type": "search_done", "detail": f"{query} ({len(r)} chars)", "t": 0})
        return {"role": "tool", "tool_call_id": call_id, "content": f"Search results for '{query}':\n\n{r}"}

    async def do_fetch(call_id, url):
        if activity_queue:
            await activity_queue.put({"agent": parent_agent, "type": "fetching", "detail": url[:80], "t": 0})
        r = await jina_fetch(url)
        if activity_queue:
            await activity_queue.put({"agent": parent_agent, "type": "fetch_done", "detail": f"{url[:60]} ({len(r)} chars)", "t": 0})
        return {"role": "tool", "tool_call_id": call_id, "content": f"Content from {url}:\n\n{r}"}

    io_coros = [do_search(cid, q) for cid, q in search_tasks] + [do_fetch(cid, u) for cid, u in fetch_tasks]
    if io_coros:
        io_results = await asyncio.gather(*io_coros, return_exceptions=True)
        for r in io_results:
            if isinstance(r, Exception):
                results.append({"role": "tool", "tool_call_id": "error", "content": f"Error: {str(r)}"})
            else:
                results.append(r)

    if spawn_tasks:
        limited = spawn_tasks[:MAX_PARALLEL_AGENTS]
        coros = [execute_sub_agent(aid, task, depth, activity_queue) for _, aid, task in limited]
        outcomes = await asyncio.gather(*coros, return_exceptions=True)
        for (call_id, agent_id, _), outcome in zip(limited, outcomes):
            if isinstance(outcome, Exception):
                content = f"Agent '{agent_id}' failed: {str(outcome)}"
            else:
                _, text, elapsed = outcome
                content = f"=== Report from agent '{agent_id}' ({elapsed:.1f}s) ===\n{text}"
            results.append({"role": "tool", "tool_call_id": call_id, "content": content})

    return results


def _make_chunk(content: str) -> str:
    """Create an SSE chunk with content."""
    chunk = {
        "id": f"chatcmpl-{uuid.uuid4().hex[:12]}",
        "object": "chat.completion.chunk",
        "created": int(time.time()),
        "model": MODEL_NAME,
        "choices": [{"index": 0, "delta": {"content": content}, "finish_reason": None}],
    }
    return f"data: {json.dumps(chunk)}\n\n"


def parse_tool_calls(tool_calls: list) -> tuple[list, list, list]:
    """Parse tool calls into spawn_tasks, search_tasks, and fetch_tasks."""
    spawn_tasks = []
    search_tasks = []
    fetch_tasks = []
    for tc in tool_calls:
        func = tc.get("function", {})
        name = func.get("name", "")
        try:
            args = json.loads(func.get("arguments", "{}"))
        except json.JSONDecodeError:
            args = {}
        if name == "spawn_agent":
            agent_id = args.get("agent_id", f"agent_{len(spawn_tasks)}")
            task = args.get("task", "")
            spawn_tasks.append((tc["id"], agent_id, task))
        elif name == "web_search":
            search_tasks.append((tc["id"], args.get("query", "")))
        elif name == "fetch_url":
            fetch_tasks.append((tc["id"], args.get("url", "")))
    return spawn_tasks, search_tasks, fetch_tasks


async def handle_tool_calls(tool_calls: list, depth: int) -> list:
    """Process tool calls (non-streaming version for sub-agents)."""
    spawn_tasks, search_tasks, fetch_tasks = parse_tool_calls(tool_calls)
    results = []

    # Execute searches and fetches in parallel
    async def do_search(call_id, query):
        r = await serper_search(query)
        return {"role": "tool", "tool_call_id": call_id, "content": f"Search results for '{query}':\n\n{r}"}

    async def do_fetch(call_id, url):
        r = await jina_fetch(url)
        return {"role": "tool", "tool_call_id": call_id, "content": f"Content from {url}:\n\n{r}"}

    io_coros = [do_search(cid, q) for cid, q in search_tasks] + [do_fetch(cid, u) for cid, u in fetch_tasks]
    if io_coros:
        io_results = await asyncio.gather(*io_coros, return_exceptions=True)
        for r in io_results:
            if isinstance(r, Exception):
                results.append({"role": "tool", "tool_call_id": "error", "content": f"Error: {str(r)}"})
            else:
                results.append(r)

    if spawn_tasks:
        limited = spawn_tasks[:MAX_PARALLEL_AGENTS]
        coros = [execute_sub_agent(aid, task, depth, None) for _, aid, task in limited]
        outcomes = await asyncio.gather(*coros, return_exceptions=True)
        for (call_id, agent_id, _), outcome in zip(limited, outcomes):
            if isinstance(outcome, Exception):
                content = f"Agent '{agent_id}' failed: {str(outcome)}"
            else:
                _, text, elapsed = outcome
                content = f"=== Report from agent '{agent_id}' ({elapsed:.1f}s) ===\n{text}"
            results.append({"role": "tool", "tool_call_id": call_id, "content": content})

    return results


async def handle_tool_calls_streaming(tool_calls: list, depth: int) -> AsyncIterator[str | dict]:
    """Process tool calls with streaming status updates. Yields SSE chunks and tool results."""
    spawn_tasks, search_tasks, fetch_tasks = parse_tool_calls(tool_calls)
    tool_results = []

    # Handle web searches
    for call_id, query in search_tasks:
        yield _make_chunk(f"  🌐 Searching: *{query}*\n")
        search_result = await serper_search(query)
        tool_results.append({"role": "tool", "tool_call_id": call_id, "content": f"Search results for '{query}':\n\n{search_result}"})
        yield _make_chunk(f"  ✅ Search complete: *{query}*\n")

    # Handle URL fetches
    for call_id, url in fetch_tasks:
        short_url = url[:60] + "..." if len(url) > 60 else url
        yield _make_chunk(f"  📄 Fetching: *{short_url}*\n")
        page_content = await jina_fetch(url)
        tool_results.append({"role": "tool", "tool_call_id": call_id, "content": f"Content from {url}:\n\n{page_content}"})
        yield _make_chunk(f"  ✅ Fetched: *{short_url}*\n")

    # Handle agent spawning with REAL-TIME activity streaming
    if spawn_tasks:
        global _persona_counter
        _persona_counter = 0  # Reset per request
        limited = spawn_tasks[:MAX_PARALLEL_AGENTS]
        n = len(limited)

        # Map agent_ids to display names
        agent_display = {}
        for _, agent_id, _ in limited:
            persona = get_agent_persona(agent_id)
            agent_display[agent_id] = persona

        # Show launch panel with persona names
        header = f"\n---\n**🚀 AGENT SWARM** — Launching {n} agents\n\n"
        for i, (_, agent_id, task) in enumerate(limited, 1):
            short_task = task[:100] + "..." if len(task) > 100 else task
            display = agent_display[agent_id]
            header += f"  `{i}/{n}` **{display['display_name']}** — {short_task}\n"
        header += "\n---\n\n"
        yield _make_chunk(header)

        # Activity queue for real-time agent reporting
        activity_queue = asyncio.Queue()

        # Launch all agents with DISPLAY NAMES as agent_id
        tasks_with_meta = []
        for call_id, agent_id, task in limited:
            display_name = agent_display[agent_id]["display_name"]
            coro = execute_sub_agent(display_name, task, depth, activity_queue)
            t = asyncio.ensure_future(coro)
            t._agent_meta = (call_id, display_name)
            tasks_with_meta.append(t)

        completed = 0
        pending = set(tasks_with_meta)

        # Event icons for activity types
        activity_icons = {
            "start": "🚀", "thinking": "🧠", "search": "🔍", "fetch": "📄",
            "searching": "🔍", "search_done": "✅", "fetching": "📄", "fetch_done": "✅",
            "executing_tools": "⚙️", "synthesizing": "🧬", "reasoning": "💭",
            "conclusion": "📋", "spawn": "🤖", "done": "✅",
        }

        while pending:
            # Drain all queued activity into the stream
            while not activity_queue.empty():
                try:
                    act = activity_queue.get_nowait()
                    icon = activity_icons.get(act["type"], "📌")
                    agent = act["agent"]
                    detail = act.get("detail", "")
                    # Stream as parseable activity line
                    yield _make_chunk(f"[ACTIVITY:{agent}:{act['type']}] {icon} {detail}\n")
                except asyncio.QueueEmpty:
                    break

            # Wait for agent completion OR timeout to check queue again
            done_set, pending = await asyncio.wait(pending, return_when=asyncio.FIRST_COMPLETED, timeout=0.5)

            for future in done_set:
                call_id, agent_id = future._agent_meta
                completed += 1
                try:
                    _, text, elapsed = future.result()
                    yield _make_chunk(f"  ✅ `{completed}/{n}` **{agent_id}** completed ({elapsed:.1f}s)\n")
                    yield _make_chunk(f"\n[AGENT_REPORT:{agent_id}]\n{text}\n[/AGENT_REPORT]\n\n")
                    tool_results.append({
                        "role": "tool",
                        "tool_call_id": call_id,
                        "content": f"=== Report from agent '{agent_id}' ({elapsed:.1f}s) ===\n{text}",
                    })
                except Exception as e:
                    yield _make_chunk(f"  ❌ `{completed}/{n}` **{agent_id}** failed: {str(e)}\n")
                    tool_results.append({
                        "role": "tool",
                        "tool_call_id": call_id,
                        "content": f"Agent '{agent_id}' failed: {str(e)}",
                    })

        # Final drain of activity queue
        while not activity_queue.empty():
            try:
                act = activity_queue.get_nowait()
                icon = activity_icons.get(act["type"], "📌")
                yield _make_chunk(f"[ACTIVITY:{act['agent']}:{act['type']}] {icon} {act.get('detail', '')}\n")
            except asyncio.QueueEmpty:
                break

        yield _make_chunk(f"\n**✅ All {n} agents completed.** Synthesizing final answer...\n\n---\n\n")

    # Yield the collected tool results as a special marker
    yield {"__tool_results__": tool_results}


async def orchestrate(messages: list, max_tokens: int, temperature: float) -> dict:
    """Main orchestration loop: send to Kimi, handle swarm, synthesize."""
    # Add swarm tools to the request
    result = await call_vllm(messages, tools=SWARM_TOOLS, max_tokens=max_tokens, temperature=temperature)

    choice = result.get("choices", [{}])[0]
    message = choice.get("message", {})

    # If Kimi wants to spawn agents
    if choice.get("finish_reason") == "tool_calls" and message.get("tool_calls"):
        # Execute all tool calls (sub-agents in parallel)
        tool_results = await handle_tool_calls(message["tool_calls"], depth=1)

        # Collect reports and present as conversation (no tools for synthesis)
        reports_text = ""
        for tr in tool_results:
            reports_text += tr["content"] + "\n\n"

        extended_messages = [
            {"role": "system", "content": "You are a research synthesis assistant. You receive reports from specialized research agents and must synthesize them into a comprehensive, well-structured final answer. Write the answer directly — do NOT call any functions or tools."},
            messages[-1],  # Original user question
            {"role": "assistant", "content": "I dispatched specialized research agents to investigate this. Here are their completed reports:"},
            {"role": "user", "content": f"AGENT REPORTS:\n\n{reports_text}\n\nBased on these reports, provide a comprehensive synthesized answer to my original question."},
        ]

        # Let Kimi synthesize the final response (no tools)
        final = await call_vllm(extended_messages, max_tokens=max_tokens, temperature=temperature)
        return final

    return result


async def orchestrate_stream(messages: list, max_tokens: int, temperature: float) -> AsyncIterator[str]:
    """Orchestrate with streaming: stream directly, buffer only if tool calls detected."""
    payload = {
        "model": MODEL_NAME,
        "messages": messages,
        "max_tokens": max_tokens,
        "temperature": temperature,
        "stream": True,
        "tools": SWARM_TOOLS,
        "tool_choice": "auto",
    }

    buffered_chunks = []
    tool_calls_detected = False
    assembled_tool_calls = {}  # index -> {id, function: {name, arguments}}
    reasoning_started = False
    content_started = False

    async with httpx.AsyncClient(timeout=300) as client:
        async with client.stream(
            "POST",
            f"{VLLM_BASE_URL}/v1/chat/completions",
            json=payload,
            headers={"Content-Type": "application/json"},
        ) as resp:
            async for line in resp.aiter_lines():
                if not line.startswith("data: "):
                    continue
                raw = line[6:]
                if raw.strip() == "[DONE]":
                    if not tool_calls_detected:
                        # Close thinking block if it was open
                        if reasoning_started and not content_started:
                            yield _make_chunk("\n</think>\n\n")
                        yield f"{line}\n\n"
                    break

                try:
                    chunk = json.loads(raw)
                except json.JSONDecodeError:
                    if not tool_calls_detected:
                        yield f"{line}\n\n"
                    continue

                delta = chunk.get("choices", [{}])[0].get("delta", {})

                # Check if this chunk contains tool call data
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
                    # We're in tool-call mode, skip content chunks
                    continue

                # ── Convert reasoning deltas to content for Open WebUI compatibility ──
                # Kimi K2.5 sends reasoning first, then content. Open WebUI only reads
                # delta.content, so we convert reasoning → content wrapped in <think> tags.
                if delta.get("reasoning"):
                    if not reasoning_started:
                        reasoning_started = True
                        yield _make_chunk("<think>\n")
                    # Send reasoning text as content chunk
                    yield _make_chunk(delta["reasoning"])
                    continue

                if delta.get("content"):
                    # Close thinking block when content starts
                    if reasoning_started and not content_started:
                        content_started = True
                        yield _make_chunk("\n</think>\n\n")

                    # No tool calls so far — stream content directly
                    if buffered_chunks:
                        for bc in buffered_chunks:
                            yield bc
                        buffered_chunks.clear()

                    yield _make_chunk(delta["content"])
                    continue

                # Pass through other chunks (e.g., role assignment)
                if not tool_calls_detected:
                    if buffered_chunks:
                        for bc in buffered_chunks:
                            yield bc
                        buffered_chunks.clear()
                    yield f"{line}\n\n"

    # If tool calls were detected, execute them with live status and stream synthesis
    if tool_calls_detected and assembled_tool_calls:
        tool_calls_list = [assembled_tool_calls[i] for i in sorted(assembled_tool_calls.keys())]
        assistant_msg = {"role": "assistant", "content": None, "tool_calls": tool_calls_list}

        # Stream agent progress in real-time
        tool_results = []
        async for item in handle_tool_calls_streaming(tool_calls_list, depth=1):
            if isinstance(item, dict) and "__tool_results__" in item:
                tool_results = item["__tool_results__"]
            else:
                yield item  # SSE status chunk

        # Stream the final synthesis — present reports as conversation, no tools
        # Collect all agent reports into a single text block
        reports_text = ""
        for tr in tool_results:
            reports_text += tr["content"] + "\n\n"

        extended_messages = [
            {"role": "system", "content": "You are a research synthesis assistant. You receive reports from specialized research agents and must synthesize them into a comprehensive, well-structured final answer. Write the answer directly — do NOT call any functions or tools."},
            messages[-1],  # Original user question
            {"role": "assistant", "content": "I dispatched specialized research agents to investigate this. Here are their completed reports:"},
            {"role": "user", "content": f"AGENT REPORTS:\n\n{reports_text}\n\nBased on these reports, provide a comprehensive synthesized answer to my original question."},
        ]
        synth_payload = {
            "model": MODEL_NAME,
            "messages": extended_messages,
            "max_tokens": max_tokens,
            "temperature": temperature,
            "stream": True,
        }

        synth_reasoning_started = False
        synth_content_started = False

        async with httpx.AsyncClient(timeout=300) as client:
            async with client.stream(
                "POST",
                f"{VLLM_BASE_URL}/v1/chat/completions",
                json=synth_payload,
                headers={"Content-Type": "application/json"},
            ) as resp:
                async for line in resp.aiter_lines():
                    if not line.startswith("data: "):
                        continue
                    raw = line[6:]
                    if raw.strip() == "[DONE]":
                        if synth_reasoning_started and not synth_content_started:
                            yield _make_chunk("\n</think>\n\n")
                        yield f"{line}\n\n"
                        break
                    try:
                        chunk = json.loads(raw)
                    except json.JSONDecodeError:
                        yield f"{line}\n\n"
                        continue
                    delta = chunk.get("choices", [{}])[0].get("delta", {})
                    # Convert reasoning to content for synthesis too
                    if delta.get("reasoning"):
                        if not synth_reasoning_started:
                            synth_reasoning_started = True
                            yield _make_chunk("<think>\n")
                        yield _make_chunk(delta["reasoning"])
                    elif delta.get("content"):
                        if synth_reasoning_started and not synth_content_started:
                            synth_content_started = True
                            yield _make_chunk("\n</think>\n\n")
                        yield _make_chunk(delta["content"])
                    else:
                        yield f"{line}\n\n"


# --- API Endpoints (OpenAI-compatible) ---

@app.get("/ui")
async def ui_page():
    """Serve the Agent Swarm UI."""
    ui_path = os.path.join(os.path.dirname(__file__), "ui", "index.html")
    if os.path.exists(ui_path):
        return FileResponse(ui_path, media_type="text/html")
    return HTMLResponse("<h1>UI not found</h1><p>Place index.html in ./ui/</p>", status_code=404)


@app.get("/")
async def root():
    """Landing page."""
    return {
        "service": "Kimi K2.5 Agent Swarm Orchestrator",
        "model": MODEL_NAME,
        "tools": ["web_search", "fetch_url", "spawn_agent"],
        "endpoints": {
            "chat": "POST /v1/chat/completions",
            "models": "GET /v1/models",
            "health": "GET /health",
        },
        "config": {
            "max_parallel_agents": MAX_PARALLEL_AGENTS,
            "max_concurrent_vllm": MAX_CONCURRENT_VLLM,
            "agent_timeout": AGENT_TIMEOUT,
        }
    }

@app.get("/v1/models")
async def list_models(user: str = Depends(verify_api_key)):
    """Proxy model list from vLLM."""
    async with httpx.AsyncClient(timeout=10) as client:
        resp = await client.get(f"{VLLM_BASE_URL}/v1/models")
        return resp.json()


@app.post("/v1/chat/completions")
async def chat_completions(request: Request, user: str = Depends(verify_api_key)):
    """OpenAI-compatible chat completions with Agent Swarm orchestration."""
    body = await request.json()
    messages = body.get("messages", [])
    max_tokens = body.get("max_tokens", 4096)
    temperature = body.get("temperature", 0.7)
    stream = body.get("stream", False)

    if stream:
        return StreamingResponse(
            orchestrate_stream(messages, max_tokens, temperature),
            media_type="text/event-stream",
        )
    else:
        result = await orchestrate(messages, max_tokens, temperature)
        return JSONResponse(result)


@app.get("/health")
async def health():
    """Health check (no auth required)."""
    try:
        async with httpx.AsyncClient(timeout=5) as client:
            resp = await client.get(f"{VLLM_BASE_URL}/health")
            vllm_ok = resp.status_code == 200
    except Exception:
        vllm_ok = False
    return {"status": "ok" if vllm_ok else "degraded", "vllm": vllm_ok}


@app.post("/admin/create-key")
async def create_key(request: Request):
    """Create a new API key. Only accessible from localhost."""
    client_ip = request.client.host
    if client_ip not in ("127.0.0.1", "::1", "localhost"):
        raise HTTPException(status_code=403, detail="Admin endpoints only from localhost")
    body = await request.json()
    name = body.get("name", "unnamed")
    key = generate_api_key(name)
    return {"api_key": key, "name": name, "message": "Save this key - it cannot be retrieved later"}


@app.get("/admin/list-keys")
async def list_keys(request: Request):
    """List all API keys (names only, not the keys themselves)."""
    client_ip = request.client.host
    if client_ip not in ("127.0.0.1", "::1", "localhost"):
        raise HTTPException(status_code=403, detail="Admin endpoints only from localhost")
    keys = load_api_keys()
    return [{"name": v["name"], "created": v["created"]} for v in keys.values()]


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8081)
