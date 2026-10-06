import { NextResponse } from 'next/server';

/** A shorter way to say /install, for links typed or read aloud. */
export function GET(request: Request): Response {
    return NextResponse.redirect(new URL('/install', request.url), 308);
}
