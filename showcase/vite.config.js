import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Showcase é a HOME pública (https://babolin.tech/).
// base '/' faz os modelos GLB buscarem na raiz do domínio (e não em /showcase/).
// emptyOutDir: false preserva os outros builds (escritorio/, catálogo, dashboard).
export default defineConfig({
  plugins: [react()],
  base: '/',
  build: {
    outDir: '../public',
    emptyOutDir: false,
    rollupOptions: {
      output: {
        // Assets do showcase ficam em /assets/showcase/ pra não colidir com outros
        entryFileNames: 'assets/showcase/[name]-[hash].js',
        chunkFileNames: 'assets/showcase/[name]-[hash].js',
        assetFileNames: 'assets/showcase/[name]-[hash][extname]',
      },
    },
  },
  server: {
    port: 5181,
  },
});
