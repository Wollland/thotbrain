import React, { useState, useRef, useEffect } from 'react';
import { Send, User, Menu, Settings, Plus, MessageSquare, Sparkles, X, MoreHorizontal, Mail, Database, Activity, Search, ChevronRight, Server, Monitor, Copy, Terminal, Cpu, Network, Layers, CheckCircle2 } from 'lucide-react';

type UIComponentType = 'text' | 'gmail' | 'elasticsearch' | 'agent_swarm';

interface Message {
  id: string;
  role: 'user' | 'agent';
  content: string;
  uiType?: UIComponentType;
  uiData?: any;
}

// --- Data ---
const agentsData = [
  { id: 1, name: 'Iker', role: 'Data Architect', task: 'Extrayendo histórico de cotizaciones (Moderna Inc.)', status: 'Completado', progress: 100, avatar: 'https://images.unsplash.com/photo-1500648767791-00dcc994a43e?w=150&h=150&fit=crop' },
  { id: 2, name: 'Miren', role: 'Financial Analyst', task: 'Procesando balances y P&L Q3 2025', status: 'Procesando', progress: 65, avatar: 'https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=150&h=150&fit=crop' },
  { id: 3, name: 'Asier', role: 'Pipeline Scientist', task: 'Analizando ensayos clínicos fase III (ARNm)', status: 'Generando', progress: 30, avatar: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=150&h=150&fit=crop' },
  { id: 4, name: 'Ziortza', role: 'Market Strategist', task: 'Evaluando cuota de mercado vs BioNTech', status: 'Integrando', progress: 15, avatar: 'https://images.unsplash.com/photo-1438761681033-6461ffad8d80?w=150&h=150&fit=crop' },
  { id: 5, name: 'Jon', role: 'Risk Assessor', task: 'Calculando matriz de riesgos regulatorios', status: 'En cola', progress: 0, avatar: 'https://images.unsplash.com/photo-1506794778202-cad84cf45f1d?w=150&h=150&fit=crop' },
  { id: 6, name: 'Ana', role: 'Visual Designer', task: 'Diseñando gráficos de dispersión y tendencias', status: 'En cola', progress: 0, avatar: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=150&h=150&fit=crop' },
];

// --- Generative UI Components ---

const AgentSwarmWidget = () => {
  const [activeAgent, setActiveAgent] = useState(2);

  return (
    <div className="mt-6 w-full animate-in fade-in slide-in-from-bottom-4 duration-700">
      <div className="bg-white border border-zinc-300 rounded-xl overflow-hidden shadow-xl shadow-black/5">
        <div className="px-5 py-4 border-b border-zinc-200 flex items-center justify-between bg-zinc-50">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-black flex items-center justify-center shadow-inner">
              <Network className="w-4 h-4 text-[#D4AF37]" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-zinc-900 tracking-tight">ThotBrain Swarm</h3>
              <p className="text-[11px] text-zinc-500 font-medium uppercase tracking-wider">6 Subagentes Activos</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
            <span className="text-xs font-bold text-emerald-600 uppercase tracking-wider">Operativo</span>
          </div>
        </div>
        
        <div className="divide-y divide-zinc-100">
          {agentsData.map((agent) => (
            <div 
              key={agent.id} 
              onClick={() => setActiveAgent(agent.id)}
              className={`p-4 flex items-center gap-4 cursor-pointer transition-all duration-200 ${activeAgent === agent.id ? 'bg-zinc-50 border-l-4 border-l-[#D4AF37]' : 'hover:bg-zinc-50/50 border-l-4 border-l-transparent'}`}
            >
              <div className="relative shrink-0">
                <div className={`w-10 h-10 rounded-full overflow-hidden border-2 ${activeAgent === agent.id ? 'border-[#D4AF37]' : 'border-zinc-200'}`}>
                  <img src={agent.avatar} alt={agent.name} className="w-full h-full object-cover" referrerPolicy="no-referrer" />
                </div>
                {agent.progress === 100 && (
                  <div className="absolute -bottom-1 -right-1 w-4 h-4 bg-emerald-500 border-2 border-white rounded-full flex items-center justify-center">
                    <CheckCircle2 className="w-2.5 h-2.5 text-white" />
                  </div>
                )}
              </div>
              
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between mb-1">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-bold text-zinc-900">{agent.name}</span>
                    <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-zinc-100 text-zinc-600 border border-zinc-200">{agent.role}</span>
                  </div>
                  <span className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider">{agent.status}</span>
                </div>
                <div className="flex items-center justify-between gap-4">
                  <span className="text-xs text-zinc-600 truncate font-medium">{agent.task}</span>
                  <div className="flex items-center gap-2 shrink-0 w-24">
                    <div className="h-1.5 flex-1 bg-zinc-100 rounded-full overflow-hidden">
                      <div 
                        className={`h-full rounded-full transition-all duration-1000 ${agent.progress === 100 ? 'bg-emerald-500' : 'bg-[#D4AF37]'}`} 
                        style={{ width: `${agent.progress}%` }}
                      />
                    </div>
                    <span className="text-[10px] font-bold text-zinc-500 w-6 text-right">{agent.progress}%</span>
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

const ThotBrainConsolePanel = () => {
  return (
    <div className="h-full flex flex-col bg-white border-l border-zinc-200 shadow-[-10px_0_30px_rgba(0,0,0,0.02)]">
      <div className="h-16 px-5 border-b border-zinc-200 flex items-center justify-between bg-black text-white shrink-0">
        <div className="flex items-center gap-3">
          <Terminal className="w-5 h-5 text-[#D4AF37]" />
          <div className="flex flex-col">
            <span className="font-bold text-sm tracking-wide uppercase">Chimera Sandbox</span>
            <div className="flex items-center gap-1.5">
              <div className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
              <span className="text-[10px] text-zinc-400 font-mono">Ejecutando subrutinas...</span>
            </div>
          </div>
        </div>
        <button className="w-8 h-8 rounded-lg border border-zinc-700 flex items-center justify-center text-zinc-400 hover:bg-zinc-800 hover:text-white transition-colors">
          <Activity className="w-4 h-4" />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-5 bg-zinc-50/50">
        <div className="bg-white rounded-xl border border-zinc-200 shadow-sm overflow-hidden flex flex-col">
          <div className="px-4 py-3 border-b border-zinc-100 flex items-center justify-between bg-zinc-50">
            <div className="flex items-center gap-2">
              <div className="w-6 h-6 rounded-full overflow-hidden border border-zinc-200">
                <img src={agentsData[1].avatar} alt="Miren" className="w-full h-full object-cover" referrerPolicy="no-referrer" />
              </div>
              <span className="text-xs font-bold text-zinc-800">Miren | Financial Analyst</span>
            </div>
            <span className="flex items-center gap-1 text-[10px] font-bold text-[#D4AF37] uppercase tracking-wider">
              <Sparkles className="w-3 h-3" /> Tarea Activa
            </span>
          </div>
          
          <div className="p-4 border-b border-zinc-100">
            <div className="flex items-center justify-between mb-3">
              <span className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider">Petición (Chimera API)</span>
              <button className="text-zinc-400 hover:text-zinc-600"><Copy className="w-3.5 h-3.5" /></button>
            </div>
            <pre className="text-[11px] font-mono text-zinc-800 bg-zinc-50 p-3 rounded-lg border border-zinc-200 overflow-x-auto">
{`{
  "module": "yahoo_finance_api",
  "action": "get_financials",
  "ticker": "MRNA",
  "period": "Q3_2025",
  "metrics": ["revenue", "net_income", "eps"]
}`}
            </pre>
          </div>

          <div className="p-4">
            <div className="flex items-center justify-between mb-3">
              <span className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider">Respuesta del Sandbox</span>
              <button className="text-zinc-400 hover:text-zinc-600"><Copy className="w-3.5 h-3.5" /></button>
            </div>
            <div className="text-xs text-zinc-700 leading-relaxed border-l-2 border-emerald-400 pl-3">
              Datos financieros obtenidos con éxito. Ingresos Q3 reportados: $1.8B. Beneficio neto: $200M. Preparando vectorización para el informe final.
            </div>
          </div>
        </div>
      </div>

      <div className="p-5 border-t border-zinc-200 bg-white shrink-0">
        <h4 className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider mb-3">Estado del Enjambre</h4>
        <div className="flex items-center gap-3 overflow-x-auto pb-2 scrollbar-hide">
          {agentsData.map(agent => (
            <div key={agent.id} className={`flex flex-col items-center gap-2 min-w-[64px] ${agent.id === 2 ? 'opacity-100' : 'opacity-60 hover:opacity-100 transition-opacity'}`}>
              <div className={`w-10 h-10 rounded-full overflow-hidden border-2 ${agent.id === 2 ? 'border-[#D4AF37] shadow-md shadow-[#D4AF37]/20' : 'border-zinc-200'}`}>
                <img src={agent.avatar} alt={agent.name} className="w-full h-full object-cover" referrerPolicy="no-referrer" />
              </div>
              <span className="text-[10px] font-bold text-zinc-700">{agent.name}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

// --- Main App ---

export default function App() {
  const [messages, setMessages] = useState<Message[]>([
    {
      id: '1',
      role: 'user',
      content: 'Preséntame un informe sobre la empresa Moderna (una famosa farmacéutica). A ser posible, incluye todo tipo de gráficos y capacidades.'
    },
    {
      id: '2',
      role: 'agent',
      content: 'Voy a preparar un informe completo sobre Moderna. Para garantizar la máxima precisión y profundidad, he activado el **ThotBrain Swarm**.\n\nHe desplegado un equipo de subagentes especializados con nombres en clave que trabajarán en paralelo dentro del sandbox de Chimera:',
    },
    {
      id: '3',
      role: 'agent',
      content: 'Asignando tareas y comenzando la extracción de datos en tiempo real:',
      uiType: 'agent_swarm'
    }
  ]);

  return (
    <div className="flex h-screen bg-[#FDFDFD] font-sans text-zinc-900 overflow-hidden selection:bg-[#D4AF37]/30 selection:text-black">
      {/* Sidebar */}
      <div className="w-[280px] bg-white border-r border-zinc-200 flex flex-col shrink-0 z-20 shadow-[5px_0_30px_rgba(0,0,0,0.02)]">
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
          <button className="w-full flex items-center justify-center gap-2 bg-black text-white px-4 py-2.5 rounded-lg hover:bg-zinc-800 transition-all active:scale-[0.98] shadow-md shadow-black/10">
            <Plus className="w-4 h-4 text-[#D4AF37]" />
            <span className="font-bold text-sm">Nuevo Análisis</span>
          </button>
        </div>

        <div className="flex-1 overflow-y-auto py-4">
          <div className="space-y-1 px-3">
            {[
              { icon: Database, label: 'Bases de Datos' },
              { icon: Mail, label: 'Integración Email' },
              { icon: Activity, label: 'Métricas en Vivo' },
              { icon: Layers, label: 'Modelos RAG' },
              { icon: Terminal, label: 'Chimera Scripts' },
              { icon: Network, label: 'Agent Swarm', badge: 'Activo' },
            ].map((item, i) => (
              <button key={i} className={`w-full flex items-center justify-between px-3 py-2.5 rounded-lg transition-colors ${item.badge ? 'bg-zinc-50 text-black' : 'hover:bg-zinc-50 text-zinc-600 hover:text-black'}`}>
                <div className="flex items-center gap-3">
                  <item.icon className={`w-4 h-4 ${item.badge ? 'text-[#D4AF37]' : 'text-zinc-400'}`} />
                  <span className="text-sm font-semibold">{item.label}</span>
                </div>
                {item.badge && (
                  <span className="text-[9px] font-bold bg-[#D4AF37]/10 text-[#D4AF37] px-2 py-0.5 rounded-full uppercase tracking-wider border border-[#D4AF37]/20">{item.badge}</span>
                )}
              </button>
            ))}
          </div>

          <div className="mt-8">
            <div className="px-6 text-[10px] font-bold text-zinc-400 uppercase tracking-wider mb-3">
              Historial de Sesiones
            </div>
            <div className="space-y-1 px-3">
              <button className="w-full text-left px-3 py-2.5 rounded-lg bg-zinc-100/80 text-sm font-bold text-zinc-900 border border-zinc-200/50">Informe Moderna Inc.</button>
              <button className="w-full text-left px-3 py-2.5 rounded-lg hover:bg-zinc-50 text-sm font-medium text-zinc-500 transition-colors">Análisis Novo Nordisk</button>
              <button className="w-full text-left px-3 py-2.5 rounded-lg hover:bg-zinc-50 text-sm font-medium text-zinc-500 transition-colors">Comparativa Modelos LLM</button>
              <button className="w-full text-left px-3 py-2.5 rounded-lg hover:bg-zinc-50 text-sm font-medium text-zinc-500 transition-colors">Auditoría de Seguridad Q3</button>
            </div>
          </div>
        </div>

        <div className="p-4 border-t border-zinc-200 bg-zinc-50">
          <button className="flex items-center justify-between w-full px-3 py-2 rounded-xl hover:bg-white border border-transparent hover:border-zinc-200 transition-all shadow-sm">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-full bg-black text-[#D4AF37] flex items-center justify-center text-xs font-bold shadow-inner">
                JS
              </div>
              <div className="flex flex-col text-left">
                <span className="text-sm font-bold text-zinc-900">Jorge S.</span>
                <span className="text-[10px] text-zinc-500 font-medium">Enterprise Plan</span>
              </div>
            </div>
            <Settings className="w-4 h-4 text-zinc-400" />
          </button>
        </div>
      </div>

      {/* Main Chat Area */}
      <div className="flex-1 flex flex-col relative min-w-[500px] bg-[#FDFDFD]">
        <header className="h-16 flex items-center px-8 border-b border-zinc-100 bg-white/50 backdrop-blur-sm sticky top-0 z-10">
          <div className="flex items-center gap-2 text-sm font-bold text-zinc-800">
            <span className="text-zinc-400">Sesiones</span>
            <ChevronRight className="w-4 h-4 text-zinc-300" />
            <span>Informe Moderna Inc.</span>
          </div>
        </header>

        <div className="flex-1 overflow-y-auto p-8 scroll-smooth pb-40">
          <div className="max-w-3xl mx-auto space-y-10">
            {messages.map((msg) => (
              <div key={msg.id} className={`flex gap-5 ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                {msg.role === 'agent' && (
                  <div className="w-10 h-10 rounded-xl bg-black flex items-center justify-center shrink-0 mt-1 shadow-lg shadow-black/10 border border-zinc-800">
                    <Sparkles className="w-5 h-5 text-[#D4AF37]" />
                  </div>
                )}
                
                <div className={`flex flex-col ${msg.role === 'user' ? 'items-end' : 'items-start'} max-w-[85%]`}>
                  {msg.role === 'agent' && (
                    <span className="text-[10px] font-bold text-zinc-400 mb-2 ml-1 uppercase tracking-wider">ThotBrain</span>
                  )}
                  <div className={`text-[15px] leading-relaxed whitespace-pre-wrap ${
                    msg.role === 'user'
                      ? 'bg-zinc-100 text-zinc-900 px-6 py-4 rounded-2xl font-medium border border-zinc-200/50'
                      : 'text-zinc-800 font-medium'
                  }`}>
                    {msg.content}
                  </div>
                  
                  {msg.role === 'agent' && msg.id === '2' && (
                    <div className="mt-5 w-full max-w-md border border-zinc-200 rounded-xl overflow-hidden shadow-sm bg-white">
                      <div className="px-4 py-2 bg-zinc-50 border-b border-zinc-100 text-[10px] font-bold text-zinc-500 uppercase tracking-wider">
                        Inicializando Subagentes
                      </div>
                      {agentsData.map((agent, i) => (
                        <div key={i} className="flex items-center gap-4 px-4 py-3 border-b border-zinc-100 last:border-0 hover:bg-zinc-50 transition-colors">
                          <div className="w-6 h-6 rounded-full overflow-hidden border border-zinc-200 shrink-0">
                            <img src={agent.avatar} alt={agent.name} className="w-full h-full object-cover" referrerPolicy="no-referrer" />
                          </div>
                          <div className="flex flex-col flex-1">
                            <span className="text-sm font-bold text-zinc-900">{agent.name}</span>
                            <span className="text-[10px] text-zinc-500 font-medium">{agent.role}</span>
                          </div>
                          <div className="flex items-center gap-1 text-[10px] font-bold text-emerald-600 bg-emerald-50 px-2 py-1 rounded-md">
                            <CheckCircle2 className="w-3 h-3" /> Listo
                          </div>
                        </div>
                      ))}
                    </div>
                  )}

                  {msg.uiType === 'agent_swarm' && <AgentSwarmWidget />}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Input Area */}
        <div className="absolute bottom-8 left-1/2 -translate-x-1/2 w-full max-w-3xl px-8">
          <div className="bg-white rounded-2xl shadow-[0_10px_40px_rgba(0,0,0,0.08)] border border-zinc-200 p-3 flex flex-col gap-3">
            <div className="flex items-center justify-between px-2">
              <div className="text-xs font-medium text-zinc-500 flex items-center gap-2">
                <div className="w-2 h-2 rounded-full bg-[#D4AF37] animate-pulse" />
                El enjambre está procesando la tarea. Puedes añadir instrucciones adicionales.
              </div>
              <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-zinc-100 text-zinc-600 text-[10px] font-bold uppercase tracking-wider border border-zinc-200">
                <Cpu className="w-3 h-3" /> ThotBrain Core
              </div>
            </div>
            
            <div className="flex items-center gap-2 bg-zinc-50 rounded-xl p-1 border border-zinc-200 focus-within:border-[#D4AF37] focus-within:ring-2 focus-within:ring-[#D4AF37]/20 transition-all">
              <button className="w-10 h-10 rounded-lg flex items-center justify-center text-zinc-400 hover:text-black hover:bg-zinc-200 transition-colors shrink-0">
                <Plus className="w-5 h-5" />
              </button>
              <input 
                type="text" 
                placeholder="Añade un comentario o redirige a los agentes..." 
                className="flex-1 bg-transparent border-none focus:ring-0 text-sm font-medium text-zinc-800 placeholder:text-zinc-400 px-2"
              />
              <button className="w-10 h-10 rounded-lg bg-black text-[#D4AF37] flex items-center justify-center shrink-0 hover:bg-zinc-800 transition-colors shadow-md">
                <Send className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Right Panel - Chimera Sandbox */}
      <div className="w-[420px] shrink-0 hidden xl:block z-20">
        <ThotBrainConsolePanel />
      </div>
    </div>
  );
}
