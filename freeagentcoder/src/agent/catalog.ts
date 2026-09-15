import { PRESETS } from '@agentic/core';
import { AUTO_MODEL, type ProviderView, type Tier } from '../shared/protocol';

/** Providers a user adds keys for, in display order. */
export const KEY_PROVIDERS = ['gemini', 'groq', 'cerebras', 'mistral', 'openrouter', 'openai', 'anthropic'];

/** Fast first: Groq and Cerebras answer in a second or two, and small requests fit their free tiers. */
const FAST_ORDER = ['groq', 'cerebras', 'gemini', 'mistral', 'openrouter'];
/** Strongest first: Gemini's 1M-token context carries long, multi-file work. */
const DEEP_ORDER = ['gemini', 'mistral', 'cerebras', 'openrouter', 'groq'];
/** Paid keys are only routed automatically when no free key is active. */
const PAID_ORDER = ['anthropic', 'openai'];

const TIER_MODELS: Record<string, Record<Tier, string>> = {
    groq: { fast: 'openai/gpt-oss-120b', deep: 'openai/gpt-oss-120b' },
    cerebras: { fast: 'gpt-oss-120b', deep: 'gpt-oss-120b' },
    gemini: { fast: 'gemini-3.5-flash-lite', deep: 'gemini-3.8-flash' },
    mistral: { fast: 'mistral-small-latest', deep: 'mistral-medium-latest' },
    openrouter: { fast: 'openrouter/free', deep: 'openrouter/free' },
    openai: { fast: 'gpt-5-mini', deep: 'gpt-5' },
    anthropic: { fast: 'claude-haiku-4-5', deep: 'claude-sonnet-5' },
};

const SHORT_LABELS: Record<string, string> = {
    gemini: 'Gemini',
    groq: 'Groq',
    cerebras: 'Cerebras',
    mistral: 'Mistral',
    openrouter: 'OpenRouter',
    openai: 'OpenAI',
    anthropic: 'Anthropic',
};

export function providerLabel(id: string): string {
    return SHORT_LABELS[id] ?? PRESETS[id]?.label ?? id;
}

export function providerViews(): ProviderView[] {
    return KEY_PROVIDERS.map((id) => PRESETS[id]).filter((p) => p !== undefined).map((p) => ({
        id: p.id,
        label: providerLabel(p.id),
        free: p.free,
        models: p.models,
        defaultModel: p.defaultModel,
        signupUrl: p.signupUrl,
        note: p.note,
    }));
}

export function parseModelChoice(choice: string): { provider: string; model: string } | undefined {
    const colon = choice.indexOf(':');
    if (colon <= 0) {
        return undefined;
    }
    const provider = choice.slice(0, colon);
    const model = choice.slice(colon + 1).trim();
    return KEY_PROVIDERS.includes(provider) && model ? { provider, model } : undefined;
}

export function isValidModelChoice(choice: unknown): choice is string {
    return typeof choice === 'string' && (choice === AUTO_MODEL || parseModelChoice(choice) !== undefined);
}

export interface KeyRef {
    id: string;
    provider: string;
    label: string;
}

export interface RouteStep<K extends KeyRef> {
    provider: string;
    model: string;
    keys: K[];
}

/**
 * The ordered model chain for one request. Every key of a provider becomes its
 * own step entry, least-used today first, so load spreads across keys and a
 * rate-limited key hands over to the next one.
 */
export function planRoute<K extends KeyRef>(
    keys: K[],
    choice: string,
    tier: Tier,
    load: (keyId: string) => number,
): { steps: RouteStep<K>[]; note?: string } {
    const byProvider = new Map<string, K[]>();
    for (const key of keys) {
        const list = byProvider.get(key.provider) ?? [];
        list.push(key);
        byProvider.set(key.provider, list);
    }
    for (const list of byProvider.values()) {
        list.sort((a, b) => load(a.id) - load(b.id));
    }

    const steps: RouteStep<K>[] = [];
    const add = (provider: string, model: string) => {
        const list = byProvider.get(provider);
        if (list?.length && model && !steps.some((s) => s.provider === provider && s.model === model)) {
            steps.push({ provider, model, keys: list });
        }
    };

    const selected = parseModelChoice(choice);
    if (selected) {
        add(selected.provider, selected.model);
        for (const id of DEEP_ORDER) {
            if (id !== selected.provider) {
                add(id, TIER_MODELS[id].deep);
            }
        }
        return { steps };
    }

    for (const id of tier === 'fast' ? FAST_ORDER : DEEP_ORDER) {
        add(id, TIER_MODELS[id][tier]);
    }
    if (!steps.length) {
        for (const id of PAID_ORDER) {
            add(id, TIER_MODELS[id][tier]);
        }
        if (steps.length) {
            const names = [...new Set(steps.map((s) => providerLabel(s.provider)))].join(' and ');
            return { steps, note: `No free-tier key is active, so Auto is using your paid ${names} key.` };
        }
    }
    return { steps };
}

const FOLLOW_UP = /^(y|yes|yep|yeah|ok|okay|sure|continue|go on|go ahead|proceed|do it|keep going|next|retry|try again)[.!\s]*$/i;
const QUESTION = /^(what|why|how|where|which|who|when|explain|describe|summari[sz]e|show|list|find|search|read|tell|is|are|does|do|can|could|should|would)\b/i;
export function isFollowUp(text: string): boolean {
    return FOLLOW_UP.test(text.trim());
}

const FILE_OPERATION = /^(please\s+)?(create|make|add|delete|remove|rename|move|copy)\s+(an?\s+|the\s+)?(new\s+|empty\s+)?(file|folder|directory|dir)\b/i;
const SMALL_EDIT = /\b(typo|rename|small|tiny|quick|simple|one[- ]liner?|comment|format|spelling|wording)\b/i;
const COMPLEX =
    /\b(build|create|scaffold|implement|develop|architect|refactor|migrate|port|rewrite|convert|integrate|deploy|dockeri[sz]e|set ?up|configure|optimi[sz]e|debug|fix|investigate|feature|endpoint|api|auth\w*|login|tests?|full[- ]?stack|end[- ]to[- ]end|database|backend|frontend|server|production|pipeline|ci|project|app|application|website|site|dashboard|landing page|component|page|screen)\b/gi;

/**
 * Picks a tier without spending a model call: quick questions and small
 * edits go to the fast models, builds and multi-step work to the deep ones.
 */
export function classifyTask(prompt: string, previous?: Tier): { tier: Tier; reason: string } {
    const text = prompt.trim();
    const words = text.split(/\s+/).filter(Boolean).length;

    if (previous && FOLLOW_UP.test(text)) {
        return { tier: previous, reason: 'Continuing the previous task' };
    }
    if (FILE_OPERATION.test(text) && words <= 12) {
        return { tier: 'fast', reason: 'Simple file operation' };
    }
    if (words > 60 || (text.includes('```') && words > 25)) {
        return { tier: 'deep', reason: 'Detailed request' };
    }
    const complexHits = new Set((text.match(COMPLEX) ?? []).map((w) => w.toLowerCase())).size;
    if (SMALL_EDIT.test(text) && complexHits <= 1 && words <= 25) {
        return { tier: 'fast', reason: 'Small edit' };
    }
    if (complexHits >= 2) {
        return { tier: 'deep', reason: 'Multi-step build or change' };
    }
    if (QUESTION.test(text) && words <= 30) {
        return { tier: 'fast', reason: 'Quick question' };
    }
    if (complexHits === 1) {
        return { tier: 'deep', reason: 'Changes code' };
    }
    if (words <= 12) {
        return { tier: 'fast', reason: 'Short request' };
    }
    return { tier: 'deep', reason: 'General task' };
}
