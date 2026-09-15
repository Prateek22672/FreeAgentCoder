import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

const page = (path: string) => fileURLToPath(new URL(path, import.meta.url));

export default defineConfig({
  // Relative asset paths, so the site works at a domain root or under /<repo>/ on GitHub Pages.
  base: './',
  plugins: [react()],
  server: { port: 5190 },
  build: {
    outDir: 'dist',
    rollupOptions: {
      input: {
        main: page('./index.html'),
        install: page('./install/index.html'),
      },
    },
  },
});
