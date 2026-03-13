import React, { useEffect, useRef } from 'react';
import { BrainCircuit, CheckCircle2, Network, Sparkles, Terminal, Cpu, GitMerge, Activity, Loader2 } from 'lucide-react';

export const allAgents = [
  { id: 1, name: "Elena Rostova", role: "Ingeniero", avatar: "https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=150&h=150&fit=crop" },
  { id: 2, name: "Marcus Chen", role: "Comercial", avatar: "https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=150&h=150&fit=crop" },
  { id: 3, name: "Sofia Al-Fayed", role: "Experto en Marketing", avatar: "https://images.unsplash.com/photo-1573496359142-b8d87734a5a2?w=150&h=150&fit=crop" },
  { id: 4, name: "David Thorne", role: "Asesor Legal", avatar: "https://images.unsplash.com/photo-1519085360753-af0119f7cbe7?w=150&h=150&fit=crop" },
  { id: 5, name: "Carmen Vega", role: "Asesor Laboral", avatar: "https://images.unsplash.com/photo-1580489944761-15a19d654956?w=150&h=150&fit=crop" }
];

interface SwarmActivityPanelProps {
  agentsData: any[];
  thoughtStream: any[];
  isProcessing: boolean;
}

export const SwarmActivityPanel: React.FC<SwarmActivityPanelProps> = ({ agentsData, thoughtStream, isProcessing }) => {
  const streamEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    streamEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [thoughtStream]);

  const activeAgentIds = agentsData.filter(a => a.status !== 'ESPERANDO').map(a => a.id);

  return (
    <div className="h-full flex flex-col bg-zinc-50/50 border-l border-zinc-200 shadow-[-10px_0_30px_rgba(0,0,0,0.02)]">
      {/* Header: Orchestrator Status */}
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

      {/* Section: Agent Pool */}
      <div className="p-5 border-b border-zinc-200 bg-white shrink-0">
        <div className="flex items-center justify-between mb-4">
          <h4 className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider">Pool de Agentes</h4>
          <span className="text-[10px] font-bold text-[#D4AF37] bg-[#D4AF37]/10 px-2 py-0.5 rounded-full">{activeAgentIds.length} Activos</span>
        </div>
        <div className="flex items-center gap-3 overflow-x-auto pb-2 scrollbar-hide">
          {allAgents.map(agent => {
            const isActive = activeAgentIds.includes(agent.id);
            return (
              <div key={agent.id} className={`flex flex-col items-center gap-2 min-w-[64px] transition-all duration-500 ${isActive ? 'opacity-100 scale-100' : 'opacity-40 scale-95 grayscale'}`}>
                <div className={`relative w-12 h-12 rounded-full overflow-hidden border-2 transition-colors duration-300 ${isActive ? 'border-[#D4AF37] shadow-lg shadow-[#D4AF37]/20' : 'border-zinc-200'}`}>
                  <img src={agent.avatar} alt={agent.name} className="w-full h-full object-cover" referrerPolicy="no-referrer" />
                  {isActive && (
                    <div className="absolute inset-0 border-2 border-[#D4AF37] rounded-full animate-ping opacity-20" />
                  )}
                </div>
                <span className="text-[9px] font-bold text-zinc-700 text-center leading-tight">{agent.name.split(' ')[0]}<br/><span className="text-zinc-400 font-medium">{agent.role}</span></span>
              </div>
            );
          })}
        </div>
      </div>

      {/* Section: Chain of Thought */}
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
          {thoughtStream.map((thought, index) => {
            const isAgent = thought.type === 'agent';
            const agent = isAgent ? allAgents.find(a => a.id === thought.agentId) : null;
            
            return (
              <div key={thought.id} className="relative flex items-start gap-4 animate-in fade-in slide-in-from-bottom-2">
                {/* Timeline Node */}
                <div className="relative z-10 w-7 h-7 rounded-full bg-white border border-zinc-200 shadow-sm flex items-center justify-center shrink-0 mt-0.5">
                  {isAgent && agent ? (
                    <img src={agent.avatar} alt={agent.name} className="w-full h-full rounded-full object-cover" referrerPolicy="no-referrer" />
                  ) : thought.type === 'orchestration' || thought.type === 'activation' ? (
                    <Network className="w-3.5 h-3.5 text-[#D4AF37]" />
                  ) : (
                    <Cpu className="w-3.5 h-3.5 text-zinc-400" />
                  )}
                </div>
                
                {/* Content */}
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
                    {thought.text}
                  </p>
                </div>
              </div>
            );
          })}
          <div ref={streamEndRef} />
        </div>
      </div>
    </div>
  );
};
