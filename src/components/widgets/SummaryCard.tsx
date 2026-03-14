import React from 'react';
import { Info } from 'lucide-react';

interface SummaryCardProps {
  title: string;
  content: string;
  icon?: string;
}

export const SummaryCard: React.FC<SummaryCardProps> = ({ title, content }) => {
  return (
    <div className="bg-white rounded-xl border border-zinc-200 p-5 shadow-sm">
      <div className="flex items-center gap-3 mb-3">
        <div className="p-2 bg-blue-50 text-blue-600 rounded-lg">
          <Info className="w-5 h-5" />
        </div>
        <h3 className="font-semibold text-zinc-900">{title}</h3>
      </div>
      <p className="text-zinc-600 text-sm leading-relaxed">{content}</p>
    </div>
  );
};
