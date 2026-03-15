import { useState, useEffect, useRef, useMemo } from 'react';
import { BrainCircuit, CheckCircle2, Network, Terminal, Loader2, Activity, Search, Globe, Brain, Zap, AlertCircle } from 'lucide-react';
import type { AgentActivity } from '../lib/api';

export const allAgents = [
  { id: 1, name: "Elena Rostova", orchName: "Iker", role: "Ingeniero", roleBadge: "INGENIERO", avatar: "https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=150&h=150&fit=crop" },
  { id: 2, name: "Marcus Chen", orchName: "Miren", role: "Comercial", roleBadge: "COMERCIAL", avatar: "https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=150&h=150&fit=crop" },
  { id: 3, name: "Sofia Al-Fayed", orchName: "Asier", role: "Experto en Marketing", roleBadge: "MARKETING", avatar: "https://images.unsplash.com/photo-1573496359142-b8d87734a5a2?w=150&h=150&fit=crop" },
  { id: 4, name: "David Thorne", orchName: "Ziortza", role: "Asesor Legal", roleBadge: "ASESOR LEGAL", avatar: "https://images.unsplash.com/photo-1519085360753-af0119f7cbe7?w=150&h=150&fit=crop" },
  { id: 5, name: "Carmen Vega", orchName: "Jon", role: "Asesor Laboral", roleBadge: "LABORAL", avatar: "https://images.unsplash.com/photo-1580489944761-15a19d654956?w=150&h=150&fit=crop" },
  { id: 6, name: "Raj Patel", orchName: "Ana", role: "Data Scientist", roleBadge: "DATA", avatar: "https://images.unsplash.com/photo-1506794778202-cad84cf45f1d?w=150&h=150&fit=crop" },
  { id: 7, name: "Yuki Tanaka", orchName: "Unai", role: "Systems Engineer", roleBadge: "SISTEMAS", avatar: "https://images.unsplash.com/photo-1472099645785-5658abf4ff4e?w=150&h=150&fit=crop" },
  { id: 8, name: "Anna Kowalski", orchName: "Leire", role: "Research Lead", roleBadge: "RESEARCH", avatar: "https://images.unsplash.com/photo-1544005313-94ddf0286df2?w=150&h=150&fit=crop" },
];

function findAgent(orchName: string) {
  return allAgents.find(a => a.orchName === orchName);
}

// Activity type to icon and status text
function activityMeta(type: string): { icon: string; label: string; color: string } {
  switch (type) {
    case 'start': return { icon: 'zap', label: 'Iniciando', color: '#D4AF37' };
    case 'search': case 'searching': return { icon: 'search', label: 'Buscando', color: '#3B82F6' };
    case 'fetch': case 'fetching': return { icon: 'globe', label: 'Leyendo', color: '#8B5CF6' };
    case 'search_done': case 'fetch_done': return { icon: 'check', label: 'Datos obtenidos', color: '#10B981' };
    case 'thinking': case 'reasoning': return { icon: 'brain', label: 'Analizando', color: '#F59E0B' };
    case 'executing_tools': return { icon: 'zap', label: 'Ejecutando', color: '#EC4899' };
    case 'synthesizing': return { icon: 'brain', label: 'Sintetizando', color: '#D4AF37' };
    case 'conclusion': return { icon: 'check', label: 'Conclusi\u00f3n', color: '#10B981' };
    case 'done': return { icon: 'check', label: 'Completado', color: '#10B981' };
    case 'failed': return { icon: 'alert', label: 'Error', color: '#EF4444' };
    default: return { icon: 'zap', label: type, color: '#71717A' };
  }
}

function StatusIcon({ type, className }: { type: string; className?: string }) {
  const cls = className || 'w-3.5 h-3.5';
  switch (type) {
    case 'search': return <Search className={cls} />;
    case 'globe': return <Globe className={cls} />;
    case 'brain': return <Brain className={cls} />;
    case 'check': return <CheckCircle2 className={cls} />;
    case 'alert': return <AlertCircle className={cls} />;
    default: return <Zap className={cls} />;
  }
}

interface SwarmActivityPanelProps {
  activeAgentNames: string[];
  doneAgentNames: string[];
  activities: AgentActivity[];
  isProcessing: boolean;
}

// Compute per-agent state from activities
interface AgentState {
  orchName: string;
  agent: typeof allAgents[0];
  task: string;
  status: string;  // latest activity type
  statusLabel: string;
  statusColor: string;
  searchCount: number;
  fetchCount: number;
  totalActions: number;
  isDone: boolean;
  isFailed: boolean;
  lastDetail: string;
  activities: AgentActivity[];  // this agent's activities for hover
}

export const SwarmActivityPanel: React.FC<SwarmActivityPanelProps> = ({ activeAgentNames, doneAgentNames, activities, isProcessing }) => {
  const [hoveredAgent, setHoveredAgent] = useState<string | null>(null);
  const cotEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    cotEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [activities]);

  // Build per-agent state — STABLE: agents stay in their slot, never move
  const agentStates = useMemo<AgentState[]>(() => {
    const stateMap = new Map<string, AgentState>();

    // Initialize from activeAgentNames (preserves order from swarm launch)
    activeAgentNames.forEach(name => {
      const agent = findAgent(name);
      if (!agent || stateMap.has(name)) return;
      stateMap.set(name, {
        orchName: name,
        agent,
        task: '',
        status: 'start',
        statusLabel: 'Iniciando',
        statusColor: '#D4AF37',
        searchCount: 0,
        fetchCount: 0,
        totalActions: 0,
        isDone: doneAgentNames.includes(name),
        isFailed: false,
        lastDetail: '',
        activities: [],
      });
    });

    // Process activities to update state
    activities.forEach(act => {
      if (act.agent === 'Orchestrator' || act.agent === 'ThotBrain') return;
      let state = stateMap.get(act.agent);
      if (!state) {
        const agent = findAgent(act.agent);
        if (!agent) return;
        state = {
          orchName: act.agent,
          agent,
          task: '',
          status: 'start',
          statusLabel: 'Iniciando',
          statusColor: '#D4AF37',
          searchCount: 0,
          fetchCount: 0,
          totalActions: 0,
          isDone: false,
          isFailed: false,
          lastDetail: '',
          activities: [],
        };
        stateMap.set(act.agent, state);
      }

      state.activities.push(act);
      state.totalActions++;

      if (act.type === 'start' && act.detail) {
        state.task = act.detail;
      }

      if (act.type === 'search' || act.type === 'searching') state.searchCount++;
      if (act.type === 'fetch' || act.type === 'fetching') state.fetchCount++;

      const meta = activityMeta(act.type);
      state.status = act.type;
      state.statusLabel = meta.label;
      state.statusColor = meta.color;
      state.lastDetail = act.detail || '';

      if (act.type === 'done') state.isDone = true;
      if (act.type === 'failed') { state.isFailed = true; state.isDone = true; }
    });

    // Also mark done from props
    doneAgentNames.forEach(name => {
      const state = stateMap.get(name);
      if (state) state.isDone = true;
    });

    return Array.from(stateMap.values());
  }, [activeAgentNames, doneAgentNames, activities]);

  // Animated progress: advances over time while agent is active
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!isProcessing) return;
    const iv = setInterval(() => setTick(t => t + 1), 800);
    return () => clearInterval(iv);
  }, [isProcessing]);

  const getProgress = (state: AgentState): number => {
    if (state.isDone) return 100;
    if (state.totalActions === 0) return Math.min(3 + tick * 2, 15);
    // Base progress from activity type
    const typeWeights: Record<string, number> = {
      start: 10, searching: 20, search: 20, search_done: 30,
      fetching: 35, fetch: 35, fetch_done: 45,
      thinking: 55, reasoning: 60, executing_tools: 65,
      synthesizing: 75, conclusion: 90, done: 100, failed: 100,
    };
    const base = typeWeights[state.status] || 15;
    // Add gradual increase based on actions and time
    const actionBonus = Math.min(state.totalActions * 5, 25);
    const timeBonus = Math.min(tick * 1.5, 20);
    return Math.min(base + actionBonus + timeBonus, 95);
  };

  // Agent card size grows with knowledge (search+fetch count)
  const getCardScale = (state: AgentState): string => {
    const knowledge = state.searchCount + state.fetchCount;
    if (knowledge >= 6) return 'py-4';  // lots of data
    if (knowledge >= 3) return 'py-3.5';
    return 'py-3';
  };

  const totalSearches = agentStates.reduce((s, a) => s + a.searchCount, 0);
  const totalFetches = agentStates.reduce((s, a) => s + a.fetchCount, 0);
  const doneCount = agentStates.filter(a => a.isDone).length;

  return (
    <div className="h-full flex flex-col bg-zinc-50/50 border-l border-zinc-200 shadow-[-10px_0_30px_rgba(0,0,0,0.02)]">
      {/* Header */}
      <div className="h-16 px-5 border-b border-zinc-200 flex items-center justify-between bg-white shrink-0">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-black flex items-center justify-center shadow-md shadow-black/10">
            <BrainCircuit className="w-5 h-5 text-[#D4AF37]" />
          </div>
          <div className="flex flex-col">
            <span className="font-bold text-sm tracking-tight text-zinc-900">LLM Orchestrator</span>
            <div className="flex items-center gap-1.5">
              {isProcessing ? (
                <>
                  <Loader2 className="w-3 h-3 text-[#D4AF37] animate-spin" />
                  <span className="text-[10px] text-[#D4AF37] font-bold uppercase tracking-wider">Procesando</span>
                </>
              ) : agentStates.length > 0 ? (
                <>
                  <div className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                  <span className="text-[10px] text-emerald-600 font-bold uppercase tracking-wider">Completado</span>
                </>
              ) : (
                <>
                  <div className="w-1.5 h-1.5 rounded-full bg-zinc-400" />
                  <span className="text-[10px] text-zinc-400 font-bold uppercase tracking-wider">En espera</span>
                </>
              )}
            </div>
          </div>
        </div>
        <button className="w-8 h-8 rounded-lg border border-zinc-200 flex items-center justify-center text-zinc-400 hover:bg-zinc-100 hover:text-zinc-900 transition-colors bg-white shadow-sm">
          <Activity className="w-4 h-4" />
        </button>
      </div>

      {/* Stats bar */}
      {agentStates.length > 0 && (
        <div className="px-5 py-3 border-b border-zinc-200 bg-white shrink-0">
          <div className="flex items-center justify-between">
            <h4 className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider">Agent Swarm</h4>
            <span className="text-[10px] font-bold text-[#D4AF37] bg-[#D4AF37]/10 px-2 py-0.5 rounded-full">
              {agentStates.length} Agentes
            </span>
          </div>
          <div className="flex items-center gap-4 mt-2">
            <div className="flex items-center gap-1.5 text-[10px] text-zinc-500">
              <Search className="w-3 h-3 text-blue-500" />
              <span className="font-bold">{totalSearches}</span> b\u00fasquedas
            </div>
            <div className="flex items-center gap-1.5 text-[10px] text-zinc-500">
              <Globe className="w-3 h-3 text-purple-500" />
              <span className="font-bold">{totalFetches}</span> lecturas
            </div>
            <div className="flex items-center gap-1.5 text-[10px] text-zinc-500">
              <CheckCircle2 className="w-3 h-3 text-emerald-500" />
              <span className="font-bold">{doneCount}/{agentStates.length}</span> listos
            </div>
          </div>
        </div>
      )}

      {/* Agent List — FIXED POSITIONS, never move */}
      <div className="flex-1 overflow-y-auto">
        {agentStates.length === 0 && !isProcessing && (
          <div className="flex flex-col items-center justify-center h-full text-zinc-400 px-8">
            <Network className="w-12 h-12 mb-4 text-zinc-300" />
            <p className="text-sm font-bold text-zinc-500 text-center mb-1">Agent Swarm</p>
            <p className="text-xs text-center">Esperando instrucciones para activar el enjambre de agentes especializados...</p>
          </div>
        )}

        {agentStates.length === 0 && isProcessing && (
          <div className="flex flex-col items-center justify-center h-full text-zinc-400 px-8">
            <Loader2 className="w-10 h-10 mb-4 text-[#D4AF37] animate-spin" />
            <p className="text-sm font-bold text-zinc-500 text-center mb-1">Iniciando enjambre...</p>
            <p className="text-xs text-center">Planificando estrategia de agentes y asignando tareas...</p>
          </div>
        )}

        {agentStates.map((state, idx) => {
          const progress = getProgress(state);
          const cardPadding = getCardScale(state);
          const isHovered = hoveredAgent === state.orchName;

          return (
            <div
              key={state.orchName}
              className={`border-b border-zinc-100 transition-all duration-300 ${
                state.isDone && !state.isFailed ? 'bg-emerald-50/30' :
                state.isFailed ? 'bg-red-50/30' :
                'bg-white hover:bg-zinc-50/80'
              }`}
              onMouseEnter={() => setHoveredAgent(state.orchName)}
              onMouseLeave={() => setHoveredAgent(null)}
            >
              {/* Main row */}
              <div className={`px-5 ${cardPadding} flex items-start gap-3`}>
                {/* Number badge */}
                <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 mt-0.5 text-sm font-black ${
                  state.isDone && !state.isFailed ? 'bg-emerald-500 text-white' :
                  state.isFailed ? 'bg-red-500 text-white' :
                  'bg-zinc-900 text-[#D4AF37]'
                }`}>
                  {String(idx + 1).padStart(2, '0')}
                </div>

                {/* Agent info */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-0.5">
                    <img src={state.agent.avatar} alt={state.agent.name}
                      className="w-5 h-5 rounded-full object-cover border border-zinc-200"
                      referrerPolicy="no-referrer" crossOrigin="anonymous" />
                    <span className="text-sm font-bold text-zinc-900 truncate">{state.agent.name}</span>
                    <span className="text-[9px] font-bold uppercase tracking-wider text-zinc-500 bg-zinc-100 px-1.5 py-0.5 rounded shrink-0">
                      {state.agent.roleBadge}
                    </span>
                  </div>

                  {/* Task description */}
                  <p className="text-[11px] text-zinc-500 font-medium truncate mb-2">
                    {state.task || 'Asignando tarea...'}
                  </p>

                  {/* Progress bar */}
                  <div className="flex items-center gap-2">
                    <div className="flex-1 h-1.5 bg-zinc-200 rounded-full overflow-hidden">
                      <div
                        className={`h-full rounded-full transition-all duration-700 ease-out ${
                          state.isDone && !state.isFailed ? 'bg-emerald-500' :
                          state.isFailed ? 'bg-red-500' :
                          'bg-[#D4AF37]'
                        }`}
                        style={{ width: `${progress}%` }}
                      />
                    </div>
                    <span className={`text-[10px] font-bold shrink-0 ${
                      state.isDone && !state.isFailed ? 'text-emerald-600' :
                      state.isFailed ? 'text-red-600' :
                      'text-[#D4AF37]'
                    }`}>
                      {progress}%
                    </span>
                  </div>

                  {/* Status line */}
                  <div className="flex items-center gap-2 mt-1.5">
                    <div className="flex items-center gap-1" style={{ color: state.statusColor }}>
                      <StatusIcon type={activityMeta(state.status).icon} className="w-3 h-3" />
                      <span className="text-[10px] font-bold uppercase tracking-wider">{state.statusLabel}</span>
                    </div>
                    {(state.searchCount > 0 || state.fetchCount > 0) && (
                      <div className="flex items-center gap-2 text-[10px] text-zinc-400">
                        {state.searchCount > 0 && (
                          <span className="flex items-center gap-0.5">
                            <Search className="w-2.5 h-2.5" /> {state.searchCount}
                          </span>
                        )}
                        {state.fetchCount > 0 && (
                          <span className="flex items-center gap-0.5">
                            <Globe className="w-2.5 h-2.5" /> {state.fetchCount}
                          </span>
                        )}
                      </div>
                    )}
                    {!state.isDone && isProcessing && (
                      <Loader2 className="w-3 h-3 text-zinc-300 animate-spin ml-auto" />
                    )}
                    {state.isDone && !state.isFailed && (
                      <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 ml-auto" />
                    )}
                  </div>
                </div>
              </div>

              {/* Hover tooltip: show last activities (thinking/reasoning) */}
              {isHovered && state.activities.length > 0 && (
                <div className="px-5 pb-3 animate-in fade-in slide-in-from-top-1 duration-200">
                  <div className="bg-zinc-900 rounded-lg p-3 text-[11px] text-zinc-300 font-mono leading-relaxed max-h-[150px] overflow-y-auto">
                    <div className="text-[9px] text-[#D4AF37] font-bold uppercase tracking-wider mb-2">
                      <Terminal className="w-3 h-3 inline mr-1" />
                      Cadena de Pensamiento
                    </div>
                    {state.activities.slice(-8).map((act, i) => {
                      const meta = activityMeta(act.type);
                      return (
                        <div key={i} className="flex items-start gap-2 mb-1 last:mb-0">
                          <span className="shrink-0" style={{ color: meta.color }}>
                            <StatusIcon type={meta.icon} className="w-3 h-3 mt-0.5" />
                          </span>
                          <span className="text-zinc-400 truncate">
                            <span className="text-zinc-500 font-bold">{meta.label}:</span>{' '}
                            {act.detail ? act.detail.slice(0, 120) : '...'}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          );
        })}

        {/* Bottom spacer for scroll */}
        <div ref={cotEndRef} className="h-4" />
      </div>

      {/* Footer: model info */}
      <div className="px-5 py-3 border-t border-zinc-200 bg-white shrink-0">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-6 h-6 rounded-md bg-black flex items-center justify-center">
              <BrainCircuit className="w-3.5 h-3.5 text-[#D4AF37]" />
            </div>
            <div className="flex flex-col">
              <span className="text-[10px] font-bold text-zinc-700">Powered by Kimi K2.5</span>
              <span className="text-[9px] text-zinc-400">8xH200 NVL \u00b7 TP8 \u00b7 32K ctx</span>
            </div>
          </div>
          <span className="text-[9px] text-zinc-400 font-medium">ThotBrain v2.0</span>
        </div>
      </div>
    </div>
  );
};
