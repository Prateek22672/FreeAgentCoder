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
    ];
  },
};

export default nextConfig;
