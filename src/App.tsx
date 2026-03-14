import React, { useState, useRef, useEffect } from 'react';
import { Send, User, Menu, Settings, Plus, MessageSquare, Sparkles, X, MoreHorizontal, Mail, Database, Activity, Search, ChevronRight, Server, Monitor, Copy, Terminal, Cpu, Network, Layers, CheckCircle2, Plug, Loader2, Mic } from 'lucide-react';

import { DynamicRenderer, DynamicBlock } from './components/DynamicRenderer';
import { MCPConnectorsModal } from './components/MCPConnectorsModal';
import { SwarmActivityPanel } from './components/SwarmActivityPanel';
import { runAgentSwarm, AgentProgress } from './services/geminiService';

type UIComponentType = 'text' | 'gmail' | 'elasticsearch' | 'agent_swarm' | 'dynamic_results' | 'thinking';

interface Message {
  id: string;
  role: 'user' | 'agent';
  content: string;
  uiType?: UIComponentType;
  uiData?: any;
}

// --- Data ---
const initialAgentsData = [
  {
    id: 1,
    name: "Elena Rostova",
    role: "Ingeniero",
    status: "ESPERANDO",
    task: "Análisis de viabilidad técnica",
    contribution: "Esperando instrucciones...",
    progress: 0,
    avatar: "https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=150&h=150&fit=crop"
  },
  {
    id: 2,
    name: "Marcus Chen",
    role: "Comercial",
    status: "ESPERANDO",
    task: "Proyección de ventas y mercado",
    contribution: "Esperando instrucciones...",
    progress: 0,
    avatar: "https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=150&h=150&fit=crop"
  },
  {
    id: 3,
    name: "Sofia Al-Fayed",
    role: "Experto en Marketing",
    status: "ESPERANDO",
    task: "Estudio de mercado",
    contribution: "Esperando instrucciones...",
    progress: 0,
    avatar: "https://images.unsplash.com/photo-1573496359142-b8d87734a5a2?w=150&h=150&fit=crop"
  },
  {
    id: 4,
    name: "David Thorne",
    role: "Asesor Legal",
    status: "ESPERANDO",
    task: "Cumplimiento normativo",
    contribution: "Esperando instrucciones...",
    progress: 0,
    avatar: "https://images.unsplash.com/photo-1519085360753-af0119f7cbe7?w=150&h=150&fit=crop"
  },
  {
    id: 5,
    name: "Carmen Vega",
    role: "Asesor Laboral",
    status: "ESPERANDO",
    task: "Estructura organizativa",
    contribution: "Esperando instrucciones...",
    progress: 0,
    avatar: "https://images.unsplash.com/photo-1580489944761-15a19d654956?w=150&h=150&fit=crop"
  }
];

// --- Generative UI Components ---

const AgentSwarmWidget = () => {
  const [activeAgent, setActiveAgent] = useState(2);

  return (
    <div className="mt-6 w-full animate-in fade-in slide-in-from-bottom-4 duration-700">
      <div className="bg-white border border-zinc-200/80 rounded-[24px] overflow-hidden shadow-sm">
        <div className="px-6 py-5 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div className="w-10 h-10 rounded-2xl bg-black flex items-center justify-center shadow-md shadow-black/10">
              <Network className="w-5 h-5 text-[#D4AF37]" />
            </div>
            <div>
              <h3 className="text-base font-bold text-zinc-900 tracking-tight">ThotBrain Swarm</h3>
              <p className="text-[11px] text-zinc-500 font-medium uppercase tracking-wider mt-0.5">5 Especialistas Activos</p>
            </div>
          </div>
          <div className="flex items-center gap-2 px-3 py-1.5 bg-emerald-50 rounded-full border border-emerald-100">
            <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
            <span className="text-[10px] font-bold text-emerald-600 uppercase tracking-wider">Operativo</span>
          </div>
        </div>
        
        <div className="p-2 bg-zinc-50/50 border-t border-zinc-100/80 flex flex-col gap-1">
          {agentsData.map((agent) => (
            <div 
              key={agent.id} 
              onClick={() => setActiveAgent(agent.id)}
              className={`px-4 py-3.5 rounded-2xl flex flex-col gap-3 cursor-pointer transition-all duration-300 ${activeAgent === agent.id ? 'bg-white shadow-[0_2px_10px_rgba(0,0,0,0.04)] border border-zinc-200/60' : 'hover:bg-zinc-100/50 border border-transparent'}`}
            >
              <div className="flex items-center gap-4">
                <div className="relative shrink-0">
                  <div className={`w-10 h-10 rounded-full overflow-hidden border-2 transition-colors duration-300 ${activeAgent === agent.id ? 'border-[#D4AF37]' : 'border-transparent'}`}>
                    <img src={agent.avatar} alt={agent.name} className="w-full h-full object-cover" referrerPolicy="no-referrer" />
                  </div>
                  {agent.progress === 100 && (
                    <div className="absolute -bottom-1 -right-1 w-4 h-4 bg-emerald-500 border-2 border-white rounded-full flex items-center justify-center shadow-sm">
                      <CheckCircle2 className="w-2.5 h-2.5 text-white" />
                    </div>
                  )}
                </div>
                
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between mb-1.5">
                    <div className="flex items-center gap-2.5">
                      <span className="text-sm font-bold text-zinc-900">{agent.name}</span>
                      <span className="text-[10px] font-semibold px-2 py-0.5 rounded-md bg-zinc-100/80 text-zinc-600">{agent.role}</span>
                    </div>
                    <span className={`text-[10px] font-bold uppercase tracking-wider ${activeAgent === agent.id ? 'text-[#D4AF37]' : 'text-zinc-400'}`}>{agent.status}</span>
                  </div>
                  <div className="flex items-center justify-between gap-4">
                    <span className="text-xs text-zinc-500 truncate font-medium">{agent.task}</span>
                    <div className="flex items-center gap-3 shrink-0 w-28">
                      <div className="h-1 flex-1 bg-zinc-100 rounded-full overflow-hidden">
                        <div 
                          className={`h-full rounded-full transition-all duration-1000 ${agent.progress === 100 ? 'bg-emerald-500' : 'bg-[#D4AF37]'}`} 
                          style={{ width: `${agent.progress}%` }}
                        />
                      </div>
                      <span className="text-[10px] font-bold text-zinc-500 w-7 text-right">{agent.progress}%</span>
                    </div>
                  </div>
                </div>
              </div>
              
              {activeAgent === agent.id && (
                <div className="pl-14 pr-2 pb-1 animate-in fade-in slide-in-from-top-2 duration-300">
                  <div className="p-3 bg-zinc-50 rounded-xl border border-zinc-100">
                    <p className="text-xs text-zinc-600 leading-relaxed">
                      <span className="font-bold text-zinc-900 mr-1">Aportación:</span>
                      {agent.contribution}
                    </p>
                  </div>
                </div>
              )}
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
          <div className="w-10 h-10 rounded-lg overflow-hidden border border-zinc-700 shrink-0 shadow-lg shadow-[#D4AF37]/20">
            <img src="https://images.unsplash.com/photo-1550751827-4bd374c3f58b?w=150&h=150&fit=crop" alt="Computer" className="w-full h-full object-cover" referrerPolicy="no-referrer" />
          </div>
          <div className="flex flex-col">
            <span className="font-bold text-sm tracking-wide uppercase text-[#D4AF37]">Computer</span>
            <div className="flex items-center gap-1.5">
              <div className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
              <span className="text-[10px] text-zinc-400 font-mono uppercase tracking-wider">Canal de ejecución</span>
            </div>
          </div>
        </div>
        <button className="w-8 h-8 rounded-lg border border-zinc-700 flex items-center justify-center text-zinc-400 hover:bg-zinc-800 hover:text-white transition-colors">
          <Monitor className="w-4 h-4" />
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
              <span className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider">Petición (Computer)</span>
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
              <span className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider">Respuesta del Computer</span>
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
  const [isMCPModalOpen, setIsMCPModalOpen] = useState(false);
  const [inputValue, setInputValue] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [agentsData, setAgentsData] = useState(initialAgentsData);
  const [thoughtStream, setThoughtStream] = useState<any[]>([]);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const recognitionRef = useRef<any>(null);
  const originalInputRef = useRef('');
  
  const [messages, setMessages] = useState<Message[]>([
    {
      id: '1',
      role: 'agent',
      content: 'Hola Jorge. Soy ThotBrain. ¿Qué análisis o tarea quieres que el enjambre de agentes realice hoy?'
    }
  ]);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  useEffect(() => {
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (SpeechRecognition) {
      recognitionRef.current = new SpeechRecognition();
      recognitionRef.current.continuous = true;
      recognitionRef.current.interimResults = true;
      recognitionRef.current.lang = 'es-ES';

      recognitionRef.current.onresult = (event: any) => {
        let interimTranscript = '';
        let finalTranscript = '';

        for (let i = event.resultIndex; i < event.results.length; ++i) {
          if (event.results[i].isFinal) {
            finalTranscript += event.results[i][0].transcript;
          } else {
            interimTranscript += event.results[i][0].transcript;
          }
        }

        if (finalTranscript) {
          originalInputRef.current += finalTranscript + ' ';
        }
        
        const newText = originalInputRef.current + interimTranscript;
        setInputValue(newText);
        
        const textarea = document.getElementById('chat-input');
        if (textarea) {
          textarea.style.height = 'auto';
          textarea.style.height = `${Math.min(textarea.scrollHeight, 300)}px`;
        }
      };

      recognitionRef.current.onerror = (event: any) => {
        console.error('Speech recognition error', event.error);
        setIsListening(false);
      };

      recognitionRef.current.onend = () => {
        setIsListening(false);
      };
    }
    
    return () => {
      if (recognitionRef.current) {
        recognitionRef.current.stop();
      }
    };
  }, []);

  const toggleListening = () => {
    if (!recognitionRef.current) {
      alert('Tu navegador no soporta el reconocimiento de voz nativo. Por favor, usa Chrome o Edge.');
      return;
    }
    
    if (isListening) {
      recognitionRef.current.stop();
      setIsListening(false);
    } else {
      originalInputRef.current = inputValue ? inputValue + ' ' : '';
      try {
        recognitionRef.current.start();
        setIsListening(true);
      } catch (e) {
        console.error(e);
      }
    }
  };

  const handleSendMessage = async () => {
    if (!inputValue.trim() || isProcessing) return;

    const userMsg = inputValue.trim();
    const newMessage: Message = {
      id: Date.now().toString(),
      role: 'user',
      content: userMsg
    };

    const thinkingId = Date.now().toString() + 'thinking';

    setMessages(prev => [
      ...prev, 
      newMessage,
      {
        id: thinkingId,
        role: 'agent',
        content: '',
        uiType: 'thinking'
      }
    ]);
    
    setInputValue('');
    const textarea = document.getElementById('chat-input');
    if (textarea) textarea.style.height = 'auto';
    setIsProcessing(true);
    setThoughtStream([]);
    
    // Reset agents
    setAgentsData(initialAgentsData);

    try {
      const dynamicBlocks = await runAgentSwarm(
        userMsg,
        (progressUpdate) => {
          setAgentsData(prev => prev.map(agent => 
            agent.id === progressUpdate.id 
              ? { ...agent, ...progressUpdate } 
              : agent
          ));
        },
        (thought) => {
          setThoughtStream(prev => [...prev, thought]);
        }
      );

      setMessages(prev => {
        const filtered = prev.filter(m => m.id !== thinkingId);
        return [...filtered, {
          id: Date.now().toString() + 'res',
          role: 'agent',
          content: 'He analizado tu petición utilizando el enjambre de agentes y los conectores MCP. Aquí tienes los resultados renderizados dinámicamente:',
          uiType: 'dynamic_results',
          uiData: dynamicBlocks
        }];
      });
    } catch (error: any) {
      console.error(error);
      setMessages(prev => {
        const filtered = prev.filter(m => m.id !== thinkingId);
        return [...filtered, {
          id: Date.now().toString() + 'err',
          role: 'agent',
          content: `Hubo un error al procesar la solicitud con Gemini API: ${error?.message || 'Error desconocido'}`
        }];
      });
    } finally {
      setIsProcessing(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage();
    }
  };

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
              { icon: Terminal, label: 'Computer Scripts' },
              { icon: Network, label: 'Agent Swarm', badge: 'Activo' },
              { icon: Plug, label: 'Conectores MCP', action: () => setIsMCPModalOpen(true) },
            ].map((item, i) => (
              <button 
                key={i} 
                onClick={item.action}
                className={`w-full flex items-center justify-between px-3 py-2.5 rounded-lg transition-colors ${item.badge ? 'bg-zinc-50 text-black' : 'hover:bg-zinc-50 text-zinc-600 hover:text-black'}`}
              >
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
          <div className="max-w-4xl mx-auto space-y-10">
            {messages.map((msg) => (
              <div key={msg.id} className={`flex gap-5 ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                {msg.role === 'agent' && (
                  <div className="w-10 h-10 rounded-xl bg-black flex items-center justify-center shrink-0 mt-1 shadow-lg shadow-black/10 border border-zinc-800">
                    <Sparkles className="w-5 h-5 text-[#D4AF37]" />
                  </div>
                )}
                
                <div className={`flex flex-col ${msg.role === 'user' ? 'items-end' : 'items-start'} max-w-[95%]`}>
                  {msg.role === 'agent' && (
                    <span className="text-[10px] font-bold text-zinc-400 mb-2 ml-1 uppercase tracking-wider">ThotBrain</span>
                  )}
                  
                  {msg.uiType === 'thinking' ? (
                    <div className="flex items-center gap-3 text-zinc-500 font-medium text-sm animate-pulse bg-zinc-50 px-5 py-3.5 rounded-2xl border border-zinc-200/50">
                      <Loader2 className="w-4 h-4 animate-spin text-[#D4AF37]" />
                      ThotBrain está orquestando el enjambre de agentes...
                    </div>
                  ) : (
                    <div className={`text-[15px] leading-relaxed whitespace-pre-wrap ${
                      msg.role === 'user'
                        ? 'bg-zinc-100 text-zinc-900 px-6 py-4 rounded-2xl font-medium border border-zinc-200/50'
                        : 'text-zinc-800 font-medium'
                    }`}>
                      {msg.content}
                    </div>
                  )}

                  {msg.uiType === 'dynamic_results' && msg.uiData && (
                    <div className="mt-6 w-full">
                      <DynamicRenderer blocks={msg.uiData} />
                    </div>
                  )}
                </div>
              </div>
            ))}
            <div ref={messagesEndRef} />
          </div>
        </div>

        {/* Input Area */}
        <div className="absolute bottom-8 left-1/2 -translate-x-1/2 w-full max-w-4xl px-8">
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
            
            <div className="flex items-end gap-2 bg-zinc-50 rounded-xl p-2 border border-zinc-200 focus-within:border-[#D4AF37] focus-within:ring-2 focus-within:ring-[#D4AF37]/20 transition-all shadow-inner">
              <button className="w-10 h-10 rounded-lg flex items-center justify-center text-zinc-400 hover:text-black hover:bg-zinc-200 transition-colors shrink-0 mb-0.5">
                <Plus className="w-5 h-5" />
              </button>
              <button 
                onClick={toggleListening}
                className={`w-10 h-10 rounded-lg flex items-center justify-center transition-colors shrink-0 mb-0.5 ${
                  isListening 
                    ? 'bg-red-100 text-red-500 hover:bg-red-200 animate-pulse' 
                    : 'text-zinc-400 hover:text-black hover:bg-zinc-200'
                }`}
                title={isListening ? "Detener dictado" : "Dictado por voz"}
              >
                <Mic className="w-5 h-5" />
              </button>
              <textarea 
                id="chat-input"
                value={inputValue}
                onChange={(e) => {
                  setInputValue(e.target.value);
                  e.target.style.height = 'auto';
                  e.target.style.height = `${Math.min(e.target.scrollHeight, 300)}px`;
                }}
                onKeyDown={handleKeyDown}
                placeholder="Escribe o dicta tu mensaje aquí (Shift + Enter para nueva línea)..." 
                className="flex-1 bg-transparent border-none focus:ring-0 text-[15px] font-medium text-zinc-800 placeholder:text-zinc-400 px-2 py-2.5 outline-none resize-none min-h-[44px] max-h-[300px] overflow-y-auto leading-relaxed"
                rows={1}
              />
              <button 
                onClick={handleSendMessage}
                disabled={!inputValue.trim() || isProcessing}
                className={`w-10 h-10 rounded-lg flex items-center justify-center shrink-0 transition-all mb-0.5 ${
                  inputValue.trim() && !isProcessing
                    ? 'bg-black text-[#D4AF37] hover:bg-zinc-800 shadow-md' 
                    : 'bg-zinc-200 text-zinc-400 cursor-not-allowed'
                }`}
              >
                {isProcessing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Right Panel - Orchestration & Chain of Thought */}
      <div className="w-[420px] shrink-0 hidden xl:block z-20">
        <SwarmActivityPanel agentsData={agentsData} thoughtStream={thoughtStream} isProcessing={isProcessing} />
      </div>

      {/* Modals */}
      <MCPConnectorsModal isOpen={isMCPModalOpen} onClose={() => setIsMCPModalOpen(false)} />
    </div>
  );
}
