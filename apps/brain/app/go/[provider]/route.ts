import { NextResponse } from 'next/server';
import { countKeyLink, KEY_LINKS } from '@/lib/keylinks';

export const runtime = 'nodejs';

/**
 * "Get a free key" buttons come through here on their way to the provider.
 *
 * It answers the one question nothing else can: of the people who install the
 * extension, how many get as far as fetching a key? That is where setup is
 * abandoned, and the people who abandon never agree to send anything, so they
 * are invisible everywhere else.
 *
 * Counting must never be able to stop someone getting their key, so the
 * redirect happens whatever the counter does.
 */
export async function GET(request: Request, { params }: { params: Promise<{ provider: string }> }): Promise<Response> {
    const { provider } = await params;
    const id = provider.toLowerCase().slice(0, 20);
    const destination = KEY_LINKS[id];

    if (!destination) {
        // An unknown name is more likely a typo or a crawler than an attack;
        // send it somewhere useful rather than nowhere.
        return NextResponse.redirect(new URL('/free-gemini-api-key-vs-code', request.url), 302);
    }

    const from = new URL(request.url).searchParams.get('v') ? 'extension' : 'web';
    try {
        await countKeyLink(id, from);
    } catch {
        // Never worth failing someone's setup over.
    }

    return NextResponse.redirect(destination, 302);
}
