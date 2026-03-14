import { Scale, FileText, AlertTriangle, CheckCircle2 } from 'lucide-react';

interface LegalClause {
  title: string;
  riskLevel: 'low' | 'medium' | 'high';
  summary: string;
}

interface LegalReportProps {
  title: string;
  documentType: string;
  clauses: LegalClause[];
}

export const LegalReport: React.FC<LegalReportProps> = ({ title, documentType, clauses }) => {
  const getRiskBadge = (level: string) => {
    switch (level) {
      case 'low':
        return <span className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider text-emerald-600 bg-emerald-50 px-2 py-1 rounded-md border border-emerald-100"><CheckCircle2 className="w-3 h-3" /> Riesgo Bajo</span>;
      case 'medium':
        return <span className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider text-[#D4AF37] bg-yellow-50 px-2 py-1 rounded-md border border-yellow-100"><AlertTriangle className="w-3 h-3" /> Riesgo Medio</span>;
      case 'high':
        return <span className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider text-red-600 bg-red-50 px-2 py-1 rounded-md border border-red-100"><AlertTriangle className="w-3 h-3" /> Riesgo Alto</span>;
      default:
        return null;
    }
  };

  return (
    <div className="bg-white border border-zinc-200/80 rounded-2xl overflow-hidden shadow-sm">
      <div className="p-6 border-b border-zinc-100 bg-zinc-50/50 flex items-start justify-between">
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 rounded-2xl bg-white border border-zinc-200 flex items-center justify-center shadow-sm">
            <Scale className="w-6 h-6 text-zinc-900" />
          </div>
          <div>
            <h3 className="text-lg font-bold text-zinc-900">{title}</h3>
            <div className="flex items-center gap-2 mt-1">
              <FileText className="w-3.5 h-3.5 text-zinc-400" />
              <span className="text-xs font-medium text-zinc-500">{documentType}</span>
            </div>
          </div>
        </div>
      </div>
      <div className="p-6 flex flex-col gap-4">
        {clauses.map((clause, idx) => (
          <div key={idx} className="flex flex-col sm:flex-row sm:items-start justify-between gap-4 p-4 rounded-xl border border-zinc-100 hover:border-zinc-200 transition-colors">
            <div className="flex-1">
              <h4 className="text-sm font-bold text-zinc-900 mb-1">{clause.title}</h4>
              <p className="text-xs text-zinc-600 leading-relaxed">{clause.summary}</p>
            </div>
            <div className="shrink-0">
              {getRiskBadge(clause.riskLevel)}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};
