import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig} from 'vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, '.'),
    },
  },
  server: {
    // El servidor de gobernanza corre aparte (npm run dev:server); desde el navegador se llama como mismo origen.
    proxy: { '/api': 'http://127.0.0.1:8787' },
  },
});
