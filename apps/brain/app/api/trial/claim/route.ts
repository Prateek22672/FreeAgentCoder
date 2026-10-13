import { addressFrom, bonusLeft, claimBonus, installFrom, readExtTrialSettings } from '@/lib/extTrial';

export const runtime = 'nodejs';

/** The welcome bonus: claimed once by the extension, with its trial id. */
export async function POST(request: Request): Promise<Response> {
    const install = installFrom(request);
    if (!install) return Response.json({ error: 'This endpoint is for the FreeAgentCoder extension.' }, { status: 401 });
    const result = await claimBonus(install, addressFrom(request), await readExtTrialSettings());
    return Response.json(result, { status: result.ok ? 200 : 409 });
}

/** What is left of it. */
export async function GET(request: Request): Promise<Response> {
    const install = installFrom(request);
    if (!install) return Response.json({ error: 'This endpoint is for the FreeAgentCoder extension.' }, { status: 401 });
    const settings = await readExtTrialSettings();
    return Response.json({ tokens: await bonusLeft(install), offered: settings.enabled && settings.bonusTokens > 0 ? settings.bonusTokens : 0 }, { headers: { 'cache-control': 'no-store' } });
}
