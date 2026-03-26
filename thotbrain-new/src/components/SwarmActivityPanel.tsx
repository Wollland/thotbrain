import { useState, useEffect, useRef, useMemo } from 'react';
import { BrainCircuit, CheckCircle2, Network, Terminal, Loader2, Activity, Search, Globe, Brain, Zap, AlertCircle, FileText } from 'lucide-react';
import type { AgentActivity } from '../lib/api';

export const allAgents = [
  { id: 1, name: "Elena Rostova", orchName: "Iker", role: "Ingeniera Senior", roleBadge: "INGENIERA", avatar: "https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=256&h=256&fit=crop&crop=face" },
  { id: 2, name: "Marcus Chen", orchName: "Miren", role: "Analista Comercial", roleBadge: "COMERCIAL", avatar: "https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=256&h=256&fit=crop&crop=face" },
  { id: 3, name: "Sofia Al-Fayed", orchName: "Asier", role: "Estratega de Marketing", roleBadge: "MARKETING", avatar: "https://images.unsplash.com/photo-1573496359142-b8d87734a5a2?w=256&h=256&fit=crop&crop=face" },
  { id: 4, name: "David Thorne", orchName: "Ziortza", role: "Asesor Legal", roleBadge: "LEGAL", avatar: "https://images.unsplash.com/photo-1560250097-0b93528c311a?w=256&h=256&fit=crop&crop=face" },
  { id: 5, name: "Carmen Vega", orchName: "Jon", role: "Consultora Laboral", roleBadge: "LABORAL", avatar: "https://images.unsplash.com/photo-1580489944761-15a19d654956?w=256&h=256&fit=crop&crop=face" },
  { id: 6, name: "Raj Patel", orchName: "Ana", role: "Científico de Datos", roleBadge: "DATA", avatar: "https://images.unsplash.com/photo-1506794778202-cad84cf45f1d?w=256&h=256&fit=crop&crop=face" },
  { id: 7, name: "Yuki Tanaka", orchName: "Unai", role: "Ingeniero de Sistemas", roleBadge: "SISTEMAS", avatar: "https://images.unsplash.com/photo-1500648767791-00dcc994a43e?w=256&h=256&fit=crop&crop=face" },
  { id: 8, name: "Anna Kowalski", orchName: "Leire", role: "Directora de Investigación", roleBadge: "RESEARCH", avatar: "https://images.unsplash.com/photo-1544005313-94ddf0286df2?w=256&h=256&fit=crop&crop=face" },
];

function findAgent(orchName: string) {
  return allAgents.find(a => a.orchName === orchName);
}

function activityMeta(type: string): { icon: string; label: string; color: string } {
  switch (type) {
    case 'start': return { icon: 'zap', label: 'Iniciando', color: '#DA7756' };
    case 'search': case 'searching': return { icon: 'search', label: 'Buscando', color: '#3B82F6' };
    case 'fetch': case 'fetching': return { icon: 'globe', label: 'Leyendo', color: '#8B5CF6' };
    case 'search_done': case 'fetch_done': return { icon: 'check', label: 'Datos obtenidos', color: '#10B981' };
    case 'thinking': case 'reasoning': return { icon: 'brain', label: 'Analizando', color: '#F59E0B' };
    case 'executing_tools': return { icon: 'zap', label: 'Ejecutando', color: '#EC4899' };
    case 'synthesizing': return { icon: 'brain', label: 'Sintetizando', color: '#DA7756' };
    case 'conclusion': return { icon: 'check', label: 'Conclusión', color: '#10B981' };
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
  agentReports?: Record<string, string>;
}

interface AgentState {
  orchName: string;
  agent: typeof allAgents[0];
  task: string;
  status: string;
  statusLabel: string;
  statusColor: string;
  searchCount: number;
  fetchCount: number;
  totalActions: number;
  isDone: boolean;
  isFailed: boolean;
  isActive: boolean;
  lastDetail: string;
  activities: AgentActivity[];
}

export const SwarmActivityPanel: React.FC<SwarmActivityPanelProps> = ({ activeAgentNames, doneAgentNames, activities, isProcessing, agentReports }) => {
  const [expandedReport, setExpandedReport] = useState<string | null>(null);

  // Build per-agent state — ALL 8 AGENTS ALWAYS VISIBLE
  const agentStates = useMemo<AgentState[]>(() => {
    // Start with ALL agents, always
    return allAgents.map(agent => {
      const isActive = activeAgentNames.includes(agent.orchName);
      const isDone = doneAgentNames.includes(agent.orchName);

      const state: AgentState = {
        orchName: agent.orchName,
        agent,
        task: '',
        status: isActive ? 'start' : 'idle',
        statusLabel: isActive ? 'Iniciando' : 'En espera',
        statusColor: isActive ? '#DA7756' : '#A1A1AA',
        searchCount: 0,
        fetchCount: 0,
        totalActions: 0,
        isDone,
        isFailed: false,
        isActive,
        lastDetail: '',
        activities: [],
      };

      // Process activities for this agent
      activities.forEach(act => {
        if (act.agent !== agent.orchName) return;
        state.activities.push(act);
        state.totalActions++;
        state.isActive = true;

        if (act.type === 'start' && act.detail) state.task = act.detail;
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

      if (isDone && state.status !== 'done') {
        state.isDone = true;
        state.status = 'done';
        state.statusLabel = 'Completado';
        state.statusColor = '#10B981';
      }

      return state;
    });
  }, [activeAgentNames, doneAgentNames, activities]);

  // Animated progress tick
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!isProcessing) return;
    const iv = setInterval(() => setTick(t => t + 1), 800);
    return () => clearInterval(iv);
  }, [isProcessing]);

  const getProgress = (state: AgentState): number => {
    if (!state.isActive) return 0;
    if (state.isDone) return 100;
    if (state.totalActions === 0) return Math.min(5 + tick * 2, 15);
    const typeWeights: Record<string, number> = {
      start: 10, searching: 25, search: 25, search_done: 35,
      fetching: 40, fetch: 40, fetch_done: 50,
      thinking: 60, reasoning: 65, executing_tools: 70,
      synthesizing: 80, conclusion: 92, done: 100, failed: 100,
    };
    const base = typeWeights[state.status] || 15;
    const actionBonus = Math.min(state.totalActions * 4, 20);
    const timeBonus = Math.min(tick * 1.2, 15);
    return Math.min(Math.round(base + actionBonus + timeBonus), 98);
  };

  const totalSearches = agentStates.reduce((s, a) => s + a.searchCount, 0);
  const totalFetches = agentStates.reduce((s, a) => s + a.fetchCount, 0);
  const doneCount = agentStates.filter(a => a.isDone).length;
  const activeCount = agentStates.filter(a => a.isActive).length;

  return (
    <div className="h-full flex flex-col bg-[#FAF6F0] border-l border-[#E8E0D4] shadow-[-10px_0_30px_rgba(0,0,0,0.02)]">
      {/* Header */}
      <div className="h-16 px-5 border-b border-zinc-200 flex items-center justify-between bg-white shrink-0">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-black flex items-center justify-center shadow-md shadow-black/10">
            <BrainCircuit className="w-5 h-5 text-[#DA7756]" />
          </div>
          <div className="flex flex-col">
            <span className="font-bold text-sm tracking-tight text-zinc-900">LLM Orchestrator</span>
            <div className="flex items-center gap-1.5">
              {isProcessing ? (
                <>
                  <div className="w-1.5 h-1.5 rounded-full bg-[#DA7756] animate-pulse" />
                  <span className="text-[10px] text-[#DA7756] font-bold uppercase tracking-wider">Procesando</span>
                </>
              ) : doneCount > 0 ? (
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
      </div>

      {/* Stats bar — always visible */}
      <div className="px-5 py-2.5 border-b border-[#E8E0D4] bg-[#FAF6F0] shrink-0">
        <div className="flex items-center justify-between">
          <h4 className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider">Enjambre de Agentes</h4>
          <span className="text-[10px] font-bold text-[#DA7756] bg-[#DA7756]/10 px-2 py-0.5 rounded-full">
            {activeCount > 0 ? `${activeCount} Activos` : `${allAgents.length} Agentes`}
          </span>
        </div>
        {activeCount > 0 && (
          <div className="flex items-center gap-4 mt-1.5">
            <div className="flex items-center gap-1 text-[10px] text-zinc-500">
              <Search className="w-3 h-3 text-blue-500" />
              <span className="font-bold">{totalSearches}</span> búsquedas
            </div>
            <div className="flex items-center gap-1 text-[10px] text-zinc-500">
              <Globe className="w-3 h-3 text-purple-500" />
              <span className="font-bold">{totalFetches}</span> lecturas
            </div>
            <div className="flex items-center gap-1 text-[10px] text-zinc-500">
              <CheckCircle2 className="w-3 h-3 text-emerald-500" />
              <span className="font-bold">{doneCount}/{activeCount}</span> listos
            </div>
          </div>
        )}
      </div>

      {/* Agent List — ALL 8 ALWAYS VISIBLE, FIXED, NO MOVEMENT */}
      <div className="flex-1 overflow-y-auto">
        {agentStates.map((state, idx) => {
          const progress = getProgress(state);
          const hasReport = !!(agentReports?.[state.orchName]);
          const isReportOpen = expandedReport === state.orchName;

          return (
            <div
              key={state.agent.id}
              className={`border-b border-[#E8E0D4]/60 ${
                state.isDone && !state.isFailed ? 'bg-[#F0F7F0]' :
                state.isFailed ? 'bg-red-50/30' :
                'bg-[#FDFBF7]'
              }`}
            >
              <div className="px-4 py-3 flex items-center gap-3">
                {/* Large avatar */}
                <div className="relative shrink-0">
                  <img
                    src={state.agent.avatar}
                    alt={state.agent.name}
                    className={`w-11 h-11 rounded-xl object-cover shadow-sm ${
                      state.isDone && !state.isFailed ? 'ring-2 ring-emerald-400/40' :
                      state.isActive ? 'ring-2 ring-[#DA7756]/40' :
                      'ring-2 ring-[#E8E0D4]'
                    }`}
                    referrerPolicy="no-referrer"
                    crossOrigin="anonymous"
                  />
                  {/* Number badge overlay */}
                  <div className={`absolute -top-1 -left-1 w-5 h-5 rounded-md flex items-center justify-center text-[9px] font-black ${
                    state.isDone && !state.isFailed ? 'bg-emerald-500 text-white' :
                    'bg-zinc-900 text-[#DA7756]'
                  }`}>
                    {String(idx + 1).padStart(2, '0')}
                  </div>
                  {/* Done checkmark */}
                  {state.isDone && !state.isFailed && (
                    <div className="absolute -bottom-0.5 -right-0.5 w-4 h-4 rounded-full bg-emerald-500 flex items-center justify-center">
                      <CheckCircle2 className="w-3 h-3 text-white" />
                    </div>
                  )}
                </div>

                {/* Agent info */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-0.5">
                    <span className={`text-[13px] font-bold truncate ${'text-zinc-900'}`}>
                      {state.agent.name}
                    </span>
                    <span className={`text-[8px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded shrink-0 ${
                      'text-[#DA7756] bg-[#DA7756]/10'
                    }`}>
                      {state.agent.roleBadge}
                    </span>
                  </div>

                  {/* Task or role description */}
                  <p className={`text-[10px] font-medium truncate mb-1.5 ${'text-zinc-500'}`}>
                    {state.task || state.agent.role}
                  </p>

                  {/* Progress bar — always visible */}
                  {(
                    <div className="flex items-center gap-2">
                      <div className="flex-1 h-1.5 bg-zinc-200 rounded-full overflow-hidden">
                        <div
                          className={`h-full rounded-full transition-all duration-700 ease-out ${
                            state.isDone && !state.isFailed ? 'bg-emerald-500' :
                            state.isFailed ? 'bg-red-500' :
                            'bg-[#DA7756]'
                          }`}
                          style={{ width: `${progress}%` }}
                        />
                      </div>
                      <span className={`text-[9px] font-bold shrink-0 tabular-nums ${
                        state.isDone ? 'text-emerald-600' : 'text-[#DA7756]'
                      }`}>
                        {progress}%
                      </span>
                    </div>
                  )}

                  {/* Status + counters */}
                  {(
                    <div className="flex items-center gap-2 mt-1">
                      <div className="flex items-center gap-1" style={{ color: state.statusColor }}>
                        <StatusIcon type={activityMeta(state.status).icon} className="w-3 h-3" />
                        <span className="text-[9px] font-bold uppercase tracking-wider">{state.statusLabel}</span>
                      </div>
                      {state.searchCount > 0 && (
                        <span className="flex items-center gap-0.5 text-[9px] text-zinc-400">
                          <Search className="w-2.5 h-2.5" /> {state.searchCount}
                        </span>
                      )}
                      {state.fetchCount > 0 && (
                        <span className="flex items-center gap-0.5 text-[9px] text-zinc-400">
                          <Globe className="w-2.5 h-2.5" /> {state.fetchCount}
                        </span>
                      )}
                      {hasReport && (
                        <button
                          onClick={() => setExpandedReport(isReportOpen ? null : state.orchName)}
                          className="ml-auto flex items-center gap-0.5 text-[9px] font-bold text-zinc-400 hover:text-[#DA7756] transition-colors"
                        >
                          <FileText className="w-3 h-3" />
                          <span>{isReportOpen ? 'Cerrar' : 'Informe'}</span>
                        </button>
                      )}
                    </div>
                  )}
                </div>
              </div>

              {/* Expanded report */}
              {isReportOpen && hasReport && (
                <div className="px-4 pb-3">
                  <div className="bg-white border border-zinc-200 rounded-lg p-3 text-[11px] text-zinc-600 leading-relaxed max-h-[180px] overflow-y-auto whitespace-pre-wrap">
                    {agentReports![state.orchName]}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Footer */}
      <div className="px-5 py-2.5 border-t border-[#E8E0D4] bg-[#FAF6F0] shrink-0">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-6 h-6 rounded-md bg-black flex items-center justify-center">
              <BrainCircuit className="w-3.5 h-3.5 text-[#DA7756]" />
            </div>
            <div className="flex flex-col">
              <span className="text-[10px] font-bold text-zinc-700">Powered by Kimi K2.5</span>
              <span className="text-[9px] text-zinc-400">8×H200 NVL · TP8 · 32K ctx</span>
            </div>
          </div>
          <span className="text-[9px] text-zinc-400 font-medium">ThotBrain v2.0</span>
        </div>
      </div>
    </div>
  );
};
