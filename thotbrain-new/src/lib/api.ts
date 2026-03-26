// ── ThotBrain API Client v5 ──
// Direct chunk-level parsing: each SSE chunk is parsed individually for control patterns.
// No dedup Set needed — each chunk is processed exactly once.

const ORCHESTRATOR = import.meta.env.VITE_API_BASE || '';
const API_KEY = 'no-key';
const MODEL = 'kimi2.5';

export async function checkHealth(): Promise<{ status: string; vllm: boolean }> {
  const res = await fetch(`${ORCHESTRATOR}/health`);
  return res.json();
}

export interface ChatMsg { role: 'user' | 'assistant' | 'system'; content: string; }
export interface AgentActivity { agent: string; type: string; detail: string; timestamp: number; }
export interface AgentReport { agent: string; content: string; }

export interface StreamCallbacks {
  onThinking?: (text: string) => void;
  onDelta?: (text: string) => void;
  onActivity?: (activity: AgentActivity) => void;
  onAgentReport?: (report: AgentReport) => void;
  onSwarmStart?: (count: number, agents: Array<{ name: string; task: string }>, videoPrompts?: string[]) => void;
  onSwarmComplete?: (count: number) => void;
  onCoverImage?: (imageBase64: string) => void;
  onSynthesisStart?: () => void;
  onSynthesisComplete?: () => void;
  onJSXBlock?: (code: string) => void;
  onPresentationStart?: () => void;
  onComplete?: (fullText: string) => void;
  onError?: (error: string) => void;
}

// ── Control pattern stripping (for final clean text) ──
const CONTROL_PATTERNS = [
  /\[ACTIVITY:[^\]]+\][^\n]*/g,
  /\[AGENT_REPORT:[^\]]+\]/g,
  /\[\/AGENT_REPORT\]/g,
  /🚀\s*AGENT SWARM[^\n]*/g,
  /\s*`\d+\/\d+`\s+\*\*\w+\*\*\s*[—\-][^\n]*/g,
  /\s*[✅❌]\s*`\d+\/\d+`\s+\*\*\w+\*\*\s+(completed|failed)[^\n]*/g,
  /\*\*[✅❌]?\s*All \d+ agents? completed[^\n]*/g,
  /Synthesizing final answer[^\n]*/g,
  /^\s*[🌐📄]\s+Searching:[^\n]*/gm,
  /^\s*[🌐📄]\s+Fetching:[^\n]*/gm,
  /^\s*✅\s+(Search|Fetch) complete:[^\n]*/gm,
  /^\s*✅\s+(Searched|Fetched):[^\n]*/gm,
  /^---+$/gm,
];

export function stripControlText(text: string): string {
  let clean = text;
  for (const re of CONTROL_PATTERNS) {
    clean = clean.replace(re, '');
  }
  clean = clean.replace(/\[AGENT_REPORT:[^\]]*\][\s\S]*?\[\/AGENT_REPORT\]/g, '');
  clean = clean.replace(/\n{3,}/g, '\n\n');
  return clean.trim();
}

// ── Direct chunk-level control parsing ──
// Each SSE chunk is self-contained from the orchestrator, so we parse it directly.
// This avoids all issues with accumulated-text regex, dedup Sets, and cross-chunk matching.

function parseControlChunk(chunk: string, callbacks: StreamCallbacks, reportBuffer: { agent: string; lines: string[] } | null): typeof reportBuffer {
  // ── [ACTIVITY:Agent:type] emoji detail ──
  const actMatch = chunk.match(/\[ACTIVITY:([^:]+):([^\]]+)\]\s*([^\n]*)/);
  if (actMatch) {
    const act = { agent: actMatch[1], type: actMatch[2], detail: actMatch[3] || '', timestamp: Date.now() };
    console.log('[ThotBrain:activity]', act.agent, act.type, act.detail.slice(0, 60));
    callbacks.onActivity?.(act);
    return reportBuffer;
  }

  // ── [AGENT_REPORT:Name] ... start of report block ──
  const reportStart = chunk.match(/\[AGENT_REPORT:([^\]]+)\]/);
  if (reportStart && !chunk.includes('[/AGENT_REPORT]')) {
    // Report starts, content may span multiple chunks
    const afterTag = chunk.replace(/\[AGENT_REPORT:[^\]]+\]/, '').trim();
    return { agent: reportStart[1], lines: afterTag ? [afterTag] : [] };
  }

  // ── [AGENT_REPORT:Name] ... [/AGENT_REPORT] in single chunk ──
  const fullReport = chunk.match(/\[AGENT_REPORT:([^\]]+)\]([\s\S]*?)\[\/AGENT_REPORT\]/);
  if (fullReport) {
    console.log('[ThotBrain:report]', fullReport[1], fullReport[2].length, 'chars');
    callbacks.onAgentReport?.({ agent: fullReport[1], content: fullReport[2].trim() });
    return null;
  }

  // ── [/AGENT_REPORT] end tag ──
  if (chunk.includes('[/AGENT_REPORT]') && reportBuffer) {
    const before = chunk.split('[/AGENT_REPORT]')[0];
    if (before.trim()) reportBuffer.lines.push(before);
    const content = reportBuffer.lines.join('\n').trim();
    console.log('[ThotBrain:report]', reportBuffer.agent, content.length, 'chars');
    callbacks.onAgentReport?.({ agent: reportBuffer.agent, content });
    return null;
  }

  // ── 🚀 AGENT SWARM — Launching N agents ──
  // The swarm header + agent launch lines often come as ONE big chunk
  const swarmMatch = chunk.match(/AGENT SWARM.*?[Ll]aunching (\d+) agents?/);
  if (swarmMatch) {
    const count = parseInt(swarmMatch[1]);
    const agents: Array<{ name: string; task: string }> = [];
    const launchRe = /`(\d+)\/(\d+)`\s+\*\*([^*]+?)\*\*\s*[—\-]\s*([^\n]+)/g;
    let lm;
    while ((lm = launchRe.exec(chunk)) !== null) {
      agents.push({ name: lm[3], task: lm[4].trim() });
    }
    console.log('[ThotBrain:swarm-start]', count, 'agents:', agents.map(a => a.name).join(', '));
    callbacks.onSwarmStart?.(count, agents);
    // Also emit start activities for each agent
    for (const a of agents) {
      callbacks.onActivity?.({ agent: a.name, type: 'start', detail: a.task, timestamp: Date.now() });
    }
    return reportBuffer;
  }

  // ── ✅ `n/N` **AgentName** completed (Xs) ──
  const doneMatch = chunk.match(/[✅❌]\s*`\d+\/\d+`\s+\*\*([^*]+?)\*\*\s+(completed|failed)\s*\(([0-9.]+)s\)/);
  if (doneMatch) {
    const act = {
      agent: doneMatch[1],
      type: doneMatch[2] === 'completed' ? 'done' : 'failed',
      detail: `${doneMatch[3]}s`,
      timestamp: Date.now(),
    };
    console.log('[ThotBrain:done]', act.agent, act.type, act.detail);
    callbacks.onActivity?.(act);
    return reportBuffer;
  }

  // ── ✅ All N agents completed ──
  const allDone = chunk.match(/All (\d+) agents? completed/);
  if (allDone) {
    console.log('[ThotBrain:swarm-complete]', allDone[1]);
    callbacks.onSwarmComplete?.(parseInt(allDone[1]));
    return reportBuffer;
  }

  // ── 🌐 Searching: *query* ──
  const searchMatch = chunk.match(/[🌐]\s*Searching:\s*\*([^*]+)\*/);
  if (searchMatch) {
    callbacks.onActivity?.({ agent: 'Orchestrator', type: 'search', detail: searchMatch[1], timestamp: Date.now() });
    return reportBuffer;
  }

  // ── 📄 Fetching: *url* ──
  const fetchMatch = chunk.match(/[📄]\s*Fetching:\s*\*([^*]+)\*/);
  if (fetchMatch) {
    callbacks.onActivity?.({ agent: 'Orchestrator', type: 'fetch', detail: fetchMatch[1], timestamp: Date.now() });
    return reportBuffer;
  }

  // ── Accumulate report content if in a report block ──
  if (reportBuffer) {
    reportBuffer.lines.push(chunk);
  }

  return reportBuffer;
}

// ── Main streaming function ──
export function streamChat(
  messages: ChatMsg[],
  callbacks: StreamCallbacks,
  signal?: AbortSignal,
  model?: string,
): void {
  fetch(`${ORCHESTRATOR}/v1/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${API_KEY}`,
    },
    body: JSON.stringify({
      model: model || MODEL,
      messages,
      stream: true,
      max_tokens: 4096,
      temperature: 0.7,
    }),
    signal,
  })
    .then((res) => {
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const reader = res.body?.getReader();
      if (!reader) throw new Error('No response body');

      const decoder = new TextDecoder();
      let buffer = '';
      let rawText = '';
      let inThinking = false;
      let thinkingText = '';
      let reportBuffer: { agent: string; lines: string[] } | null = null;

      let currentEventType = '';  // Track SSE event type

      const processLine = (line: string) => {
        // Track event type from "event: xxx" lines
        if (line.startsWith('event: ')) {
          currentEventType = line.slice(7).trim();
          return;
        }

        if (!line.startsWith('data: ')) return;
        const data = line.slice(6).trim();
        if (!data || data === '[DONE]') return;

        let parsed: any;
        try { parsed = JSON.parse(data); } catch { return; }

        // ── Handle typed SSE events ──
        if (currentEventType) {
          const evType = currentEventType;
          currentEventType = '';  // Reset after consuming

          switch (evType) {
            case 'cover_image':
              if (parsed.image) callbacks.onCoverImage?.(parsed.image);
              return;
            case 'jsx_block':
              if (parsed.code) callbacks.onJSXBlock?.(parsed.code);
              return;
            case 'synthesis_start':
              callbacks.onSynthesisStart?.();
              return;
            case 'synthesis_complete':
              callbacks.onSynthesisComplete?.();
              return;
            case 'presentation_start':
              callbacks.onPresentationStart?.();
              return;
            case 'swarm_start': {
              const agents = parsed.agents?.map((a: any) => ({ name: a.orchName || a.name, task: a.task })) || [];
              const videoPrompts = parsed.video_prompts || [];
              callbacks.onSwarmStart?.(parsed.count || agents.length, agents, videoPrompts);
              for (const a of agents) {
                callbacks.onActivity?.({ agent: a.name, type: 'start', detail: a.task, timestamp: Date.now() });
              }
              return;
            }
            case 'swarm_complete':
              callbacks.onSwarmComplete?.(parsed.count || 0);
              return;
            case 'agent_done':
              callbacks.onActivity?.({ agent: parsed.orchName || parsed.agent, type: 'done', detail: `${parsed.elapsed?.toFixed(1)}s`, timestamp: Date.now() });
              return;
            case 'activity':
              if (parsed.orchName) parsed.agent = parsed.orchName;
              callbacks.onActivity?.(parsed as AgentActivity);
              return;
            case 'agent_report':
              callbacks.onAgentReport?.({ agent: parsed.orchName || parsed.agent, content: parsed.text || '' });
              return;
          }
          // Unknown event type — fall through to normal processing
        }

        // ── Normal chat completion chunk processing ──
        const delta = parsed.choices?.[0]?.delta;
        if (!delta) return;
        const chunk = delta.content || '';
        if (!chunk) return;

        // ── CONTROL DETECTION: parse directly from this individual chunk ──
        const isControl = chunk.includes('[ACTIVITY:') ||
                          chunk.includes('[AGENT_REPORT:') ||
                          chunk.includes('[/AGENT_REPORT]') ||
                          chunk.includes('AGENT SWARM') ||
                          /^🚀/.test(chunk.trim()) ||
                          /^`\d+\/\d+`\s+\*\*/.test(chunk.trim()) ||
                          /^[✅❌]\s*`\d+\/\d+`/.test(chunk.trim()) ||
                          /^\*\*[✅❌]?\s*All \d+ agents?/.test(chunk.trim()) ||
                          /^Synthesizing final/.test(chunk.trim()) ||
                          /^[🌐📄]\s+(Searching|Fetching):/.test(chunk.trim()) ||
                          /^✅\s+(Search|Fetch|Searched|Fetched)/.test(chunk.trim()) ||
                          (reportBuffer !== null);

        if (isControl) {
          rawText += chunk;
          reportBuffer = parseControlChunk(chunk, callbacks, reportBuffer);
          return;
        }

        // Handle <think> tags
        if (chunk.includes('<think>')) {
          inThinking = true;
          const after = chunk.split('<think>')[1];
          if (after) thinkingText += after;
          return;
        }
        if (chunk.includes('</think>')) {
          inThinking = false;
          const before = chunk.split('</think>')[0];
          if (before) thinkingText += before;
          if (thinkingText.trim()) callbacks.onThinking?.(thinkingText.trim());
          const after = chunk.split('</think>')[1];
          if (after) {
            rawText += after;
            callbacks.onDelta?.(after);
          }
          return;
        }
        if (inThinking) {
          thinkingText += chunk;
          return;
        }

        rawText += chunk;
        callbacks.onDelta?.(chunk);
      };

      const pump = (): Promise<void> =>
        reader.read().then(({ done, value }) => {
          if (done) {
            if (buffer) buffer.split('\n').forEach(processLine);
            const cleanText = stripControlText(rawText);
            callbacks.onComplete?.(cleanText);
            return;
          }
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() || '';
          lines.forEach(processLine);
          return pump();
        });

      pump();
    })
    .catch((err) => {
      if (err.name === 'AbortError') return;
      callbacks.onError?.(err.message || 'Connection failed');
    });
}

// ── Standalone API calls ──

export async function generateCover(query: string): Promise<string | null> {
  try {
    const res = await fetch(`${ORCHESTRATOR}/v1/cover`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${API_KEY}` },
      body: JSON.stringify({ query }),
    });
    if (!res.ok) return null;
    const data = await res.json();
    return data.image_base64 || null;
  } catch { return null; }
}

export async function generatePresentation(synthesis: string, query: string): Promise<string | null> {
  try {
    const res = await fetch(`${ORCHESTRATOR}/v1/present`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${API_KEY}` },
      body: JSON.stringify({ synthesis, query }),
    });
    if (!res.ok) return null;
    const data = await res.json();
    return data.jsx || null;
  } catch { return null; }
}

// ── ASR: Speech to Text ──
export async function transcribeAudio(audioBlob: Blob): Promise<string | null> {
  try {
    const formData = new FormData();
    // ASR endpoint expects field name 'file'
    const ext = audioBlob.type.includes('webm') ? 'webm' : 'wav';
    formData.append('file', audioBlob, `recording.${ext}`);
    const res = await fetch(`${ORCHESTRATOR}/asr/transcribe`, {
      method: 'POST',
      body: formData,
    });
    if (!res.ok) {
      console.error('[ASR] Error:', res.status, await res.text());
      return null;
    }
    const data = await res.json();
    console.log('[ASR] Transcribed:', data.text);
    return data.text || null;
  } catch (e) { console.error('[ASR] Failed:', e); return null; }
}

// ── TTS: Text to Speech ──
export async function synthesizeSpeech(text: string, speaker: string = 'serena', language: string = 'spanish'): Promise<string | null> {
  try {
    console.log('[TTS] Synthesizing:', text.slice(0, 60));
    const res = await fetch(`${ORCHESTRATOR}/tts/synthesize`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, speaker, language }),
    });
    if (!res.ok) {
      console.error('[TTS] Error:', res.status);
      return null;
    }
    const data = await res.json();
    console.log('[TTS] Got audio:', (data.audio || '').length, 'chars');
    return data.audio || null;
  } catch (e) { console.error('[TTS] Failed:', e); return null; }
}

// ── Video: Generate contextual clip ──
export async function generateVideoClip(prompt: string): Promise<{ jobId: string } | null> {
  try {
    const res = await fetch(`${ORCHESTRATOR}/video/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt, resolution: '1280x720', num_inference_steps: 8, video_length: 193 }),
    });
    if (!res.ok) return null;
    const data = await res.json();
    return { jobId: data.job_id };
  } catch { return null; }
}

export async function checkVideoStatus(jobId: string): Promise<{ status: string; url?: string }> {
  try {
    const res = await fetch(`${ORCHESTRATOR}/video/status/${jobId}`);
    const data = await res.json();
    if (data.status === 'done' && data.files?.length > 0) {
      const filename = data.files[0].split('/').pop();
      return { status: 'done', url: `/video/videos/${encodeURIComponent(filename)}` };
    }
    return { status: data.status };
  } catch { return { status: 'error' }; }
}


// ── Video Loop: continuous generation ──
export async function startVideoBatch(prompts: string[]): Promise<boolean> {
  try {
    console.log('[Video] Starting batch with', prompts.length, 'prompts');
    const res = await fetch(`${ORCHESTRATOR}/video/batch/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompts, resolution: '512x288', video_length: 49 }),
    });
    console.log('[Video] Batch start:', res.status);
    return res.ok;
  } catch (e) { console.error('[Video] Batch start failed:', e); return false; }
}

export async function stopVideoBatch(): Promise<void> {
  try { await fetch(`${ORCHESTRATOR}/video/batch/stop`, { method: 'POST' }); } catch {}
}

export async function updateVideoPrompts(prompts: string[]): Promise<void> {
  try {
    await fetch(`${ORCHESTRATOR}/video/loop/update_prompts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompts }),
    });
  } catch {}
}

export async function getLatestClip(): Promise<{ url: string; prompt: string } | null> {
  try {
    // First check for final concatenated video
    const finalRes = await fetch(`${ORCHESTRATOR}/video/batch/final`);
    const finalData = await finalRes.json();
    if (finalData.url) {
      const fname = finalData.url.split('/').pop() || '';
      return { url: `/video/videos/${encodeURIComponent(fname)}`, prompt: 'final' };
    }
    // Otherwise get latest individual clip
    const res = await fetch(`${ORCHESTRATOR}/video/batch/latest`);
    const data = await res.json();
    if (data.url) {
      const fname = data.url.split('/').pop() || '';
      return { url: `/video/videos/${encodeURIComponent(fname)}`, prompt: data.prompt || '' };
    }
    return null;
  } catch { return null; }
}
