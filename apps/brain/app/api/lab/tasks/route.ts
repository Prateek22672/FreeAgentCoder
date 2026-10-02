import { labAuthorised, readTasks } from '@/lib/lab';

export const runtime = 'nodejs';

/** The lab's tasks, for the extension's "Run a test task" command. Needs the lab token. */
export async function GET(request: Request): Promise<Response> {
    if (!labAuthorised(request)) return Response.json({ error: 'Lab token missing or wrong. Copy it from the admin page.' }, { status: 401 });
    return Response.json({ tasks: await readTasks() }, { headers: { 'cache-control': 'no-store' } });
}
