# ThotBrain: Guía de Generación Dinámica de UI (React Sandbox)

Este documento explica la arquitectura y el flujo de trabajo para que los desarrolladores puedan crear agentes capaces de generar componentes React dinámicamente, ejecutarlos en un entorno seguro (Sandbox) y enviarlos al cliente mediante streaming.

## 🏗️ Arquitectura General

El paradigma de **Generative UI** en ThotBrain no se basa en componentes pre-programados estáticos, sino en código generado al vuelo. El flujo es el siguiente:

1. **Instrucción (YAML):** Se define el comportamiento del agente y las librerías permitidas.
2. **Generación (LLM):** El modelo escribe el código React (JSX/TSX).
3. **Compilación Segura (Sandbox):** Un entorno aislado en el backend transpila el JSX a JavaScript puro.
4. **Streaming:** El código compilado viaja al navegador en tiempo real.
5. **Interpretación (Browser):** El cliente evalúa el código de forma segura y lo renderiza en el DOM.

---

## 1. Definición del Agente (YAML)

Los desarrolladores configuran los agentes utilizando archivos YAML. Aquí se define el "System Prompt", las herramientas disponibles y las librerías de UI que el agente tiene permitido importar.

```yaml
# agent_config.yaml
name: "Visual Designer Agent"
role: "Generador de interfaces React"
description: "Crea componentes visuales interactivos basados en datos financieros."

sandbox_config:
  allowed_imports:
    - "react"
    - "recharts"
    - "lucide-react"
  timeout_ms: 5000

system_prompt: |
  Eres un experto desarrollador frontend.
  Tu objetivo es generar un único componente React exportado por defecto (export default).
  Usa Tailwind CSS para los estilos (className).
  Recibirás un JSON con datos. Devuelve ÚNICAMENTE código TSX válido.
```

---

## 2. El Sandbox (Backend)

No podemos enviar JSX crudo al navegador porque este no sabe cómo interpretarlo. Tampoco podemos ejecutar código no confiable directamente en nuestro servidor principal.

Cuando el LLM genera el código del componente, este se envía a un **Sandbox Efímero** (por ejemplo, contenedores Firecracker o aislamientos en Deno/Cloudflare Workers).

**¿Qué hace el Sandbox?**
1. Recibe el string con el código React.
2. Utiliza un bundler ultrarrápido (como `esbuild` o `SWC`).
3. Transpila el JSX a llamadas `React.createElement` (o el nuevo transform de React 18).
4. Empaqueta el código en un módulo IIFE o ESM (ECMAScript Module).

---

## 3. Streaming e Interpretación (Frontend)

Una vez que el Sandbox ha compilado el código a JavaScript puro, este se envía al navegador del usuario (vía Server-Sent Events o WebSockets para dar efecto de streaming).

**¿Cómo se ejecuta en el navegador?**

El navegador recibe un *string* de JavaScript. Para ejecutarlo de forma segura sin romper la aplicación principal, utilizamos **Dynamic Imports con Blob URLs** o un evaluador de contexto seguro.

Ejemplo conceptual de cómo el frontend de ThotBrain interpreta el código:

```typescript
import React, { useState, useEffect } from 'react';
import * as Recharts from 'recharts';
import * as Lucide from 'lucide-react';

// 1. Proveemos el contexto (las librerías que el componente generado puede usar)
const providedScope = {
  React,
  recharts: Recharts,
  'lucide-react': Lucide
};

async function renderDynamicComponent(compiledCodeString) {
  // 2. Convertimos el string de código en un archivo virtual (Blob)
  const blob = new Blob([compiledCodeString], { type: 'application/javascript' });
  const url = URL.createObjectURL(blob);

  try {
    // 3. Importamos dinámicamente el módulo
    // El código generado debe estar compilado como un módulo ESM
    const module = await import(url);
    
    // 4. Obtenemos el componente React exportado
    const DynamicComponent = module.default;
    return <DynamicComponent />;
  } finally {
    URL.revokeObjectURL(url); // Limpiamos la memoria
  }
}
```

---

## 🔒 Consideraciones de Seguridad (Para el equipo de DevOps)

Ejecutar código generado por IA en el navegador del cliente conlleva riesgos (XSS). Para mitigarlos, ThotBrain implementa:

1. **Shadow DOM / Iframe Isolation:** Los componentes dinámicos más complejos se renderizan dentro de un `<iframe>` con el atributo `sandbox="allow-scripts"` para evitar que accedan a las cookies o al `localStorage` de la app principal.
2. **Content Security Policy (CSP):** Estricto control de desde dónde se pueden cargar scripts y hacer peticiones de red (evitando que el componente envíe datos a servidores de terceros).
3. **Scope Restringido:** El componente solo tiene acceso a las librerías inyectadas en su `providedScope`. No tiene acceso a `window`, `document` o variables globales de la aplicación principal.

---

## 🚀 Siguientes Pasos para Desarrolladores

1. Revisar la carpeta `/examples/agents/` para ver plantillas YAML.
2. Probar el endpoint local de compilación: `POST /api/sandbox/compile`.
3. Integrar el componente `<DynamicRenderer />` en sus vistas de React.
