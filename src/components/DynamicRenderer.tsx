import React from 'react';
import { MarketingChart } from './widgets/MarketingChart';
import { TechSpecs } from './widgets/TechSpecs';
import { LegalReport } from './widgets/LegalReport';

// Registro de componentes disponibles para el agente remoto
const componentRegistry: Record<string, React.FC<any>> = {
  'MarketingChart': MarketingChart,
  'TechSpecs': TechSpecs,
  'LegalReport': LegalReport,
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
  return (
    <div className="flex flex-col gap-6 w-full max-w-4xl mx-auto animate-in fade-in slide-in-from-bottom-4 duration-700">
      {blocks.map((block) => {
        const Component = componentRegistry[block.type];
        
        if (!Component) {
          console.warn(`Component type "${block.type}" not found in registry.`);
          return (
            <div key={block.id} className="p-4 border border-red-200 bg-red-50 text-red-600 rounded-xl text-sm">
              Error: Componente <strong>{block.type}</strong> no registrado.
            </div>
          );
        }

        return (
          <div key={block.id} className="w-full">
            <Component {...block.props} />
          </div>
        );
      })}
    </div>
  );
};
