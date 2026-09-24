import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const API = `http://localhost:${process.env.RUSH_API_PORT ?? 8787}`;

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    host: true,
    proxy: {
      '/api': API,
      '/ws': { target: API, ws: true },
    },
  },
  build: {
    chunkSizeWarningLimit: 1100,
    rollupOptions: {
      output: {
        // MapLibre change rarement : un fichier à part reste en cache entre deux déploiements.
        manualChunks: { maplibre: ['maplibre-gl'] },
      },
    },
  },
});
