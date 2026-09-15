import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

/**
 * In development, /relay/<provider>/... is proxied to the provider so browser
 * CORS never gets in the way. In production, deploy apps/relay (a tiny
 * Cloudflare Worker) and set its URL in Admin → Settings.
 */
const RELAY: Record<string, string> = {
  groq: 'https://api.groq.com/openai/v1',
  gemini: 'https://generativelanguage.googleapis.com/v1beta/openai',
  cerebras: 'https://api.cerebras.ai/v1',
  mistral: 'https://api.mistral.ai/v1',
  openrouter: 'https://openrouter.ai/api/v1',
  openai: 'https://api.openai.com/v1',
  anthropic: 'https://api.anthropic.com',
  ollama: 'http://localhost:11434/v1',
};

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5180,
    proxy: Object.fromEntries(
      Object.entries(RELAY).map(([id, target]) => [
        `/relay/${id}`,
        {
          target,
          changeOrigin: true,
          rewrite: (path: string) => path.replace(new RegExp(`^/relay/${id}`), ''),
          // Server-to-server call: drop the browser's Origin so providers don't treat it as CORS.
          configure: (proxy: { on(event: 'proxyReq', fn: (req: { removeHeader(name: string): void }) => void): void }) => {
            proxy.on('proxyReq', (req) => {
              req.removeHeader('origin');
              req.removeHeader('referer');
            });
          },
        },
      ]),
    ),
  },
  build: { outDir: 'dist', sourcemap: false },
});
