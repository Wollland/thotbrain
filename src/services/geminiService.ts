import { GoogleGenAI, Type, FunctionDeclaration } from '@google/genai';

// Initialize Gemini API
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

// Emulate MCP Connectors as Gemini Tools
const githubMCPTool: FunctionDeclaration = {
  name: 'github_mcp_get_repo_info',
  description: 'Obtiene información de un repositorio de GitHub (Emulación de MCP Connector)',
  parameters: {
    type: Type.OBJECT,
    properties: {
      repoName: { type: Type.STRING, description: 'Nombre del repositorio' }
    },
    required: ['repoName']
  }
};

const customERPMCPTool: FunctionDeclaration = {
  name: 'custom_erp_query',
  description: 'Consulta datos internos de la empresa en el ERP Legacy (Emulación de MCP Connector)',
  parameters: {
    type: Type.OBJECT,
    properties: {
      query: { type: Type.STRING, description: 'Consulta SQL o texto libre' }
    },
    required: ['query']
  }
};

export interface AgentProgress {
  id: number;
  status: 'ESPERANDO' | 'ANALIZANDO' | 'COMPLETADO' | 'ERROR';
  progress: number;
  contribution?: string;
}

export const runAgentSwarm = async (
  prompt: string,
  onProgress: (progress: AgentProgress) => void,
  onThought: (thought: any) => void
) => {
  try {
    // 1. Handshake Phase
    onThought({ id: Date.now().toString() + 'hs1', type: 'system', text: 'Iniciando Handshake con el cliente...' });
    onThought({ id: Date.now().toString() + 'hs2', type: 'system', text: 'Descubriendo componentes UI disponibles: MarketingChart, TechSpecs, LegalReport, SummaryCard, DataTable, MetricGrid, SandboxJSX.' });
    onThought({ id: Date.now().toString() + 'hs3', type: 'system', text: 'Descubriendo MCP Tools disponibles: github_mcp_get_repo_info, custom_erp_query, googleSearch.' });
    
    onThought({ id: Date.now().toString(), type: 'system', text: `Analizando prompt: "${prompt}"` });
    onThought({ id: Date.now().toString() + '1', type: 'orchestration', text: 'Ruteo semántico completado. Activando especialistas requeridos dinámicamente.' });
    
    // Agent 1: Ingeniero (Uses GitHub MCP emulation)
    onProgress({ id: 1, status: 'ANALIZANDO', progress: 20 });
    onThought({ id: Date.now().toString() + '2', type: 'agent', agentId: 1, text: 'Llamando a tool `github_mcp_get_repo_info` y analizando viabilidad técnica.' });
    
    const engPromise = ai.models.generateContent({
      model: 'gemini-3-flash-preview',
      contents: `Analiza la viabilidad técnica y arquitectura para: ${prompt}. Sé breve (2 líneas).`,
      config: {
        systemInstruction: 'Eres un ingeniero de software experto. Devuelve un resumen técnico conciso.',
        tools: [{ functionDeclarations: [githubMCPTool] }]
      }
    }).then(res => {
      onProgress({ id: 1, status: 'COMPLETADO', progress: 100, contribution: res.text });
      onThought({ id: Date.now().toString() + '3', type: 'agent', agentId: 1, text: 'Análisis técnico completado.' });
      return res.text;
    });

    // Agent 2: Comercial (Uses Google Search MCP)
    onProgress({ id: 2, status: 'ANALIZANDO', progress: 20 });
    onThought({ id: Date.now().toString() + '4', type: 'agent', agentId: 2, text: 'Llamando a tool `googleSearch` para buscar datos financieros y de mercado actualizados.' });
    
    const comPromise = ai.models.generateContent({
      model: 'gemini-3-flash-preview',
      contents: `Busca datos financieros y de mercado actualizados para: ${prompt}. Sé breve (2 líneas).`,
      config: {
        systemInstruction: 'Eres un analista comercial. Usa Google Search para buscar datos reales y devuelve un resumen financiero conciso.',
        tools: [{ googleSearch: {} }]
      }
    }).then(res => {
      onProgress({ id: 2, status: 'COMPLETADO', progress: 100, contribution: res.text });
      onThought({ id: Date.now().toString() + '5', type: 'agent', agentId: 2, text: 'Datos financieros procesados.' });
      return res.text;
    });

    // Agent 3: Legal (Uses Custom ERP MCP)
    onProgress({ id: 4, status: 'ANALIZANDO', progress: 20 });
    onThought({ id: Date.now().toString() + '6', type: 'agent', agentId: 4, text: 'Llamando a tool `custom_erp_query` para verificar normativas internas y compliance.' });
    
    const legPromise = ai.models.generateContent({
      model: 'gemini-3-flash-preview',
      contents: `Analiza los riesgos legales y de cumplimiento para: ${prompt}. Sé breve (2 líneas).`,
      config: {
        systemInstruction: 'Eres un asesor legal corporativo. Devuelve un resumen de riesgos conciso.',
        tools: [{ functionDeclarations: [customERPMCPTool] }]
      }
    }).then(res => {
      onProgress({ id: 4, status: 'COMPLETADO', progress: 100, contribution: res.text });
      onThought({ id: Date.now().toString() + '7', type: 'agent', agentId: 4, text: 'Análisis de compliance finalizado.' });
      return res.text;
    });

    // Wait for all agents to finish
    const [engRes, comRes, legRes] = await Promise.all([engPromise, comPromise, legPromise]);

    onThought({ id: Date.now().toString() + '8', type: 'system', text: 'Consolidando JSON final. Enviando al cliente para renderizado dinámico.' });

    // Synthesizer
    const synthPrompt = `
      Eres el Director de Arte y Presentación de ThotBrain.
      Basado en los siguientes análisis, genera un JSON estricto para renderizar una UI rica, espectacular y altamente visual.
      
      Análisis del Ingeniero: ${engRes}
      Análisis del Comercial: ${comRes}
      Análisis del Legal: ${legRes}
      
      Instrucciones:
      Devuelve ÚNICAMENTE un array JSON válido, sin bloques de código Markdown (sin \`\`\`json).
      El array debe contener objetos que representen bloques de UI. 
      
      IMPORTANTE: Tienes que crear una experiencia visual impactante. NO te limites a texto plano.
      
      Componentes disponibles (usa el campo "type" exacto):
      
      1. "SummaryCard"
         props: { "title": string, "content": string }
         
      2. "DataTable"
         props: { "title": string, "columns": [{"key": string, "label": string}], "rows": [{"key": valor, ...}] }
         
      3. "MetricGrid"
         props: { "title": string, "metrics": [{"label": string, "value": string|number, "trend": "up"|"down"|"neutral", "trendValue": string}] }
         
      4. "MarketingChart"
         props: { "title": string, "description": string, "data": [{"name": string, "value": number}] }
         
      5. "TechSpecs"
         props: { "title": string, "specs": [{"name": string, "category": "infrastructure"|"frontend"|"backend"|"security", "status": "ready"|"pending"|"warning"}] }
         
      6. "LegalReport"
         props: { "title": string, "documentType": string, "clauses": [{"title": string, "riskLevel": "low"|"medium"|"high", "summary": string}] }
         
      7. "SandboxJSX"
         props: { "code": string }
         *USO OBLIGATORIO PARA GRÁFICOS COMPLEJOS*: Usa este componente para crear dashboards interactivos, gráficos de tarta (PieChart), gráficos de área (AreaChart) o interfaces personalizadas.
         Genera el código fuente de un componente funcional de React en formato string y pásalo en la propiedad 'code'.
         El código debe ser una función anónima que retorna JSX. Ej: "() => { return <div className=\\"p-4 bg-white rounded shadow\\">...</div> }"
         Tienes disponible en el scope global: React, useState, useEffect, todos los iconos de lucide-react (ej. <Activity />), y todos los componentes de recharts (ej. <PieChart />, <Pie />, <AreaChart />, <Area />, <XAxis />, <YAxis />, <Tooltip />, <ResponsiveContainer />).
         Usa clases de Tailwind CSS para los estilos. Asegúrate de escapar correctamente las comillas dobles dentro del string JSON.

      REGLAS DE ORO:
      - Genera entre 3 y 5 bloques.
      - DEBES incluir al menos un componente "SandboxJSX" que renderice un gráfico avanzado usando 'recharts' (ej. un PieChart con los datos del mercado o un AreaChart con la viabilidad).
      - DEBES incluir al menos un "MetricGrid" con los KPIs principales extraídos de los análisis.
      - Los datos mostrados DEBEN estar directamente relacionados con la consulta original: "${prompt}".
      - Inventa datos numéricos realistas y coherentes si no están explícitos en el análisis, pero mantén la temática.
    `;

    const finalRes = await ai.models.generateContent({
      model: 'gemini-3-flash-preview',
      contents: synthPrompt,
      config: {
        systemInstruction: 'Eres el coordinador del enjambre. Genera ÚNICAMENTE JSON válido.',
        responseMimeType: 'application/json'
      }
    });

    let jsonOutput = finalRes.text || '[]';
    // Clean up markdown if the model ignored the instruction
    if (jsonOutput.startsWith('\`\`\`json')) {
      jsonOutput = jsonOutput.replace(/\`\`\`json/g, '').replace(/\`\`\`/g, '').trim();
    }

    return JSON.parse(jsonOutput);

  } catch (error) {
    console.error("Error running agent swarm:", error);
    throw error;
  }
};
