import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    port: 4000,
    host: '0.0.0.0',
    proxy: {
      '/v1': {
        target: 'http://100.64.0.1:8081',
        changeOrigin: true,
      },
      '/health': {
        target: 'http://100.64.0.1:8081',
        changeOrigin: true,
      },
      '/admin': {
        target: 'http://100.64.0.1:8081',
        changeOrigin: true,
      },
    },
  },
});
