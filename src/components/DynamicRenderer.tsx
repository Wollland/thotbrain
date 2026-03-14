import React from 'react';
import { MarketingChart } from './widgets/MarketingChart';
import { TechSpecs } from './widgets/TechSpecs';
import { LegalReport } from './widgets/LegalReport';
import { SummaryCard } from './widgets/SummaryCard';
import { DataTable } from './widgets/DataTable';
import { MetricGrid } from './widgets/MetricGrid';
import { SandboxJSX } from './widgets/SandboxJSX';

// Registro de componentes disponibles para el agente remoto
const componentRegistry: Record<string, React.FC<any>> = {
  'MarketingChart': MarketingChart,
  'TechSpecs': TechSpecs,
  'LegalReport': LegalReport,
  'SummaryCard': SummaryCard,
  'DataTable': DataTable,
  'MetricGrid': MetricGrid,
  'SandboxJSX': SandboxJSX,
};

export interface DynamicBlock {
  id: string;
  type: string;
  props: any;
}

interface DynamicRendererProps {
  blocks: DynamicBlock[];
}

export const DynamicRenderer: React.FC<DynamicRendererProps> = ({ blocks }) => {
  if (!blocks || !Array.isArray(blocks)) {
    console.error("DynamicRenderer expected an array of blocks, but got:", blocks);
    return (
      <div className="p-4 border border-red-200 bg-red-50 text-red-600 rounded-xl text-sm">
        Error: El formato de los datos devueltos por la IA no es válido (se esperaba un array).
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6 w-full max-w-4xl mx-auto animate-in fade-in slide-in-from-bottom-4 duration-700">
      {blocks.map((block, index) => {
        const Component = componentRegistry[block.type];
        const key = block.id || `block-${index}`;
        
        if (!Component) {
          console.warn(`Component type "${block.type}" not found in registry.`);
          return (
            <div key={key} className="p-4 border border-red-200 bg-red-50 text-red-600 rounded-xl text-sm">
              Error: Componente <strong>{block.type}</strong> no registrado.
            </div>
          );
        }

        return (
          <div key={key} className="w-full">
            <Component {...block.props} />
          </div>
        );
      })}
    </div>
  );
};
