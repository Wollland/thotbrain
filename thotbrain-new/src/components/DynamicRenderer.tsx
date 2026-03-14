import { MarketingChart } from './widgets/MarketingChart';
import { TechSpecs } from './widgets/TechSpecs';
import { LegalReport } from './widgets/LegalReport';

export interface DynamicBlock {
  id: string;
  type: string;
  props: Record<string, any>;
}

const REGISTRY: Record<string, React.FC<any>> = {
  MarketingChart,
  TechSpecs,
  LegalReport,
};

interface DynamicRendererProps {
  blocks: DynamicBlock[];
}

export const DynamicRenderer: React.FC<DynamicRendererProps> = ({ blocks }) => {
  return (
    <div className="flex flex-col items-center gap-6 w-full max-w-4xl mx-auto animate-in fade-in slide-in-from-bottom-4 duration-700">
      {blocks.map((block) => {
        const Component = REGISTRY[block.type];
        if (!Component) {
          console.warn(`[DynamicRenderer] Unknown component: ${block.type}`);
          return (
            <div key={block.id} className="w-full p-4 bg-red-50 border border-red-200 rounded-xl text-sm text-red-600">
              Error: Componente <strong>{block.type}</strong> no registrado.
            </div>
          );
        }
        return <Component key={block.id} {...block.props} />;
      })}
    </div>
  );
};
