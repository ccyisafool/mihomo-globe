import { sites } from '@openai/sites-vite-plugin';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  plugins: [react(), sites()],
  server: {
    host: '127.0.0.1',
  },
  build: {
    target: 'es2022',
  },
  worker: {
    format: 'es',
  },
});
