import React, { useState, useEffect } from 'react';
import { LiveProvider, LivePreview, LiveError } from 'react-live';
import * as Recharts from 'recharts';
import * as Lucide from 'lucide-react';

const scope = {
  React,
  useState,
  useEffect,
  ...Recharts,
  ...Lucide
};

interface SandboxJSXProps {
  code: string;
}

export const SandboxJSX: React.FC<SandboxJSXProps> = ({ code }) => {
  // Limpiar el código por si el modelo envía markdown
  const cleanCode = code.replace(/```jsx\n?/g, '').replace(/```\n?/g, '').trim();

  return (
    <div className="bg-white rounded-xl border border-indigo-200 overflow-hidden shadow-md">
      <div className="px-4 py-2 bg-indigo-50 border-b border-indigo-100 flex items-center gap-2">
        <Lucide.Code2 className="w-4 h-4 text-indigo-600" />
        <span className="text-xs font-semibold text-indigo-900 uppercase tracking-wider">
          AI Generated React Sandbox
        </span>
      </div>
      <LiveProvider code={cleanCode} scope={scope}>
        <div className="p-6">
          <LivePreview />
        </div>
        <LiveError className="bg-red-50 text-red-600 p-4 font-mono text-xs overflow-x-auto border-t border-red-100" />
      </LiveProvider>
    </div>
  );
};
