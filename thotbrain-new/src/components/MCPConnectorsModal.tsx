import { useState, useEffect } from 'react';
import { X, Settings, Plus, Github, Slack, Database, FileText, Plug, CheckCircle2, AlertCircle, Power, Download, Loader2, Search, Briefcase, HardDrive, Headset, PieChart, Globe } from 'lucide-react';

interface MCPConnectorsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const MCPConnectorsModal: React.FC<MCPConnectorsModalProps> = ({ isOpen, onClose }) => {
  const [activeTab, setActiveTab] = useState<'installed' | 'discover'>('installed');
  const [isDiscoverLoading, setIsDiscoverLoading] = useState(false);
  const [discoverConnectors, setDiscoverConnectors] = useState<any[]>([]);
  const [installing, setInstalling] = useState<Record<string, boolean>>({});
  const [installed, setInstalled] = useState<Record<string, boolean>>({});

  const handleInstall = (id: string) => {
    setInstalling(prev => ({ ...prev, [id]: true }));
    setTimeout(() => {
      setInstalling(prev => ({ ...prev, [id]: false }));
      setInstalled(prev => ({ ...prev, [id]: true }));
    }, 1500);
  };

  useEffect(() => {
    if (activeTab === 'discover' && discoverConnectors.length === 0) {
      setIsDiscoverLoading(true);
      const timer = setTimeout(() => {
        setDiscoverConnectors([
          { id: 'jira', name: 'Jira Software', description: 'Gestión de proyectos y tickets ágiles.', icon: Briefcase, type: 'official', downloads: '125k' },
          { id: 'gdrive', name: 'Google Drive', description: 'Acceso a documentos, hojas de cálculo y presentaciones.', icon: HardDrive, type: 'official', downloads: '340k' },
          { id: 'zendesk', name: 'Zendesk Support', description: 'Atención al cliente y resolución de tickets.', icon: Headset, type: 'official', downloads: '85k' },
          { id: 'hubspot', name: 'HubSpot CRM', description: 'Inbound marketing, ventas y servicio al cliente.', icon: PieChart, type: 'community', downloads: '42k' },
          { id: 'weather', name: 'Global Weather API', description: 'Datos meteorológicos en tiempo real para logística.', icon: Globe, type: 'community', downloads: '12k' },
        ]);
        setIsDiscoverLoading(false);
      }, 800);
      return () => clearTimeout(timer);
    }
  }, [activeTab, discoverConnectors.length]);

  if (!isOpen) return null;

  const connectors = [
    { id: 'github', name: 'GitHub MCP', description: 'Acceso a repositorios, issues y PRs para el Ingeniero.', icon: Github, status: 'connected', type: 'official' },
    { id: 'slack', name: 'Slack Integration', description: 'Notificaciones y comandos de chat bidireccionales.', icon: Slack, status: 'connected', type: 'official' },
    { id: 'notion', name: 'Notion Workspace', description: 'Lectura/escritura de base de conocimiento corporativa.', icon: FileText, status: 'disconnected', type: 'official' },
    { id: 'salesforce', name: 'Salesforce CRM', description: 'Datos de clientes y proyecciones para el Comercial.', icon: Database, status: 'error', type: 'official' },
    { id: 'custom-erp', name: 'ERP Interno (Legacy)', description: 'Conector MCP personalizado vía API REST local.', icon: Plug, status: 'connected', type: 'custom' },
  ];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-zinc-900/40 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="bg-white rounded-3xl shadow-2xl w-full max-w-3xl overflow-hidden flex flex-col max-h-[85vh] animate-in zoom-in-95 slide-in-from-bottom-4 duration-300 border border-zinc-200/80">
        <div className="px-6 py-5 border-b border-zinc-100 flex items-center justify-between bg-zinc-50/50">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 rounded-2xl bg-black flex items-center justify-center shadow-md shadow-black/10">
              <Plug className="w-6 h-6 text-[#D4AF37]" />
            </div>
            <div>
              <h2 className="text-xl font-bold text-zinc-900 tracking-tight">Conectores MCP</h2>
              <p className="text-xs text-zinc-500 font-medium mt-0.5">Model Context Protocol &bull; Gestiona las herramientas del enjambre</p>
            </div>
          </div>
          <button onClick={onClose} className="w-8 h-8 rounded-full bg-zinc-100 flex items-center justify-center text-zinc-500 hover:bg-zinc-200 hover:text-zinc-900 transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="px-6 py-4 border-b border-zinc-100 flex items-center justify-between">
          <div className="flex items-center gap-1 bg-zinc-100/80 p-1 rounded-xl border border-zinc-200/50">
            <button onClick={() => setActiveTab('installed')} className={`px-4 py-1.5 rounded-lg text-sm font-bold transition-all ${activeTab === 'installed' ? 'bg-white text-zinc-900 shadow-sm' : 'text-zinc-500 hover:text-zinc-700'}`}>
              Instalados (5)
            </button>
            <button onClick={() => setActiveTab('discover')} className={`px-4 py-1.5 rounded-lg text-sm font-bold transition-all ${activeTab === 'discover' ? 'bg-white text-zinc-900 shadow-sm' : 'text-zinc-500 hover:text-zinc-700'}`}>
              Descubrir
            </button>
          </div>
          <button className="flex items-center gap-2 bg-black text-white px-4 py-2 rounded-xl hover:bg-zinc-800 transition-all text-sm font-bold shadow-md shadow-black/10">
            <Plus className="w-4 h-4 text-[#D4AF37]" />
            Añadir Custom MCP
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-6 bg-zinc-50/30">
          {activeTab === 'installed' ? (
            <div className="grid grid-cols-1 gap-4">
              {connectors.map((connector) => (
                <div key={connector.id} className="bg-white border border-zinc-200/80 rounded-2xl p-4 flex items-center justify-between hover:border-zinc-300 transition-colors shadow-sm">
                  <div className="flex items-center gap-4">
                    <div className={`w-12 h-12 rounded-xl flex items-center justify-center border ${connector.type === 'custom' ? 'bg-zinc-900 border-zinc-800 text-[#D4AF37]' : 'bg-zinc-50 border-zinc-200 text-zinc-700'}`}>
                      <connector.icon className="w-6 h-6" />
                    </div>
                    <div>
                      <div className="flex items-center gap-2 mb-1">
                        <h3 className="text-sm font-bold text-zinc-900">{connector.name}</h3>
                        {connector.type === 'custom' && (
                          <span className="text-[9px] font-bold bg-zinc-100 text-zinc-600 px-2 py-0.5 rounded-md uppercase tracking-wider border border-zinc-200">Custom</span>
                        )}
                      </div>
                      <p className="text-xs text-zinc-500 font-medium">{connector.description}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-6">
                    <div className="flex items-center gap-2 w-28 justify-end">
                      {connector.status === 'connected' && (
                        <span className="flex items-center gap-1.5 text-[11px] font-bold text-emerald-600 uppercase tracking-wider">
                          <CheckCircle2 className="w-3.5 h-3.5" /> Conectado
                        </span>
                      )}
                      {connector.status === 'disconnected' && (
                        <span className="flex items-center gap-1.5 text-[11px] font-bold text-zinc-400 uppercase tracking-wider">
                          <Power className="w-3.5 h-3.5" /> Inactivo
                        </span>
                      )}
                      {connector.status === 'error' && (
                        <span className="flex items-center gap-1.5 text-[11px] font-bold text-red-500 uppercase tracking-wider">
                          <AlertCircle className="w-3.5 h-3.5" /> Auth Error
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-2 border-l border-zinc-100 pl-6">
                      <button className="w-9 h-9 rounded-xl flex items-center justify-center text-zinc-400 hover:bg-zinc-100 hover:text-zinc-900 transition-colors">
                        <Settings className="w-4 h-4" />
                      </button>
                      <button className={`w-12 h-7 rounded-full relative transition-colors ${connector.status === 'connected' ? 'bg-emerald-500' : 'bg-zinc-200'}`}>
                        <div className={`absolute top-1 w-5 h-5 rounded-full bg-white shadow-sm transition-all ${connector.status === 'connected' ? 'left-6' : 'left-1'}`} />
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="flex flex-col h-full">
              <div className="relative mb-6">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-400" />
                <input type="text" placeholder="Buscar conectores MCP..." className="w-full bg-white border border-zinc-200 rounded-xl pl-10 pr-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#D4AF37]/50 focus:border-[#D4AF37] transition-all" />
              </div>
              {isDiscoverLoading ? (
                <div className="flex-1 flex flex-col items-center justify-center text-zinc-400 gap-3 py-12">
                  <Loader2 className="w-6 h-6 animate-spin text-[#D4AF37]" />
                  <span className="text-sm font-medium">Cargando marketplace...</span>
                </div>
              ) : (
                <div className="grid grid-cols-1 gap-4">
                  {discoverConnectors.map((connector) => (
                    <div key={connector.id} className="bg-white border border-zinc-200/80 rounded-2xl p-4 flex items-center justify-between hover:border-zinc-300 transition-colors shadow-sm">
                      <div className="flex items-center gap-4">
                        <div className="w-12 h-12 rounded-xl flex items-center justify-center border bg-zinc-50 border-zinc-200 text-zinc-700">
                          <connector.icon className="w-6 h-6" />
                        </div>
                        <div>
                          <div className="flex items-center gap-2 mb-1">
                            <h3 className="text-sm font-bold text-zinc-900">{connector.name}</h3>
                            {connector.type === 'community' && (
                              <span className="text-[9px] font-bold bg-blue-50 text-blue-600 px-2 py-0.5 rounded-md uppercase tracking-wider border border-blue-200">Community</span>
                            )}
                            {connector.type === 'official' && (
                              <span className="text-[9px] font-bold bg-emerald-50 text-emerald-600 px-2 py-0.5 rounded-md uppercase tracking-wider border border-emerald-200">Official</span>
                            )}
                          </div>
                          <p className="text-xs text-zinc-500 font-medium">{connector.description}</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-4">
                        <span className="text-[11px] font-bold text-zinc-400">{connector.downloads} installs</span>
                        <button onClick={() => handleInstall(connector.id)} disabled={installing[connector.id] || installed[connector.id]}
                          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg transition-colors text-xs font-bold ${installed[connector.id] ? 'bg-emerald-50 text-emerald-600 border border-emerald-200' : installing[connector.id] ? 'bg-zinc-100 text-zinc-400 cursor-not-allowed' : 'bg-zinc-100 hover:bg-zinc-200 text-zinc-900'}`}>
                          {installed[connector.id] ? (<><CheckCircle2 className="w-3.5 h-3.5" />Instalado</>) : installing[connector.id] ? (<><Loader2 className="w-3.5 h-3.5 animate-spin" />Instalando</>) : (<><Download className="w-3.5 h-3.5" />Instalar</>)}
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
