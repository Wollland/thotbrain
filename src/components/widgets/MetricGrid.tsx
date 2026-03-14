import React from 'react';
import { Activity } from 'lucide-react';

interface Metric {
  label: string;
  value: string | number;
  trend?: 'up' | 'down' | 'neutral';
  trendValue?: string;
}

interface MetricGridProps {
  title: string;
  metrics: Metric[];
}

export const MetricGrid: React.FC<MetricGridProps> = ({ title, metrics }) => {
  return (
    <div className="bg-white rounded-xl border border-zinc-200 p-5 shadow-sm">
      <div className="flex items-center gap-2 mb-4">
        <Activity className="w-5 h-5 text-emerald-600" />
        <h3 className="font-semibold text-zinc-900">{title}</h3>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {metrics.map((metric, i) => (
          <div key={i} className="p-4 rounded-lg bg-zinc-50 border border-zinc-100">
            <p className="text-xs font-medium text-zinc-500 uppercase tracking-wider mb-1">{metric.label}</p>
            <div className="flex items-baseline gap-2">
              <span className="text-2xl font-semibold text-zinc-900">{metric.value}</span>
              {metric.trend && (
                <span className={`text-xs font-medium ${
                  metric.trend === 'up' ? 'text-emerald-600' : 
                  metric.trend === 'down' ? 'text-red-600' : 'text-zinc-500'
                }`}>
                  {metric.trend === 'up' ? '↑' : metric.trend === 'down' ? '↓' : '→'} {metric.trendValue}
                </span>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};
