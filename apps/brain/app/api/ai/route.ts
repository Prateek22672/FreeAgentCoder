import { configuredProviders } from '@/lib/ai';
import { trialStatus } from '@/lib/trial';

export const runtime = 'nodejs';

/** How this visitor can ask: the free trial on the site's key, and how much of it is left. */
export async function GET(request: Request) {
    const trial = trialStatus(request);
    const serverKey = configuredProviders().length > 0;
    const headers = new Headers({ 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    if (trial.setCookie) headers.set('Set-Cookie', trial.setCookie);
    return new Response(
        JSON.stringify({ trial: serverKey ? { limit: trial.limit, remaining: trial.remaining, ...(trial.closed ? { closed: true } : {}) } : null }),
        { headers },
    );
}
