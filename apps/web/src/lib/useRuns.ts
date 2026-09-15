import { useEffect, useState } from 'react';
import { db, onRunsChanged, type RunRecord } from './db';

export function useRuns(): RunRecord[] {
  const [runs, setRuns] = useState<RunRecord[]>([]);
  useEffect(() => {
    const load = () => void db.listRuns().then(setRuns).catch(() => undefined);
    load();
    return onRunsChanged(load);
  }, []);
  return runs;
}

export const ISSUE_HINTS: Record<string, string> = {
  rate_limit: 'Free-tier rate limit hit. Add another provider key so the router can fail over, or wait for the quota to reset.',
  too_large: "The request was bigger than this provider's free tier allows (e.g. Groq's 8K tokens/min). Larger requests are routed to bigger models automatically.",
  auth: 'The API key was rejected. Update it in Providers and press Test.',
  model_not_found: 'The model id is retired or unavailable. Pick another model in Providers (the router also tries to auto-replace it).',
  bad_tool_call: 'The model produced a malformed tool call. It was retried automatically; if it keeps happening, switch to a stronger model.',
  server: 'The provider had a server error or outage. Fallback providers take over automatically.',
  network: 'Network problem or timeout. If this is Groq, Cerebras or Mistral in a deployed build, set up the relay (Settings) to avoid browser CORS blocks.',
  bad_request: 'The provider rejected the request. Check the model id; in deployed builds, calls blocked by CORS need the relay (Settings).',
  refusal: 'The model declined the request. Rephrase it; declined requests are never retried on another provider.',
};

export function providerOf(ref: string): string {
  return ref.split(':')[0] ?? ref;
}
