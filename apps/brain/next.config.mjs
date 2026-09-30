/** @type {import('next').NextConfig} */
const nextConfig = {
  // A separate build folder for test builds, so they never overwrite a running `next dev`.
  distDir: process.env.BRAIN_DIST_DIR || '.next',
  // Workspace packages ship TypeScript source; Next compiles them like app code.
  transpilePackages: ['@agentic/core', '@agentic/project-brain'],
  poweredByHeader: false,
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'X-Frame-Options', value: 'DENY' },
        ],
      },
      {
        // Running a repository in the browser needs SharedArrayBuffer, which
        // needs the page to be cross-origin isolated. Only the workbench pages
        // get these headers: they load nothing from other origins, and the
        // rest of the site keeps its embeds and previews.
        source: '/:area(r|playground)/:path*',
        headers: [
          { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
          { key: 'Cross-Origin-Embedder-Policy', value: 'require-corp' },
        ],
      },
      {
        source: '/playground',
        headers: [
          { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
          { key: 'Cross-Origin-Embedder-Policy', value: 'require-corp' },
        ],
      },
    ];
  },
};

export default nextConfig;
