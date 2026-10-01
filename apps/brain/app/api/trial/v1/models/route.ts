import { addressFrom, allowance, installFrom, readExtTrialSettings } from '@/lib/extTrial';

export const runtime = 'nodejs';

/**
 * The free trial's two "models", as an OpenAI-compatible list, plus where this
 * install stands today. The extension uses it to show the trial's allowance.
 */
export async function GET(request: Request): Promise<Response> {
    const install = installFrom(request);
    if (!install) return new Response(JSON.stringify({ error: { message: 'Not a free-trial request.' } }), { status: 401, headers: { 'content-type': 'application/json' } });
    const settings = await readExtTrialSettings();
    const status = await allowance(install, addressFrom(request), settings);
    return new Response(
        JSON.stringify({
            object: 'list',
            data: [
                { id: 'fast', object: 'model', owned_by: 'freeagentcoder' },
                { id: 'deep', object: 'model', owned_by: 'freeagentcoder' },
            ],
            trial: { enabled: settings.enabled, available: status.ok, limit: status.limit, remaining: status.requestsLeft, reason: status.reason },
        }),
        { headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } },
    );
}
