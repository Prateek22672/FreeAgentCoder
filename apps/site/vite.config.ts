import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
import { defineConfig, type Plugin } from 'vite';
import { ARTICLES } from './src/content-articles.ts';
import { config } from './src/config.ts';

const page = (path: string) => fileURLToPath(new URL(path, import.meta.url));

/** Injects the production URL (origin + base path) into the HTML and emits robots.txt and sitemap.xml. */
function siteMeta(): Plugin {
  const site = `${config.site}${config.basePath}`.replace(/\/+$/, '');
  return {
    name: 'freeagentcoder-site-meta',
    transformIndexHtml: {
      order: 'pre',
      handler: (html) => html.replaceAll('__SITE_URL__', site),
    },
    generateBundle() {
      const today = new Date().toISOString().slice(0, 10);
      const urls = [
        { loc: `${site}/`, lastmod: today },
        ...ARTICLES.map((article) => ({ loc: `${site}/${article.slug}/`, lastmod: article.updated })),
      ];
      this.emitFile({
        type: 'asset',
        fileName: 'robots.txt',
        source: `User-agent: *\nAllow: /\n\nSitemap: ${site}/sitemap.xml\n`,
      });
      this.emitFile({
        type: 'asset',
        fileName: 'sitemap.xml',
        source:
          '<?xml version="1.0" encoding="UTF-8"?>\n' +
          '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
          urls.map((u) => `  <url>\n    <loc>${u.loc}</loc>\n    <lastmod>${u.lastmod}</lastmod>\n  </url>\n`).join('') +
          '</urlset>\n',
      });
    },
  };
}

export default defineConfig({
  // Relative asset paths, so the build works at a domain root (Vercel) and under /<repo>/ (GitHub Pages).
  base: './',
  plugins: [react(), siteMeta()],
  server: { port: 5190 },
  build: {
    outDir: 'dist',
    rollupOptions: {
      input: {
        main: page('./index.html'),
        install: page('./install/index.html'),
        ...Object.fromEntries(ARTICLES.map((article) => [article.slug, page(`./${article.slug}/index.html`)])),
      },
    },
  },
});
