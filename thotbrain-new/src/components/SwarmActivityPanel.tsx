import { useEffect, useRef } from 'react';
import { BrainCircuit, CheckCircle2, Network, Terminal, Cpu, Activity, Loader2 } from 'lucide-react';
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

// Map activity types to descriptive tool text
function activityToText(act: AgentActivity): string {
  const d = act.detail || '';
  switch (act.type) {
    case 'search': case 'searching':
      return `Llamando a tool \`googleSearch\` para buscar: ${d}`;
    case 'fetch': case 'fetching':
      return `Llamando a tool \`fetchUrl\` para obtener datos de: ${d}`;
    case 'search_done': case 'fetch_done':
      return `Resultado obtenido: ${d}`;
    case 'start':
      return `Iniciando análisis: ${d}`;
    case 'thinking': case 'reasoning':
      return `Analizando y razonando sobre: ${d}`;
    case 'executing_tools':
      return `Ejecutando ${d}`;
    case 'synthesizing':
      return `Sintetizando conclusiones finales...`;
    case 'conclusion':
      return `Conclusi\u00f3n: ${d}`;
    case 'done':
      return `An\u00e1lisis completado en ${d}`;
    case 'failed':
      return `Error: ${d}`;
    case 'spawn':
      return `Spawning sub-agente: ${d}`;
    default:
      return d;
  }
}

interface SwarmActivityPanelProps {
  activeAgentNames: string[];  // orchestrator names (Iker, Miren, etc.)
  doneAgentNames: string[];
  activities: AgentActivity[];
  isProcessing: boolean;
}

export const SwarmActivityPanel: React.FC<SwarmActivityPanelProps> = ({ activeAgentNames, doneAgentNames, activities, isProcessing }) => {
  const streamEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    streamEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [activities]);

  const activeIds = activeAgentNames.map(n => findAgent(n)?.id).filter(Boolean);
  const doneIds = doneAgentNames.map(n => findAgent(n)?.id).filter(Boolean);

  // Build thought stream from activities
  const thoughtStream: Array<{
    id: string;
    type: 'system' | 'orchestration' | 'agent';
    agentId?: number;
    text: string;
    roleBadge?: string;
  }> = [];

  // System entry if processing but no activities
  if (isProcessing && activities.length === 0) {
    thoughtStream.push({
      id: 'sys-init',
      type: 'system',
      text: 'Analizando prompt: planificando estrategia de agentes...'
    });
  }

  // Orchestrator routing entry
  if (activeIds.length > 0) {
    thoughtStream.push({
      id: 'orch-route',
      type: 'orchestration',
      text: `Ruteo sem\u00e1ntico completado. Activando ${activeIds.length} especialistas requeridos.`
    });
  }

  // Agent activities
  activities.forEach((act, i) => {
    if (act.agent === 'Orchestrator' || act.agent === 'ThotBrain') return;
    const agentDef = findAgent(act.agent);
    if (!agentDef) return;
    thoughtStream.push({
      id: `act-${i}-${act.timestamp}`,
      type: 'agent',
      agentId: agentDef.id,
      text: activityToText(act),
      roleBadge: agentDef.roleBadge,
    });
  });

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
              ) : (
                <>
                  <div className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                  <span className="text-[10px] text-emerald-600 font-bold uppercase tracking-wider">Completado</span>
                </>
              )}
            </div>
          </div>
        </div>
        <button className="w-8 h-8 rounded-lg border border-zinc-200 flex items-center justify-center text-zinc-400 hover:bg-zinc-100 hover:text-zinc-900 transition-colors bg-white shadow-sm">
          <Activity className="w-4 h-4" />
        </button>
      </div>

      {/* Pool de Agentes */}
      <div className="p-5 border-b border-zinc-200 bg-white shrink-0">
        <div className="flex items-center justify-between mb-4">
          <h4 className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider">Pool de Agentes</h4>
          {activeIds.length > 0 && (
            <span className="text-[10px] font-bold text-[#D4AF37] bg-[#D4AF37]/10 px-2 py-0.5 rounded-full">{activeIds.length} Activos</span>
          )}
        </div>
        <div className="flex items-center gap-3 overflow-x-auto pb-2 scrollbar-hide">
          {allAgents.map(agent => {
            const isActive = activeIds.includes(agent.id);
            const isDone = doneIds.includes(agent.id);
            return (
              <div key={agent.id} className={`flex flex-col items-center gap-2 min-w-[64px] transition-all duration-500 ${isActive || isDone ? 'opacity-100 scale-100' : 'opacity-40 scale-95 grayscale'}`}>
                <div className={`relative w-12 h-12 rounded-full overflow-hidden border-2 transition-colors duration-300 ${
                  isDone ? 'border-emerald-400 shadow-lg shadow-emerald-200/30' :
                  isActive ? 'border-[#D4AF37] shadow-lg shadow-[#D4AF37]/20' : 'border-zinc-200'
                }`}>
                  <img src={agent.avatar} alt={agent.name} className="w-full h-full object-cover" referrerPolicy="no-referrer" crossOrigin="anonymous" />
                  {isActive && !isDone && (
                    <div className="absolute inset-0 border-2 border-[#D4AF37] rounded-full animate-ping opacity-20" />
                  )}
                  {isDone && (
                    <div className="absolute -bottom-0.5 -right-0.5 w-4 h-4 bg-emerald-500 border-2 border-white rounded-full flex items-center justify-center shadow-sm">
                      <CheckCircle2 className="w-2.5 h-2.5 text-white" />
                    </div>
                  )}
                </div>
                <span className="text-[9px] font-bold text-zinc-700 text-center leading-tight">
                  {agent.name.split(' ')[0]}
                  <br/>
                  <span className="text-zinc-400 font-medium">{agent.role.length > 12 ? agent.role.slice(0, 10) + '\u2026' : agent.role}</span>
                </span>
              </div>
            );
          })}
        </div>
      </div>

      {/* Cadena de Pensamiento (CoT) */}
      <div className="flex-1 overflow-y-auto p-5">
        <h4 className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider mb-4 flex items-center gap-2">
          <Terminal className="w-3.5 h-3.5" /> Cadena de Pensamiento (CoT)
        </h4>

        <div className="space-y-4 relative before:absolute before:inset-0 before:ml-3.5 before:-translate-x-px md:before:mx-auto md:before:translate-x-0 before:h-full before:w-0.5 before:bg-gradient-to-b before:from-transparent before:via-zinc-200 before:to-transparent">
          {thoughtStream.length === 0 && !isProcessing && (
            <div className="text-xs text-zinc-400 text-center py-8 italic">
              Esperando instrucciones para iniciar la cadena de pensamiento...
            </div>
          )}
          {thoughtStream.map((thought) => {
            const isAgent = thought.type === 'agent';
            const agent = isAgent && thought.agentId ? allAgents.find(a => a.id === thought.agentId) : null;

            return (
              <div key={thought.id} className="relative flex items-start gap-4 animate-in fade-in slide-in-from-bottom-2">
                <div className="relative z-10 w-7 h-7 rounded-full bg-white border border-zinc-200 shadow-sm flex items-center justify-center shrink-0 mt-0.5 overflow-hidden">
                  {isAgent && agent ? (
                    <img src={agent.avatar} alt={agent.name} className="w-full h-full rounded-full object-cover" referrerPolicy="no-referrer" crossOrigin="anonymous" />
                  ) : thought.type === 'orchestration' ? (
                    <Network className="w-3.5 h-3.5 text-[#D4AF37]" />
                  ) : (
                    <Cpu className="w-3.5 h-3.5 text-zinc-400" />
                  )}
                </div>

                <div className="flex-1 min-w-0 bg-white border border-zinc-200/80 rounded-2xl p-3.5 shadow-sm hover:shadow-md transition-shadow">
                  {isAgent && agent ? (
                    <div className="flex items-center gap-2 mb-1.5">
                      <span className="text-xs font-bold text-zinc-900">{agent.name}</span>
                      <span className="text-[9px] font-bold uppercase tracking-wider text-zinc-500 bg-zinc-100 px-1.5 py-0.5 rounded-md">{agent.role}</span>
                    </div>
                  ) : (
                    <div className="flex items-center gap-2 mb-1.5">
                      <span className="text-xs font-bold text-zinc-900">ThotBrain Core</span>
                      <span className="text-[9px] font-bold uppercase tracking-wider text-[#D4AF37] bg-[#D4AF37]/10 px-1.5 py-0.5 rounded-md">
                        {thought.type === 'orchestration' ? 'Orquestador' : 'Sistema'}
                      </span>
                    </div>
                  )}
                  <p className="text-xs text-zinc-600 leading-relaxed font-medium">
                    {thought.text.slice(0, 250)}
                  </p>
                </div>
              </div>
            );
          })}

          {isProcessing && thoughtStream.length > 0 && (
            <div className="relative flex items-start gap-4">
              <div className="relative z-10 w-7 h-7 rounded-full bg-white border border-zinc-200 shadow-sm flex items-center justify-center shrink-0 mt-0.5">
                <Loader2 className="w-3.5 h-3.5 text-[#D4AF37] animate-spin" />
              </div>
              <div className="flex-1 min-w-0 text-xs text-[#D4AF37] font-medium py-2">
                Procesando cadena de pensamiento...
              </div>
            </div>
          )}

          <div ref={streamEndRef} />
        </div>
      </div>
    </div>
  );
};
