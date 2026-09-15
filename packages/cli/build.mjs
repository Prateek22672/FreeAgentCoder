import { build } from 'esbuild';
import { chmodSync, mkdirSync, writeFileSync } from 'node:fs';

mkdirSync('dist', { recursive: true });
await build({
  entryPoints: ['src/index.ts'],
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'esm',
  outfile: 'dist/agentic.js',
  banner: {
    js: [
      '#!/usr/bin/env node',
      // esbuild ESM bundles of CJS deps need these shims.
      "import { createRequire as __createRequire } from 'node:module';",
      'const require = __createRequire(import.meta.url);',
    ].join('\n'),
  },
  sourcemap: false,
  minify: false,
  logLevel: 'info',
});
try {
  chmodSync('dist/agentic.js', 0o755);
} catch {
  // Windows
}
writeFileSync('dist/.gitkeep', '');
