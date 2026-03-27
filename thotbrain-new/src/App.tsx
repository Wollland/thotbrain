import { useState, useRef, useEffect, useCallback, memo } from 'react';
import {
  Send, User, Settings, Plus, Sparkles, Copy, Cpu, Network,
  ChevronRight, CheckCircle2, Brain, Loader2, Square,
  Paperclip, X, FileText, ChevronDown, Mic, MicOff,
  Trash2, Play, Code, ChevronUp,
  Database, Mail, Activity, Layers, Terminal, Plug,
  Video, Volume2, VolumeX,
} from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { streamChat, checkHealth, stripControlText, transcribeAudio, synthesizeSpeech, generateVideoClip, checkVideoStatus, startVideoBatch, stopVideoBatch, updateVideoPrompts, getLatestClip } from './lib/api';
import type { ChatMsg, AgentActivity, AgentReport } from './lib/api';
import { SwarmActivityPanel } from './components/SwarmActivityPanel';
import { MCPConnectorsModal } from './components/MCPConnectorsModal';

// ─── Constants ───
const RENDER_THROTTLE_MS = 80;
const SESSIONS_KEY = 'thotbrain_sessions';
const ACTIVE_KEY = 'thotbrain_active';

const MODELS = [
  { id: 'kimi2.5', name: 'Kimi K2.5', desc: '8×H200 NVL · 32K ctx', active: true },
  { id: 'qwen3-235b', name: 'Qwen3 235B', desc: 'MoE · Próximamente', active: false },
  { id: 'deepseek-r1', name: 'DeepSeek R1', desc: '671B · Próximamente', active: false },
];

// ─── Types ───
interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  thinking?: string;
  timestamp: Date;
}

interface SavedSession {
  id: string;
  title: string;
  messages: Array<{ id: string; role: 'user' | 'assistant'; content: string; thinking?: string; timestamp: string }>;
  createdAt: string;
  updatedAt: string;
}

// ─── Utils ───
function uid(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2);
}

// ─── Session persistence ───
function loadSessions(): SavedSession[] {
  try { return JSON.parse(localStorage.getItem(SESSIONS_KEY) || '[]'); }
  catch { return []; }
}
function saveSessions(s: SavedSession[]) {
  localStorage.setItem(SESSIONS_KEY, JSON.stringify(s));
}
function saveSession(id: string, messages: Message[]) {
  if (messages.length <= 1) return;
  const sessions = loadSessions();
  const idx = sessions.findIndex(s => s.id === id);
  const first = messages.find(m => m.role === 'user');
  const title = first ? first.content.slice(0, 60) + (first.content.length > 60 ? '…' : '') : 'Nueva sesión';
  const session: SavedSession = {
    id, title,
    messages: messages.map(m => ({ id: m.id, role: m.role, content: m.content, thinking: m.thinking, timestamp: m.timestamp.toISOString() })),
    createdAt: idx >= 0 ? sessions[idx].createdAt : new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  if (idx >= 0) sessions[idx] = session; else sessions.unshift(session);
  saveSessions(sessions.slice(0, 50));
  localStorage.setItem(ACTIVE_KEY, id);
}

// ─── Fast streaming Markdown ───
function fastMd(rawText: string): string {
  if (!rawText) return '';
  const text = stripControlText(rawText);
  if (!text) return '';
  return text
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/```(\w*)\n([\s\S]*?)```/g, (_m, lang, code) =>
      `<pre class="code-block" data-lang="${lang}"><code>${code}</code></pre>`)
    .replace(/^### (.+)$/gm, '<h3>$1</h3>')
    .replace(/^## (.+)$/gm, '<h2>$1</h2>')
    .replace(/^# (.+)$/gm, '<h1>$1</h1>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/`([^`\n]+)`/g, '<code class="inline-code">$1</code>')
    .replace(/!\[([^\]]*)\]\(([^)]+)\)/g, '<img src="$2" alt="$1" class="research-img" loading="lazy" />')
    .replace(/\[(.+?)\]\((.+?)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>')
    .replace(/^[-*] (.+)$/gm, '<li>$1</li>')
    .replace(/^\d+\.\s(.+)$/gm, '<li>$1</li>')
    .replace(/^---+$/gm, '<hr/>')
    .replace(/\n{2,}/g, '</p><p>')
    .replace(/\n/g, '<br/>');
}

// ─── React Sandbox ───
// Mirrors the EXACT approach from sandbox.html (which works perfectly):
// 1. Load React/ReactDOM/PropTypes/Babel as static <script> tags
// 2. Load Recharts DYNAMICALLY via createElement("script") + onload
// 3. Wrap JSX in IIFE that returns the component: (function(){CODE\nreturn Presentation;})()
// 4. Capture component via var Comp = eval(transformed)
function ReactSandbox({ code }: { code: string }) {
  const [show, setShow] = useState(true);
  // Escape for safe embedding inside a JS single-quoted string
  const escaped = code
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "\\'")
    .replace(/\n/g, '\\n')
    .replace(/<\/script>/gi, '<\\/script>');
  // Build HTML exactly like the working sandbox.html demo
  const SC = "</' + 'script>";
  let h = '<!DOCTYPE html><html><head><meta charset="UTF-8">';
  h += '<style>*{margin:0;padding:0;box-sizing:border-box}body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;background:#fff;color:#1a1a2e;padding:16px;min-height:100vh}</style>';
  h += '</head><body>';
  h += '<div id="root"><div style="color:#888;padding:40px;text-align:center">Cargando bibliotecas...</div></div>';
  h += '<script crossorigin src="https://cdnjs.cloudflare.com/ajax/libs/react/18.2.0/umd/react.production.min.js"><' + '/script>';
  h += '<script crossorigin src="https://cdnjs.cloudflare.com/ajax/libs/react-dom/18.2.0/umd/react-dom.production.min.js"><' + '/script>';
  h += '<script src="https://cdnjs.cloudflare.com/ajax/libs/prop-types/15.8.1/prop-types.min.js"><' + '/script>';
  h += '<script crossorigin src="https://cdnjs.cloudflare.com/ajax/libs/babel-standalone/7.23.9/babel.min.js"><' + '/script>';
  h += '<script>';
  h += 'var s=document.createElement("script");';
  h += 's.src="https://unpkg.com/recharts@2.12.7/umd/Recharts.js";';
  h += 's.onload=function(){';
  h += '  if(window.Recharts){Object.keys(window.Recharts).forEach(function(k){window[k]=window.Recharts[k]})}';
  h += '  try{';
  h += '    var jsxCode="(function(){" + \'' + escaped + '\' + "\\nreturn typeof Presentation!==\\"undefined\\"?Presentation:typeof App!==\\"undefined\\"?App:typeof Dashboard!==\\"undefined\\"?Dashboard:typeof Component!==\\"undefined\\"?Component:typeof Chart!==\\"undefined\\"?Chart:null;})()";';
  h += '    var transformed=Babel.transform(jsxCode,{presets:["react"]}).code;';
  h += '    var Comp=eval(transformed);';
  h += '    if(Comp){var root=ReactDOM.createRoot(document.getElementById("root"));root.render(React.createElement(Comp));}';
  h += '    else{document.getElementById("root").innerHTML="<div style=\\"padding:20px;color:#666\\">No component found</div>";}';
  h += '  }catch(e){';
  h += '    document.getElementById("root").innerHTML="<div style=\\"color:#e74c3c;padding:20px\\"><h3>Render Error</h3><pre style=\\"white-space:pre-wrap\\">"+e.message+"\\n"+e.stack+"</pre></div>"';
  h += '  }';
  h += '};';
  h += 's.onerror=function(){document.getElementById("root").innerHTML="<div style=\\"color:#e74c3c;padding:20px\\">Failed to load Recharts CDN</div>"};';
  h += 'document.head.appendChild(s);';
  h += '<' + '/script>';
  h += '</body></html>';
  const html = h;
  return (
    <div className="my-3 border border-zinc-200 rounded-xl overflow-hidden shadow-sm">
      <div className="flex items-center justify-between px-3 py-1.5 bg-zinc-50 border-b border-zinc-200">
        <div className="flex items-center gap-2 text-[11px] font-semibold text-zinc-500"><Code className="w-3.5 h-3.5" /><span>Visualizaci&oacute;n Interactiva</span><span className="text-[9px] bg-emerald-100 text-emerald-700 px-1.5 py-0.5 rounded font-bold">Recharts</span></div>
        <button onClick={() => setShow(!show)} className="flex items-center gap-1 px-2 py-1 rounded-md text-[10px] font-bold bg-black text-[#DA7756] hover:bg-zinc-800 transition-colors">
          {show ? <ChevronUp className="w-3 h-3" /> : <Play className="w-3 h-3" />}{show ? 'Ocultar' : 'Preview'}
        </button>
      </div>
      {show && <iframe srcDoc={html} sandbox="allow-scripts allow-same-origin" className="w-full border-0 bg-white" style={{ height: '320px', resize: 'vertical' }} title="React Preview" />}
    </div>
  );
}

// ─── Full Markdown (completed messages) ───
const FullMarkdown = memo(function FullMarkdown({ content }: { content: string }) {
  const parts: Array<{ type: 'md' | 'sandbox'; content: string }> = [];
  const codeBlockRe = /```(jsx|tsx|react)\n([\s\S]*?)```/g;
  let lastIdx = 0;
  let match;
  while ((match = codeBlockRe.exec(content)) !== null) {
    if (match.index > lastIdx) parts.push({ type: 'md', content: content.slice(lastIdx, match.index) });
    parts.push({ type: 'sandbox', content: match[2] });
    lastIdx = match.index + match[0].length;
  }
  if (lastIdx < content.length) parts.push({ type: 'md', content: content.slice(lastIdx) });
  if (parts.length === 0) parts.push({ type: 'md', content });

  return (
    <>
      {parts.map((part, i) =>
        part.type === 'sandbox' ? (
          <ReactSandbox key={i} code={part.content} />
        ) : (
          <ReactMarkdown key={i} remarkPlugins={[remarkGfm]} components={{
            code({ className, children, ...props }) {
              const isBlock = className?.startsWith('language-');
              if (isBlock) return (<div className="my-2"><pre className="bg-zinc-900 text-zinc-100 rounded-lg p-3 overflow-x-auto text-[11px] font-mono leading-relaxed"><code className={className} {...props}>{children}</code></pre></div>);
              return <code className="bg-zinc-100 text-zinc-800 px-1 py-0.5 rounded text-[11px] font-mono" {...props}>{children}</code>;
            },
            p: ({ children }) => <p className="mb-1.5 last:mb-0">{children}</p>,
            ul: ({ children }) => <ul className="list-disc list-inside mb-1.5 space-y-0.5">{children}</ul>,
            ol: ({ children }) => <ol className="list-decimal list-inside mb-1.5 space-y-0.5">{children}</ol>,
            strong: ({ children }) => <strong className="font-semibold">{children}</strong>,
            h1: ({ children }) => <h1 className="text-base font-bold mt-3 mb-1">{children}</h1>,
            h2: ({ children }) => <h2 className="text-sm font-bold mt-2.5 mb-1">{children}</h2>,
            h3: ({ children }) => <h3 className="text-[13px] font-bold mt-2 mb-0.5">{children}</h3>,
            a: ({ href, children }) => <a href={href} target="_blank" rel="noopener noreferrer" className="text-[#DA7756] hover:underline">{children}</a>,
            img: ({ src, alt }) => <img src={src} alt={alt || ''} className='research-img' />,
            blockquote: ({ children }) => <blockquote className="border-l-2 border-[#DA7756]/40 pl-3 italic text-zinc-500 my-1.5">{children}</blockquote>,
            table: ({ children }) => <table className="border-collapse text-[11px] my-2 w-full">{children}</table>,
            th: ({ children }) => <th className="border border-zinc-200 px-2 py-1 bg-zinc-50 text-left font-semibold">{children}</th>,
            td: ({ children }) => <td className="border border-zinc-200 px-2 py-1">{children}</td>,
          }}>{part.content}</ReactMarkdown>
        ),
      )}
    </>
  );
});

// ─── Sidebar nav items ───
const NAV_ITEMS = [
  { icon: Database, label: 'Bases de Datos' },
  { icon: Mail, label: 'Integración Email' },
  { icon: Activity, label: 'Métricas en Vivo' },
  { icon: Layers, label: 'Modelos RAG' },
  { icon: Terminal, label: 'Computer Scripts' },
  { icon: Network, label: 'Agent Swarm', badge: true },
  { icon: Plug, label: 'Conectores MCP', action: 'mcp' },
];

// ─── Welcome message ───
const welcomeMsg: Message = {
  id: 'welcome',
  role: 'assistant',
  content: 'Hola Jorge. Soy ThotBrain. ¿Qué análisis o tarea quieres que el enjambre de agentes realice hoy?',
  timestamp: new Date(),
};

// ─── Main App ───
export default function App() {
  const [sessionId, setSessionId] = useState(() => localStorage.getItem(ACTIVE_KEY) || uid());
  const [messages, setMessages] = useState<Message[]>(() => {
    const id = localStorage.getItem(ACTIVE_KEY);
    if (id) {
      const s = loadSessions().find(s => s.id === id);
      if (s) return s.messages.map(m => ({ ...m, timestamp: new Date(m.timestamp) }));
    }
    return [welcomeMsg];
  });
  const [sessions, setSessions] = useState<SavedSession[]>(loadSessions);
  const [input, setInput] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);
  const [selectedModel, setSelectedModel] = useState('kimi2.5');
  const [showModelMenu, setShowModelMenu] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [attachedFiles, setAttachedFiles] = useState<File[]>([]);
  const [online, setOnline] = useState(true);
  const [isMCPModalOpen, setIsMCPModalOpen] = useState(false);

  // Agent state
  const [activities, setActivities] = useState<AgentActivity[]>([]);
  const [activeAgentNames, setActiveAgentNames] = useState<string[]>([]);
  const [doneAgentNames, setDoneAgentNames] = useState<string[]>([]);

  // Video, TTS, ASR state
  const [agentReports, setAgentReports] = useState<Record<string, string>>({});
  const [isTTSEnabled, setIsTTSEnabled] = useState(false);
  const [currentVideoUrl, setCurrentVideoUrl] = useState<string | null>(null);
  const videoPollingRef = useRef<number | null>(null);
  const lastClipUrlRef = useRef<string>('');
  const [isVideoVisible, setIsVideoVisible] = useState(false);
  const ttsAudioRef = useRef<HTMLAudioElement | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);

  const abortRef = useRef<AbortController | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Streaming content refs
  const streamContentRef = useRef('');
  const streamThinkingRef = useRef('');
  const streamMsgIdRef = useRef('');
  const rafRef = useRef<number>(0);
  const lastRenderRef = useRef(0);

  const flushStreamContent = useCallback(() => {
    const now = Date.now();
    if (now - lastRenderRef.current < RENDER_THROTTLE_MS) {
      if (!rafRef.current) {
        rafRef.current = requestAnimationFrame(() => { rafRef.current = 0; flushStreamContent(); });
      }
      return;
    }
    lastRenderRef.current = now;
    const msgId = streamMsgIdRef.current;
    const content = streamContentRef.current;
    const thinking = streamThinkingRef.current;
    const contentEl = document.getElementById(`stream-content-${msgId}`);
    if (contentEl) contentEl.innerHTML = fastMd(content) + '<span class="cursor-blink"></span>';
    const thinkEl = document.getElementById(`stream-thinking-${msgId}`);
    if (thinkEl && thinking) {
      thinkEl.textContent = thinking.slice(0, 100) + (thinking.length > 100 ? '…' : '');
      thinkEl.parentElement!.style.display = '';
    }
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, []);

  // TTS playback — queues sentences to read aloud
  const ttsQueueRef = useRef<string[]>([]);
  const ttsBusyRef = useRef(false);

  const processTTSQueue = useCallback(async () => {
    if (ttsBusyRef.current || ttsQueueRef.current.length === 0) return;
    ttsBusyRef.current = true;
    const sentence = ttsQueueRef.current.shift()!;
    try {
      const audioB64 = await synthesizeSpeech(sentence, 'serena', 'spanish');
      if (audioB64 && ttsAudioRef.current) {
        const raw = atob(audioB64);
        const arr = new Uint8Array(raw.length);
        for (let i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i);
        const blob = new Blob([arr], { type: 'audio/wav' });
        ttsAudioRef.current.src = URL.createObjectURL(blob);
        ttsAudioRef.current.volume = 0.85;
        await ttsAudioRef.current.play().catch(() => {});
        await new Promise<void>(resolve => {
          ttsAudioRef.current!.onended = () => resolve();
          setTimeout(resolve, 30000);
        });
      }
    } catch {}
    ttsBusyRef.current = false;
    processTTSQueue();
  }, []);

  const playTTS = useCallback((text: string) => {
    if (!isTTSEnabled) return;
    const sentences = text.match(/[^.!?]+[.!?]+/g) || [text];
    for (const s of sentences) {
      const clean = s.trim();
      if (clean.length > 15) ttsQueueRef.current.push(clean);
    }
    processTTSQueue();
  }, [isTTSEnabled, processTTSQueue]);

  // Auto-scroll when messages change or streaming ends
  useEffect(() => {
    if (scrollRef.current) {
      requestAnimationFrame(() => {
        if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
      });
    }
  }, [messages, isStreaming]);

  // Health check
  useEffect(() => {
    const check = () => checkHealth().then(d => setOnline(d.vllm)).catch(() => setOnline(false));
    check();
    const iv = setInterval(check, 30000);
    return () => clearInterval(iv);
  }, []);


  // Save session
  useEffect(() => {
    if (messages.length > 1 || messages[0]?.id !== 'welcome') {
      saveSession(sessionId, messages);
      setSessions(loadSessions());
    }
  }, [messages, sessionId]);

  // Voice (ASR-based)
  const toggleVoice = async () => {
    if (isListening) {
      // Stop recording
      mediaRecorderRef.current?.stop();
      setIsListening(false);
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream, { mimeType: 'audio/webm' });
      audioChunksRef.current = [];
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) audioChunksRef.current.push(e.data);
      };
      recorder.onstop = async () => {
        stream.getTracks().forEach(t => t.stop());
        const blob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
        const text = await transcribeAudio(blob);
        if (text) {
          // Auto-enable TTS when using voice input
          setIsTTSEnabled(true);
          // Set text and auto-send
          setInput(text);
          // Small delay to let state update, then send
          setTimeout(() => {
            const fakeEvent = { preventDefault: () => {} } as React.KeyboardEvent;
            handleSend();
          }, 100);
        }
      };
      mediaRecorderRef.current = recorder;
      recorder.start();
      setIsListening(true);
    } catch {
      alert('No se pudo acceder al micrófono.');
    }
  };

  // Sessions
  const newSession = () => {
    const id = uid();
    setSessionId(id); setMessages([welcomeMsg]); setActivities([]); setActiveAgentNames([]); setDoneAgentNames([]);
    localStorage.setItem(ACTIVE_KEY, id);
  };
  const loadSessionById = (s: SavedSession) => {
    setSessionId(s.id); setMessages(s.messages.map(m => ({ ...m, timestamp: new Date(m.timestamp) })));
    setActivities([]); setActiveAgentNames([]); setDoneAgentNames([]);
    localStorage.setItem(ACTIVE_KEY, s.id);
  };
  const deleteSessionById = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const updated = loadSessions().filter(s => s.id !== id);
    saveSessions(updated); setSessions(updated);
    if (id === sessionId) newSession();
  };

  // Send
  const handleSend = async () => {
    const text = input.trim().replace(/​/g, '');
    if (!text && attachedFiles.length === 0) return;
    if (isStreaming) return;
    if (isListening) { recognitionRef.current?.stop(); setIsListening(false); }

    let content = text;
    if (attachedFiles.length > 0) {
      const files = await Promise.all(attachedFiles.map(async f => {
        const txt = await new Promise<string>(r => { const reader = new FileReader(); reader.onload = () => r(reader.result as string); reader.onerror = () => r(`[Error: ${f.name}]`); reader.readAsText(f); });
        return `\n\n---\n${f.name}:\n${txt}`;
      }));
      content = text + files.join('');
      setAttachedFiles([]);
    }

    const userMsg: Message = { id: uid(), role: 'user', content, timestamp: new Date() };
    const assistantId = uid();

    setMessages(prev => [...prev, userMsg, { id: assistantId, role: 'assistant', content: '', timestamp: new Date() }]);
    setInput('');
    setIsStreaming(true);
    setCurrentVideoUrl(null);
    setIsVideoVisible(false);
    if (videoPollingRef.current) { clearInterval(videoPollingRef.current); videoPollingRef.current = null; }
    setActivities([]);
    setActiveAgentNames([]);
    setDoneAgentNames([]);
    setAgentReports({});
    setCurrentVideoUrl(null);
    setIsVideoVisible(false);
    stopVideoBatch();
    if (videoPollingRef.current) { clearInterval(videoPollingRef.current); videoPollingRef.current = null; }
    lastClipUrlRef.current = '';
    ttsQueueRef.current = [];
    ttsBusyRef.current = false;

    streamContentRef.current = '';
    streamThinkingRef.current = '';
    streamMsgIdRef.current = assistantId;

    const controller = new AbortController();
    abortRef.current = controller;

    const apiMsgs: ChatMsg[] = [...messages.filter(m => m.id !== 'welcome'), userMsg]
      .map(m => ({ role: m.role as 'user' | 'assistant', content: m.content }));

    streamChat(apiMsgs, {
      onThinking: (text) => { streamThinkingRef.current = text; flushStreamContent(); },
      onDelta: (delta) => { streamContentRef.current += delta; flushStreamContent(); },
      onActivity: (act) => {
        console.log('[ThotBrain:onActivity]', act.agent, act.type, act.detail?.slice(0, 50));
        setActivities(prev => [...prev.slice(-200), act]);
        if (act.agent === 'Orchestrator' || act.agent === 'ThotBrain') return;
        // Track active/done agents
        if (act.type === 'done' || act.type === 'failed') {
          setDoneAgentNames(prev => prev.includes(act.agent) ? prev : [...prev, act.agent]);
        } else {
          setActiveAgentNames(prev => prev.includes(act.agent) ? prev : [...prev, act.agent]);
        }
      },
      onAgentReport: (report) => {
        setAgentReports(prev => ({ ...prev, [report.agent]: report.content }));
      },
      onSwarmStart: (_count, agents, videoPrompts) => {
        setActiveAgentNames(agents.map(a => a.name));
        setDoneAgentNames([]);
        // Also emit start activities
        agents.forEach(a => {
          setActivities(prev => [...prev, { agent: a.name, type: 'start', detail: a.task, timestamp: Date.now() }]);
        });
        // Start continuous video loop with Kimi-generated visual prompts
        (async () => {
          try {
            const prompts = videoPrompts && videoPrompts.length > 0
              ? videoPrompts
              : agents.map(a => 'Cinematic footage related to: ' + a.task.slice(0, 80));
            console.log('[Video] Loop prompts from Kimi:', prompts);
            await startVideoBatch(prompts);
            // Poll for new clips every 5 seconds
            if (videoPollingRef.current) clearInterval(videoPollingRef.current);
            videoPollingRef.current = window.setInterval(async () => {
              const clip = await getLatestClip();
              if (clip && clip.url !== lastClipUrlRef.current) {
                lastClipUrlRef.current = clip.url;
                setCurrentVideoUrl(clip.url);
                setIsVideoVisible(true); // Auto-show when first clip arrives
              }
            }, 5000);
          } catch (e) { console.warn('Video loop failed:', e); }
        })();
      },
      onSwarmComplete: () => {
        setDoneAgentNames(prev => [...new Set([...prev, ...activeAgentNames])]);
        // Keep video batch running - it generates clips in background
        // Video polling continues until all clips are ready
      },
      onComplete: (fullText) => {
        setMessages(prev => prev.map(m => m.id === assistantId ? { ...m, content: fullText || streamContentRef.current, thinking: streamThinkingRef.current || undefined } : m));
        setIsStreaming(false);
        streamMsgIdRef.current = '';
        // TTS: read summary aloud
        if (fullText && isTTSEnabled) { const pp = fullText.split('\n\n').filter((p: string) => p.trim().length > 20).slice(0, 2); playTTS(pp.join('. ')); }
      },
      onError: (error) => {
        setMessages(prev => prev.map(m => m.id === assistantId ? { ...m, content: streamContentRef.current || `Error: ${error}` } : m));
        setIsStreaming(false);
        streamMsgIdRef.current = '';
      },
    }, controller.signal, selectedModel);
  };

  const handleNavAction = (item: typeof NAV_ITEMS[0]) => {
    if (item.action === 'mcp') setIsMCPModalOpen(true);
  };

  return (
    <div className="flex h-screen bg-[#F5F0E8] font-sans text-zinc-900 overflow-hidden selection:bg-[#DA7756]/20 selection:text-black">
      {/* ── Sidebar ── */}
      <div className="w-[280px] bg-[#FAF6F0] border-r border-[#E8E0D4] flex flex-col shrink-0 z-20 shadow-[5px_0_30px_rgba(0,0,0,0.02)]">
        {/* Logo */}
        <div className="p-6 border-b border-zinc-100">
          <div className="flex items-center gap-3 mb-6">
            <div className="w-10 h-10 bg-black rounded-xl flex items-center justify-center shadow-lg shadow-black/10">
              <Sparkles className="w-5 h-5 text-[#DA7756]" />
            </div>
            <div className="flex flex-col">
              <span className="font-extrabold text-lg tracking-tight leading-none text-black">ThotBrain</span>
              <span className="text-[10px] uppercase tracking-widest text-zinc-400 font-bold mt-1">aeternalmentis.ai</span>
            </div>
          </div>
          <button onClick={newSession} className="w-full flex items-center justify-center gap-2 bg-black text-white px-4 py-2.5 rounded-lg hover:bg-zinc-800 transition-all active:scale-[0.98] shadow-md shadow-black/10">
            <Plus className="w-4 h-4 text-[#DA7756]" />
            <span className="font-bold text-sm">Nuevo Análisis</span>
          </button>
        </div>

        {/* Navigation */}
        <div className="flex-1 overflow-y-auto py-4">
          <div className="space-y-1 px-3">
            {NAV_ITEMS.map((item, i) => {
              const Icon = item.icon;
              return (
                <button key={i} onClick={() => handleNavAction(item)}
                  className={`w-full flex items-center justify-between px-3 py-2.5 rounded-lg transition-colors ${item.badge ? 'bg-[#F0EBE1] text-zinc-900' : 'hover:bg-[#F0EBE1] text-zinc-600 hover:text-black'}`}>
                  <div className="flex items-center gap-3">
                    <Icon className={`w-4 h-4 ${item.badge ? 'text-[#DA7756]' : 'text-zinc-400'}`} />
                    <span className="text-sm font-semibold">{item.label}</span>
                  </div>
                  {item.badge && isStreaming && (
                    <span className="text-[9px] font-bold bg-[#DA7756]/10 text-[#DA7756] px-2 py-0.5 rounded-full uppercase tracking-wider border border-[#DA7756]/20">Activo</span>
                  )}
                </button>
              );
            })}
          </div>

          {/* Session History */}
          <div className="mt-8">
            <div className="px-6 text-[10px] font-bold text-zinc-400 uppercase tracking-wider mb-3">Historial de Sesiones</div>
            <div className="space-y-1 px-3">
              {sessions.map(s => (
                <button key={s.id} onClick={() => loadSessionById(s)}
                  className={`w-full text-left px-3 py-2.5 rounded-lg text-sm font-medium truncate group flex items-center justify-between gap-1 transition ${
                    s.id === sessionId ? 'bg-[#EDE7DD] text-zinc-900 font-bold border border-[#E0D8CC]/50' : 'text-zinc-500 hover:bg-zinc-50'
                  }`}>
                  <span className="truncate">{s.title}</span>
                  <button onClick={(e) => deleteSessionById(s.id, e)}
                    className="opacity-0 group-hover:opacity-100 p-0.5 rounded hover:bg-zinc-200 text-zinc-400 hover:text-red-500 transition shrink-0">
                    <Trash2 className="w-3 h-3" />
                  </button>
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* User Profile */}
        <div className="p-4 border-t border-[#E8E0D4] bg-[#F5F0E8]">
          <button className="flex items-center justify-between w-full px-3 py-2 rounded-xl hover:bg-white border border-transparent hover:border-zinc-200 transition-all shadow-sm">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-full bg-black text-[#DA7756] flex items-center justify-center text-xs font-bold shadow-inner">JS</div>
              <div className="flex flex-col text-left">
                <span className="text-sm font-bold text-zinc-900">Jorge S.</span>
                <span className="text-[10px] text-zinc-500 font-medium">Enterprise Plan</span>
              </div>
            </div>
            <div className="flex items-center gap-1.5">
              <div className={`w-2 h-2 rounded-full ${online ? 'bg-emerald-400' : 'bg-red-400'}`} />
              <Settings className="w-4 h-4 text-zinc-400" />
            </div>
          </button>
        </div>
      </div>

      {/* ── Chat area ── */}
      <div className="flex-1 flex flex-col relative min-w-[500px] bg-[#F5F0E8]">
        {/* Header */}
        <header className="h-16 flex items-center px-8 border-b border-zinc-100 bg-[#FAF6F0]/80 backdrop-blur-sm sticky top-0 z-10">
          <div className="flex items-center gap-2 text-sm font-bold text-zinc-800">
            <span className="text-zinc-400">Sesiones</span>
            <ChevronRight className="w-4 h-4 text-zinc-300" />
            <span className="truncate max-w-[300px]">{sessions.find(s => s.id === sessionId)?.title || 'Sesión actual'}</span>
          </div>
          {isStreaming && (
            <div className="ml-auto flex items-center gap-1.5">
              <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
              <span className="text-[10px] font-bold text-emerald-600 uppercase tracking-wider">Procesando</span>
            </div>
          )}
        </header>

        {/* Video contextual — compact bar above chat */}
        {isVideoVisible && currentVideoUrl && (
          <div className="relative w-full h-[80px] shrink-0 bg-black overflow-hidden">
            <video
              key={currentVideoUrl}
              src={currentVideoUrl}
              autoPlay
              muted
              loop
              playsInline
              className="w-full h-full object-cover"
            />
            <div className="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent" />
            <div className="absolute bottom-3 left-4 flex items-center gap-2">
              <div className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
              <span className="text-white/80 text-[11px] font-bold uppercase tracking-wider">Contexto Visual</span>
            </div>
            <button className="absolute top-2 right-2 px-2 py-1 rounded-md bg-black/40 text-white/60 hover:text-white text-[10px] font-bold backdrop-blur-sm" onClick={() => setIsVideoVisible(false)}>
              Cerrar
            </button>
            <div className="absolute bottom-4 left-4 text-white/40 text-[10px] font-medium">
              LTX-2.3 · Generando en bucle continuo
            </div>
          </div>
        )}

        {/* Messages */}
        <div ref={scrollRef} className="flex-1 overflow-y-auto p-8 scroll-smooth pb-40">
          <div className="max-w-4xl mx-auto space-y-10">
            {messages.map(msg => {
              const isStreamingThis = isStreaming && msg.id === streamMsgIdRef.current;
              return (
                <div key={msg.id} className={`flex gap-5 ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                  {msg.role === 'assistant' && (
                    <div className="w-10 h-10 rounded-xl bg-black flex items-center justify-center shrink-0 mt-1 shadow-lg shadow-black/10 border border-zinc-800">
                      <Sparkles className="w-5 h-5 text-[#DA7756]" />
                    </div>
                  )}
                  <div className={`flex flex-col ${msg.role === 'user' ? 'items-end' : 'items-start'} max-w-[95%]`}>
                    {msg.role === 'assistant' && (
                      <span className="text-[10px] font-bold text-zinc-400 mb-2 ml-1 uppercase tracking-wider">ThotBrain</span>
                    )}

                    {msg.role === 'user' ? (
                      <div className="bg-zinc-100 text-zinc-900 px-6 py-4 rounded-2xl font-medium border border-zinc-200/50 text-[15px] leading-relaxed whitespace-pre-wrap">
                        {msg.content}
                      </div>
                    ) : (
                      <div className="text-[15px] leading-relaxed text-zinc-800 font-medium w-full">
                        {/* Thinking */}
                        {(msg.thinking || isStreamingThis) && (
                          <div className="flex items-center gap-1.5 text-[10px] text-zinc-400 mb-1" style={{ display: msg.thinking || isStreamingThis ? '' : 'none' }}>
                            <Brain className="w-3 h-3 text-[#DA7756]" />
                            <span id={`stream-thinking-${msg.id}`} className="font-medium italic truncate max-w-[400px]">
                              {msg.thinking ? msg.thinking.slice(0, 100) + '…' : ''}
                            </span>
                          </div>
                        )}

                        {isStreamingThis ? (
                          <div id={`stream-content-${msg.id}`} className="prose-streaming"
                            dangerouslySetInnerHTML={{ __html: fastMd(streamContentRef.current) + '<span class="cursor-blink"></span>' }} />
                        ) : msg.content ? (
                          <div className="prose-compact"><FullMarkdown content={msg.content} /></div>
                        ) : isStreaming ? (
                          <div className="flex items-center gap-3 text-zinc-500 font-medium text-sm animate-pulse bg-zinc-50 px-5 py-3.5 rounded-2xl border border-zinc-200/50">
                            <Loader2 className="w-4 h-4 animate-spin text-[#DA7756]" />
                            ThotBrain está orquestando el enjambre de agentes...
                          </div>
                        ) : null}

                        {!isStreamingThis && msg.content && (
                          <button onClick={() => navigator.clipboard.writeText(msg.content)} className="mt-1 p-1 rounded text-zinc-300 hover:text-zinc-500 transition-colors">
                            <Copy className="w-3 h-3" />
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                  {msg.role === 'user' && (
                    <div className="w-10 h-10 rounded-xl bg-zinc-200 flex items-center justify-center shrink-0 mt-1">
                      <User className="w-5 h-5 text-zinc-600" />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* Input area */}
        <div className="absolute bottom-3 left-1/2 -translate-x-1/2 w-full max-w-3xl px-6">
          <div className="bg-white rounded-2xl shadow-[0_10px_40px_rgba(0,0,0,0.08)] border border-zinc-200 p-2 flex flex-col gap-1">
            {/* Status bar */}
            {isStreaming && (
              <div className="flex items-center justify-between px-2 py-0.5">
                <div className="text-xs font-medium text-zinc-500 flex items-center gap-2">
                  <div className="w-2 h-2 rounded-full bg-[#DA7756] animate-pulse" />
                  El enjambre está procesando la tarea. Puedes añadir instrucciones adicionales.
                </div>
                <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-zinc-100 text-zinc-600 text-[10px] font-bold uppercase tracking-wider border border-zinc-200">
                  <Cpu className="w-3 h-3" /> ThotBrain Core
                </div>
              </div>
            )}

            {/* Attached files */}
            {attachedFiles.length > 0 && (
              <div className="flex flex-wrap gap-1.5 px-2">
                {attachedFiles.map((f, i) => (
                  <div key={i} className="flex items-center gap-1 bg-zinc-100 border border-zinc-200 rounded-lg px-2 py-1 text-[10px] font-medium text-zinc-600">
                    <FileText className="w-3 h-3 text-zinc-400" />
                    <span className="truncate max-w-[100px]">{f.name}</span>
                    <button onClick={() => setAttachedFiles(p => p.filter((_, j) => j !== i))} className="p-0.5 rounded hover:bg-zinc-200 text-zinc-400"><X className="w-2.5 h-2.5" /></button>
                  </div>
                ))}
              </div>
            )}

            <div className="flex items-end gap-2 bg-zinc-50 rounded-xl p-2 border border-zinc-200 focus-within:border-[#DA7756] focus-within:ring-2 focus-within:ring-[#DA7756]/20 transition-all shadow-inner">
              <button onClick={() => fileInputRef.current?.click()} className="w-10 h-10 rounded-lg flex items-center justify-center text-zinc-400 hover:text-black hover:bg-zinc-200 transition-colors shrink-0 mb-0.5">
                <Plus className="w-5 h-5" />
              </button>
              <button onClick={toggleVoice}
                className={`w-10 h-10 rounded-lg flex items-center justify-center transition-colors shrink-0 mb-0.5 ${isListening ? 'bg-red-100 text-red-500 hover:bg-red-200 animate-pulse' : 'text-zinc-400 hover:text-black hover:bg-zinc-200'}`}>
                {isListening ? <MicOff className="w-5 h-5" /> : <Mic className="w-5 h-5" />}
              </button>
              {/* TTS activates automatically with mic */}
              <button onClick={() => { if (currentVideoUrl) setIsVideoVisible(p => !p); }}
                title={currentVideoUrl ? "Ver vídeo contextual" : "Generando vídeo..."}
                  className={`w-10 h-10 rounded-lg flex items-center justify-center transition-colors shrink-0 mb-0.5 ${isVideoVisible ? 'bg-[#DA7756]/10 text-[#DA7756]' : 'text-zinc-400 hover:text-black hover:bg-zinc-200'}`}>
                <Video className="w-5 h-5" />
              </button>

              <input ref={fileInputRef} type="file" multiple className="hidden" accept="image/*,.pdf,.txt,.csv,.json,.md,.html,.xml,.doc,.docx"
                onChange={e => { if (e.target.files) setAttachedFiles(p => [...p, ...Array.from(e.target.files!)]); e.target.value = ''; }} />

              <textarea ref={inputRef} value={input}
                onChange={e => { setInput(e.target.value); e.target.style.height = 'auto'; e.target.style.height = `${Math.min(e.target.scrollHeight, 300)}px`; }}
                onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); } }}
                placeholder={isListening ? 'Escuchando…' : 'Escribe o dicta tu mensaje aquí (Shift + Enter para nueva línea)...'}
                className={`flex-1 bg-transparent border-none focus:ring-0 text-[15px] font-medium text-zinc-800 placeholder:text-zinc-400 px-2 py-2.5 outline-none resize-none min-h-[36px] max-h-[120px] overflow-y-auto leading-relaxed ${isListening ? 'placeholder:text-[#DA7756] placeholder:animate-pulse' : ''}`}
                rows={1} />

              <div className="relative shrink-0 mb-0.5">
                <button onClick={() => setShowModelMenu(p => !p)}
                  className="flex items-center gap-1 px-2.5 py-2 rounded-lg text-[10px] font-bold text-zinc-500 hover:bg-zinc-200 transition">
                  {MODELS.find(m => m.id === selectedModel)?.name || selectedModel}
                  <ChevronDown className="w-2.5 h-2.5" />
                </button>
                {showModelMenu && (
                  <>
                    <div className="fixed inset-0 z-40" onClick={() => setShowModelMenu(false)} />
                    <div className="absolute bottom-full right-0 mb-1 w-52 bg-white border border-zinc-200 rounded-xl shadow-xl z-50 py-1">
                      {MODELS.map(m => (
                        <button key={m.id} onClick={() => { setSelectedModel(m.id); setShowModelMenu(false); }} disabled={!m.active}
                          className={`w-full text-left px-3 py-1.5 text-[11px] hover:bg-zinc-50 flex items-center justify-between ${!m.active ? 'opacity-40' : ''}`}>
                          <div><div className="font-semibold text-zinc-800">{m.name}</div><div className="text-[9px] text-zinc-400">{m.desc}</div></div>
                          {selectedModel === m.id && <CheckCircle2 className="w-3 h-3 text-[#DA7756]" />}
                        </button>
                      ))}
                    </div>
                  </>
                )}
              </div>

              {isStreaming ? (
                <button onClick={() => { abortRef.current?.abort(); setIsStreaming(false); }}
                  className="w-10 h-10 rounded-lg bg-red-500 text-white flex items-center justify-center hover:bg-red-600 transition shrink-0 mb-0.5 shadow-md">
                  <Square className="w-4 h-4" fill="white" />
                </button>
              ) : (
                <button onClick={handleSend} disabled={!input.trim() && attachedFiles.length === 0}
                  className={`w-10 h-10 rounded-lg flex items-center justify-center shrink-0 transition-all mb-0.5 ${input.trim() ? 'bg-black text-[#DA7756] hover:bg-zinc-800 shadow-md' : 'bg-zinc-200 text-zinc-400 cursor-not-allowed'}`}>
                  <Send className="w-4 h-4" />
                </button>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* ── Agent Panel (from mockup) ── */}
      <div className="w-[420px] shrink-0 hidden xl:block z-20">
        <SwarmActivityPanel
          activeAgentNames={activeAgentNames}
          doneAgentNames={doneAgentNames}
          activities={activities}
          isProcessing={isStreaming}
          agentReports={agentReports}
        />
      </div>

      {/* ── MCP Modal ── */}
      <MCPConnectorsModal isOpen={isMCPModalOpen} onClose={() => setIsMCPModalOpen(false)} />

      {/* Hidden TTS audio */}
      <audio ref={ttsAudioRef} className="hidden" />

      {/* ── Global styles ── */}
      <style>{`
        .cursor-blink { display:inline-block;width:2px;height:14px;background:#DA7756;margin-left:2px;vertical-align:text-bottom;animation:blink 1s step-end infinite; }
        @keyframes blink { 50% { opacity:0 } }
        .prose-streaming,.prose-compact{padding:0 24px}
        .research-img{width:calc(50% - 10px) !important;height:160px !important;border-radius:10px;object-fit:cover;margin:4px !important;display:inline-block !important;vertical-align:top}
        .prose-streaming h1,.prose-compact h1{font-size:16px;font-weight:700;margin:12px 0 4px}
        .prose-streaming h2,.prose-compact h2{font-size:14px;font-weight:700;margin:10px 0 4px}
        .prose-streaming h3,.prose-compact h3{font-size:13px;font-weight:700;margin:8px 0 2px}
        .prose-streaming strong,.prose-compact strong{font-weight:600;color:#18181b}
        .prose-streaming em,.prose-compact em{font-style:italic}
        .prose-streaming a{color:#DA7756;text-decoration:none;border-bottom:1px solid rgba(212,175,55,0.3)}
        .prose-streaming li{margin:2px 0}
        .prose-streaming hr{border-color:#e4e4e7;margin:8px 0}
        .inline-code{background:#f4f4f5;color:#3f3f46;padding:1px 5px;border-radius:4px;font-size:11px;font-family:'JetBrains Mono',monospace}
        .code-block{background:#18181b;color:#e4e4e7;border-radius:8px;padding:12px 16px;font-size:11px;font-family:'JetBrains Mono',monospace;overflow-x:auto;margin:8px 0;line-height:1.5}
        .scrollbar-hide::-webkit-scrollbar{display:none}
        .scrollbar-hide{-ms-overflow-style:none;scrollbar-width:none}
      `}</style>
    </div>
  );
}
