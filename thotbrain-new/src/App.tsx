import { useState, useRef, useEffect, useCallback, memo } from 'react';
import {
  Send, User, Settings, Plus, Sparkles, Copy, Cpu, Network,
  ChevronRight, CheckCircle2, Brain, Loader2, Square,
  Paperclip, X, FileText, ChevronDown, Mic, MicOff,
  Trash2, Play, Code, ChevronUp,
  Database, Mail, Activity, Layers, Terminal, Plug,
} from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { streamChat, checkHealth, stripControlText } from './lib/api';
import type { ChatMsg, AgentActivity, AgentReport } from './lib/api';
import { SwarmActivityPanel } from './components/SwarmActivityPanel';
import { MCPConnectorsModal } from './components/MCPConnectorsModal';

// ─── Constants ───
const RENDER_THROTTLE_MS = 80;
const SESSIONS_KEY = 'thotbrain_sessions';
const ACTIVE_KEY = 'thotbrain_active';

const MODELS = [
  { id: 'kimi2.5', name: 'Kimi K2.5', desc: '8\u00d7H200 NVL \u00b7 32K ctx', active: true },
  { id: 'qwen3-235b', name: 'Qwen3 235B', desc: 'MoE \u00b7 Pr\u00f3ximamente', active: false },
  { id: 'deepseek-r1', name: 'DeepSeek R1', desc: '671B \u00b7 Pr\u00f3ximamente', active: false },
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
  const title = first ? first.content.slice(0, 60) + (first.content.length > 60 ? '\u2026' : '') : 'Nueva sesi\u00f3n';
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
    .replace(/\[(.+?)\]\((.+?)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>')
    .replace(/^[-*] (.+)$/gm, '<li>$1</li>')
    .replace(/^\d+\.\s(.+)$/gm, '<li>$1</li>')
    .replace(/^---+$/gm, '<hr/>')
    .replace(/\n{2,}/g, '</p><p>')
    .replace(/\n/g, '<br/>');
}

// ─── React Sandbox ───
function ReactSandbox({ code }: { code: string }) {
  const [show, setShow] = useState(false);
  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"/><script src="https://unpkg.com/react@18/umd/react.production.min.js" crossorigin></script><script src="https://unpkg.com/react-dom@18/umd/react-dom.production.min.js" crossorigin></script><script src="https://unpkg.com/@babel/standalone/babel.min.js"></script><style>*{margin:0;padding:0;box-sizing:border-box}body{font-family:-apple-system,sans-serif;padding:16px;background:#fff}</style></head><body><div id="root"></div><script type="text/babel">${code.replace(/<\/script>/g, '<\\/script>')}
const root=ReactDOM.createRoot(document.getElementById('root'));try{if(typeof App!=='undefined')root.render(React.createElement(App));else if(typeof Component!=='undefined')root.render(React.createElement(Component));}catch(e){document.getElementById('root').innerHTML='<pre style="color:red">'+e.message+'</pre>';}</script></body></html>`;
  return (
    <div className="my-2 border border-zinc-200 rounded-xl overflow-hidden">
      <div className="flex items-center justify-between px-3 py-1.5 bg-zinc-50 border-b border-zinc-200">
        <div className="flex items-center gap-2 text-[11px] font-semibold text-zinc-500"><Code className="w-3.5 h-3.5" /><span>React Component</span></div>
        <button onClick={() => setShow(!show)} className="flex items-center gap-1 px-2 py-1 rounded-md text-[10px] font-bold bg-black text-[#D4AF37] hover:bg-zinc-800 transition-colors">
          {show ? <ChevronUp className="w-3 h-3" /> : <Play className="w-3 h-3" />}{show ? 'Ocultar' : 'Preview'}
        </button>
      </div>
      {show && <iframe srcDoc={html} sandbox="allow-scripts" className="w-full border-0 bg-white" style={{ height: '400px', resize: 'vertical' }} title="React Preview" />}
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
            a: ({ href, children }) => <a href={href} target="_blank" rel="noopener noreferrer" className="text-[#D4AF37] hover:underline">{children}</a>,
            blockquote: ({ children }) => <blockquote className="border-l-2 border-[#D4AF37]/40 pl-3 italic text-zinc-500 my-1.5">{children}</blockquote>,
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
  { icon: Mail, label: 'Integraci\u00f3n Email' },
  { icon: Activity, label: 'M\u00e9tricas en Vivo' },
  { icon: Layers, label: 'Modelos RAG' },
  { icon: Terminal, label: 'Computer Scripts' },
  { icon: Network, label: 'Agent Swarm', badge: true },
  { icon: Plug, label: 'Conectores MCP', action: 'mcp' },
];

// ─── Welcome message ───
const welcomeMsg: Message = {
  id: 'welcome',
  role: 'assistant',
  content: 'Hola Jorge. Soy ThotBrain. \u00bfQu\u00e9 an\u00e1lisis o tarea quieres que el enjambre de agentes realice hoy?',
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

  const recognitionRef = useRef<SpeechRecognition | null>(null);
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
      thinkEl.textContent = thinking.slice(0, 100) + (thinking.length > 100 ? '\u2026' : '');
      thinkEl.parentElement!.style.display = '';
    }
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, []);

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

  // Voice
  const toggleVoice = () => {
    if (isListening) { recognitionRef.current?.stop(); setIsListening(false); return; }
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) { alert('Tu navegador no soporta reconocimiento de voz.'); return; }
    const rec = new SR();
    rec.lang = 'es-ES'; rec.continuous = true; rec.interimResults = true;
    let final = input;
    rec.onresult = (e: SpeechRecognitionEvent) => {
      let interim = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        if (e.results[i].isFinal) final += e.results[i][0].transcript + ' ';
        else interim = e.results[i][0].transcript;
      }
      setInput(final + (interim ? '\u200B' + interim : ''));
    };
    rec.onend = () => { setIsListening(false); setInput(p => p.replace(/\u200B/g, '')); };
    rec.onerror = () => setIsListening(false);
    recognitionRef.current = rec; rec.start(); setIsListening(true);
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
    const text = input.trim().replace(/\u200B/g, '');
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
    setActivities([]);
    setActiveAgentNames([]);
    setDoneAgentNames([]);

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
      onAgentReport: (_report) => {
        // Reports are stripped from text, but could be shown in panel
      },
      onSwarmStart: (_count, agents) => {
        setActiveAgentNames(agents.map(a => a.name));
        setDoneAgentNames([]);
        // Also emit start activities
        agents.forEach(a => {
          setActivities(prev => [...prev, { agent: a.name, type: 'start', detail: a.task, timestamp: Date.now() }]);
        });
      },
      onSwarmComplete: () => {
        setDoneAgentNames(prev => [...new Set([...prev, ...activeAgentNames])]);
      },
      onComplete: (fullText) => {
        setMessages(prev => prev.map(m => m.id === assistantId ? { ...m, content: fullText || streamContentRef.current, thinking: streamThinkingRef.current || undefined } : m));
        setIsStreaming(false);
        streamMsgIdRef.current = '';
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
    <div className="flex h-screen bg-[#FDFDFD] font-sans text-zinc-900 overflow-hidden selection:bg-[#D4AF37]/30 selection:text-black">
      {/* ── Sidebar ── */}
      <div className="w-[280px] bg-white border-r border-zinc-200 flex flex-col shrink-0 z-20 shadow-[5px_0_30px_rgba(0,0,0,0.02)]">
        {/* Logo */}
        <div className="p-6 border-b border-zinc-100">
          <div className="flex items-center gap-3 mb-6">
            <div className="w-10 h-10 bg-black rounded-xl flex items-center justify-center shadow-lg shadow-black/10">
              <Sparkles className="w-5 h-5 text-[#D4AF37]" />
            </div>
            <div className="flex flex-col">
              <span className="font-extrabold text-lg tracking-tight leading-none text-black">ThotBrain</span>
              <span className="text-[10px] uppercase tracking-widest text-zinc-400 font-bold mt-1">aeternalmentis.ai</span>
            </div>
          </div>
          <button onClick={newSession} className="w-full flex items-center justify-center gap-2 bg-black text-white px-4 py-2.5 rounded-lg hover:bg-zinc-800 transition-all active:scale-[0.98] shadow-md shadow-black/10">
            <Plus className="w-4 h-4 text-[#D4AF37]" />
            <span className="font-bold text-sm">Nuevo An\u00e1lisis</span>
          </button>
        </div>

        {/* Navigation */}
        <div className="flex-1 overflow-y-auto py-4">
          <div className="space-y-1 px-3">
            {NAV_ITEMS.map((item, i) => {
              const Icon = item.icon;
              return (
                <button key={i} onClick={() => handleNavAction(item)}
                  className={`w-full flex items-center justify-between px-3 py-2.5 rounded-lg transition-colors ${item.badge ? 'bg-zinc-50 text-black' : 'hover:bg-zinc-50 text-zinc-600 hover:text-black'}`}>
                  <div className="flex items-center gap-3">
                    <Icon className={`w-4 h-4 ${item.badge ? 'text-[#D4AF37]' : 'text-zinc-400'}`} />
                    <span className="text-sm font-semibold">{item.label}</span>
                  </div>
                  {item.badge && isStreaming && (
                    <span className="text-[9px] font-bold bg-[#D4AF37]/10 text-[#D4AF37] px-2 py-0.5 rounded-full uppercase tracking-wider border border-[#D4AF37]/20">Activo</span>
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
                    s.id === sessionId ? 'bg-zinc-100/80 text-zinc-900 font-bold border border-zinc-200/50' : 'text-zinc-500 hover:bg-zinc-50'
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
        <div className="p-4 border-t border-zinc-200 bg-zinc-50">
          <button className="flex items-center justify-between w-full px-3 py-2 rounded-xl hover:bg-white border border-transparent hover:border-zinc-200 transition-all shadow-sm">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-full bg-black text-[#D4AF37] flex items-center justify-center text-xs font-bold shadow-inner">JS</div>
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
      <div className="flex-1 flex flex-col relative min-w-[500px] bg-[#FDFDFD]">
        {/* Header */}
        <header className="h-16 flex items-center px-8 border-b border-zinc-100 bg-white/50 backdrop-blur-sm sticky top-0 z-10">
          <div className="flex items-center gap-2 text-sm font-bold text-zinc-800">
            <span className="text-zinc-400">Sesiones</span>
            <ChevronRight className="w-4 h-4 text-zinc-300" />
            <span className="truncate max-w-[300px]">{sessions.find(s => s.id === sessionId)?.title || 'Sesi\u00f3n actual'}</span>
          </div>
          {isStreaming && (
            <div className="ml-auto flex items-center gap-1.5">
              <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
              <span className="text-[10px] font-bold text-emerald-600 uppercase tracking-wider">Procesando</span>
            </div>
          )}
        </header>

        {/* Messages */}
        <div ref={scrollRef} className="flex-1 overflow-y-auto p-8 scroll-smooth pb-40">
          <div className="max-w-4xl mx-auto space-y-10">
            {messages.map(msg => {
              const isStreamingThis = isStreaming && msg.id === streamMsgIdRef.current;
              return (
                <div key={msg.id} className={`flex gap-5 ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                  {msg.role === 'assistant' && (
                    <div className="w-10 h-10 rounded-xl bg-black flex items-center justify-center shrink-0 mt-1 shadow-lg shadow-black/10 border border-zinc-800">
                      <Sparkles className="w-5 h-5 text-[#D4AF37]" />
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
                            <Brain className="w-3 h-3 text-[#D4AF37]" />
                            <span id={`stream-thinking-${msg.id}`} className="font-medium italic truncate max-w-[400px]">
                              {msg.thinking ? msg.thinking.slice(0, 100) + '\u2026' : ''}
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
                            <Loader2 className="w-4 h-4 animate-spin text-[#D4AF37]" />
                            ThotBrain est\u00e1 orquestando el enjambre de agentes...
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
        <div className="absolute bottom-8 left-1/2 -translate-x-1/2 w-full max-w-4xl px-8">
          <div className="bg-white rounded-2xl shadow-[0_10px_40px_rgba(0,0,0,0.08)] border border-zinc-200 p-3 flex flex-col gap-3">
            {/* Status bar */}
            {isStreaming && (
              <div className="flex items-center justify-between px-2">
                <div className="text-xs font-medium text-zinc-500 flex items-center gap-2">
                  <div className="w-2 h-2 rounded-full bg-[#D4AF37] animate-pulse" />
                  El enjambre est\u00e1 procesando la tarea. Puedes a\u00f1adir instrucciones adicionales.
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

            <div className="flex items-end gap-2 bg-zinc-50 rounded-xl p-2 border border-zinc-200 focus-within:border-[#D4AF37] focus-within:ring-2 focus-within:ring-[#D4AF37]/20 transition-all shadow-inner">
              <button onClick={() => fileInputRef.current?.click()} className="w-10 h-10 rounded-lg flex items-center justify-center text-zinc-400 hover:text-black hover:bg-zinc-200 transition-colors shrink-0 mb-0.5">
                <Plus className="w-5 h-5" />
              </button>
              <button onClick={toggleVoice}
                className={`w-10 h-10 rounded-lg flex items-center justify-center transition-colors shrink-0 mb-0.5 ${isListening ? 'bg-red-100 text-red-500 hover:bg-red-200 animate-pulse' : 'text-zinc-400 hover:text-black hover:bg-zinc-200'}`}>
                {isListening ? <MicOff className="w-5 h-5" /> : <Mic className="w-5 h-5" />}
              </button>

              <input ref={fileInputRef} type="file" multiple className="hidden" accept="image/*,.pdf,.txt,.csv,.json,.md,.html,.xml,.doc,.docx"
                onChange={e => { if (e.target.files) setAttachedFiles(p => [...p, ...Array.from(e.target.files!)]); e.target.value = ''; }} />

              <textarea ref={inputRef} value={input}
                onChange={e => { setInput(e.target.value); e.target.style.height = 'auto'; e.target.style.height = `${Math.min(e.target.scrollHeight, 300)}px`; }}
                onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); } }}
                placeholder={isListening ? 'Escuchando\u2026' : 'Escribe o dicta tu mensaje aqu\u00ed (Shift + Enter para nueva l\u00ednea)...'}
                className={`flex-1 bg-transparent border-none focus:ring-0 text-[15px] font-medium text-zinc-800 placeholder:text-zinc-400 px-2 py-2.5 outline-none resize-none min-h-[44px] max-h-[300px] overflow-y-auto leading-relaxed ${isListening ? 'placeholder:text-[#D4AF37] placeholder:animate-pulse' : ''}`}
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
                          {selectedModel === m.id && <CheckCircle2 className="w-3 h-3 text-[#D4AF37]" />}
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
                  className={`w-10 h-10 rounded-lg flex items-center justify-center shrink-0 transition-all mb-0.5 ${input.trim() ? 'bg-black text-[#D4AF37] hover:bg-zinc-800 shadow-md' : 'bg-zinc-200 text-zinc-400 cursor-not-allowed'}`}>
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
        />
      </div>

      {/* ── MCP Modal ── */}
      <MCPConnectorsModal isOpen={isMCPModalOpen} onClose={() => setIsMCPModalOpen(false)} />

      {/* ── Global styles ── */}
      <style>{`
        .cursor-blink { display:inline-block;width:2px;height:14px;background:#D4AF37;margin-left:2px;vertical-align:text-bottom;animation:blink 1s step-end infinite; }
        @keyframes blink { 50% { opacity:0 } }
        .prose-streaming h1,.prose-compact h1{font-size:16px;font-weight:700;margin:12px 0 4px}
        .prose-streaming h2,.prose-compact h2{font-size:14px;font-weight:700;margin:10px 0 4px}
        .prose-streaming h3,.prose-compact h3{font-size:13px;font-weight:700;margin:8px 0 2px}
        .prose-streaming strong,.prose-compact strong{font-weight:600;color:#18181b}
        .prose-streaming em,.prose-compact em{font-style:italic}
        .prose-streaming a{color:#D4AF37;text-decoration:none;border-bottom:1px solid rgba(212,175,55,0.3)}
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
