import { Server, Database, Cloud, Shield, Cpu } from 'lucide-react';

interface TechSpecItem {
  name: string;
  category: 'infrastructure' | 'database' | 'security' | 'compute';
  status: 'ready' | 'pending' | 'warning';
}

interface TechSpecsProps {
  title: string;
  specs: TechSpecItem[];
}

export const TechSpecs: React.FC<TechSpecsProps> = ({ title, specs }) => {
  const getIcon = (category: string) => {
    switch (category) {
      case 'infrastructure': return <Cloud className="w-4 h-4" />;
      case 'database': return <Database className="w-4 h-4" />;
      case 'security': return <Shield className="w-4 h-4" />;
      default: return <Cpu className="w-4 h-4" />;
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'ready': return 'bg-emerald-500';
      case 'pending': return 'bg-[#D4AF37]';
      case 'warning': return 'bg-red-500';
      default: return 'bg-zinc-300';
    }
  };

  return (
    <div className="bg-white border border-zinc-200/80 rounded-2xl p-6 shadow-sm">
      <div className="flex items-center gap-3 mb-6">
        <div className="w-10 h-10 rounded-xl bg-zinc-900 flex items-center justify-center shadow-md">
          <Server className="w-5 h-5 text-white" />
        </div>
        <h3 className="text-lg font-bold text-zinc-900">{title}</h3>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {specs.map((spec, idx) => (
          <div key={idx} className="flex items-center justify-between p-4 rounded-xl border border-zinc-100 bg-zinc-50/50 hover:bg-zinc-50 transition-colors">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-lg bg-white border border-zinc-200 flex items-center justify-center text-zinc-500 shadow-sm">
                {getIcon(spec.category)}
              </div>
              <span className="text-sm font-semibold text-zinc-700">{spec.name}</span>
            </div>
            <div className="flex items-center gap-2">
              <div className={`w-2 h-2 rounded-full ${getStatusColor(spec.status)}`} />
              <span className="text-[10px] font-bold uppercase tracking-wider text-zinc-500">{spec.status}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};
