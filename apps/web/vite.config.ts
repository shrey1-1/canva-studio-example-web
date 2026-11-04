/// <reference types="vitest/config" />
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  build: {
    rolldownOptions: {
      output: {
        // Long-lived vendor chunks: they change rarely, so browsers keep them cached across releases.
        advancedChunks: {
          groups: [
            { name: 'react', test: /node_modules[\/](react|react-dom|react-router|scheduler)[\/]/ },
            { name: 'konva', test: /node_modules[\/](konva|react-konva|react-reconciler|its-fine)[\/]/ },
          ],
        },
      },
    },
  },
  server: {
    port: 5173,
    // The API server (apps/server) runs on 8787 in development.
    proxy: { '/api': { target: 'http://127.0.0.1:8787', changeOrigin: false, ws: true } },
  },
  preview: { proxy: { '/api': { target: 'http://127.0.0.1:8787', changeOrigin: false } } },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    css: false,
  },
});
