import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

function virtualTailwindCss() {
  const virtualId = 'virtual:tailwind.css';
  const resolvedId = '/__virtual_tailwind.css';

  return {
    name: 'virtual-tailwind-css',
    enforce: 'pre',
    resolveId(id) {
      if (id === virtualId) return resolvedId;
    },
    load(id) {
      if (id === resolvedId) return '@import "tailwindcss";';
    },
  };
}

export default defineConfig({
  plugins: [virtualTailwindCss(), react(), tailwindcss()],
  build: {
    outDir: 'dist',
    sourcemap: false,
  },
});