import React from 'react';
import { Table } from 'lucide-react';

interface Column {
  key: string;
  label: string;
}

interface DataTableProps {
  title: string;
  columns: Column[];
  rows: Record<string, any>[];
}

export const DataTable: React.FC<DataTableProps> = ({ title, columns, rows }) => {
  return (
    <div className="bg-white rounded-xl border border-zinc-200 overflow-hidden shadow-sm">
      <div className="p-4 border-b border-zinc-200 bg-zinc-50 flex items-center gap-2">
        <Table className="w-4 h-4 text-zinc-500" />
        <h3 className="font-semibold text-zinc-900 text-sm">{title}</h3>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm text-left">
          <thead className="text-xs text-zinc-500 uppercase bg-zinc-50/50 border-b border-zinc-200">
            <tr>
              {columns.map((col) => (
                <th key={col.key} className="px-4 py-3 font-medium">{col.label}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => (
              <tr key={i} className="border-b border-zinc-100 last:border-0 hover:bg-zinc-50/50 transition-colors">
                {columns.map((col) => (
                  <td key={col.key} className="px-4 py-3 text-zinc-700">
                    {row[col.key]}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};
