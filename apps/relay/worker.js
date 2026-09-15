/**
 * Agentic relay: a tiny CORS relay so the web app can call LLM providers that
 * don't allow browser requests (Groq, Cerebras, Mistral, ...).
 *
 *   https://<relay>/<provider>/<path>  ->  <provider base URL>/<path>
 *
 * - Only the providers below are reachable (it is not an open proxy).
 * - The user's API key passes through in the request headers; nothing is
 *   stored or logged.
 * - Free on Cloudflare Workers (100k requests/day), commercial use allowed.
 *
 * Deploy:  cd apps/relay && npx wrangler deploy
 * Optional: set ALLOWED_ORIGIN (e.g. https://agentic.pages.dev) to lock it to your site.
 */
const TARGETS = {
  groq: 'https://api.groq.com/openai/v1',
  gemini: 'https://generativelanguage.googleapis.com/v1beta/openai',
  cerebras: 'https://api.cerebras.ai/v1',
  mistral: 'https://api.mistral.ai/v1',
  openrouter: 'https://openrouter.ai/api/v1',
  openai: 'https://api.openai.com/v1',
  anthropic: 'https://api.anthropic.com',
};

const STRIP = ['origin', 'referer', 'cookie', 'cf-connecting-ip', 'x-forwarded-for', 'x-real-ip'];

export default {
  async fetch(request, env) {
    const origin = request.headers.get('origin') ?? '';
    const allowed = env.ALLOWED_ORIGIN ? env.ALLOWED_ORIGIN.split(',').map((s) => s.trim()) : ['*'];
    const allowOrigin = allowed.includes('*') ? '*' : allowed.includes(origin) ? origin : '';
    const cors = {
      'access-control-allow-origin': allowOrigin || 'null',
      'access-control-allow-headers': '*',
      'access-control-allow-methods': 'GET, POST, OPTIONS',
      'access-control-expose-headers': '*',
      'access-control-max-age': '86400',
    };
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    if (!allowOrigin) return new Response('Origin not allowed', { status: 403, headers: cors });

    const url = new URL(request.url);
    const [, provider, ...rest] = url.pathname.split('/');
    const base = TARGETS[provider];
    if (!base) {
      return new Response(JSON.stringify({ error: { message: `Unknown provider "${provider}"` } }), {
        status: 404,
        headers: { ...cors, 'content-type': 'application/json' },
      });
    }

    const headers = new Headers(request.headers);
    for (const h of STRIP) headers.delete(h);
    const upstream = await fetch(`${base}/${rest.join('/')}${url.search}`, {
      method: request.method,
      headers,
      body: request.method === 'GET' || request.method === 'HEAD' ? undefined : request.body,
    });
    const response = new Response(upstream.body, upstream);
    for (const [k, v] of Object.entries(cors)) response.headers.set(k, v);
    return response;
  },
};
