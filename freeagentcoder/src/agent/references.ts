/**
 * Know-how the agent looks up instead of rediscovering: how strong solutions
 * to a kind of project are put together (blueprints), and how to work when the
 * request is a requirements document (the spec method). Studied from reference
 * solutions and kept short, because every step of the task resends them.
 */

export interface Blueprint {
    id: string;
    name: string;
    /** Matched against the request and any attached document. */
    match: RegExp;
    points: string[];
}

const ASPNET_MVC: Blueprint = {
    id: 'aspnet-mvc',
    name: 'ASP.NET Core MVC business app (CRM, ERP, inventory, HR)',
    match: /\b(?:asp\.?net|\.net\s*(?:core|\d)|razor|entity\s*framework|ef\s*core|c#|csharp)\b/i,
    points: [
        'Folders: Controllers/ (MVC) and Controllers/Api/, Models/ (entities, enums with the workflow rules), Data/ (DbContext, seed), Services/ (business rules), Validation/ (custom attributes), ViewModels/ (form models and API DTOs, never entities), Views/ with Shared/_Layout, _Pager and _Alerts.',
        'SQLite by default so it runs with no install; switching to SQL Server is one line. Seed roles and one demo login per role, and list them in the README.',
        'Program.cs: ASP.NET Core Identity with the password policy and lockout (e.g. 5 tries, 15 minutes); HttpOnly, SameSite cookies; a fallback authorization policy so every page needs login unless marked [AllowAnonymous]; a rate limiter on the login API.',
        'Audit once, centrally: override SaveChangesAsync, read ChangeTracker entries that were Added, Modified or Deleted, and add audit rows with user, action, entity, record id, old and new values, time and IP. The audit screen is read-only.',
        'Row-level access once, centrally: an IQueryable extension (e.g. ForUser) that limits a sales user to their own records, used by every list, details, edit, report and API query, so another user\'s id returns 404.',
        '[ValidateAntiForgeryToken] on every POST. Validation twice: data annotations plus custom attributes (NotPastDate, GreaterThan) for the client, and the same rules again in a service on the server. Unique indexes plus a duplicate check; the API answers 409.',
        'Status changes as an explicit table of allowed transitions; conversions (lead to customer and opportunity) inside one transaction with an audit row.',
        'API controllers with [ApiController], DTOs, and the right codes (200, 201, 400, 401, 403, 404, 409); Swagger in development. Dashboard numbers from the same scoped queries; Chart.js draws data passed from the server.',
        'Done means dotnet build with no warnings, the app starts, and every acceptance step has been walked.',
    ],
};

const API_BACKEND: Blueprint = {
    id: 'api-backend',
    name: 'Backend with users, roles and records (Node or Python)',
    match: /\b(?:role[-\s]?based|rbac|roles?\s+(?:and|&)\s+permissions?|audit\s*(?:log|trail)|crm|erp|inventory|admin\s+panel|multi[-\s]?tenant)\b/i,
    points: [
        'Layers: routes or controllers (HTTP only), services (business rules), a data layer (ORM models and migrations), schemas for input and output (zod or pydantic), and one error handler that returns a consistent JSON error.',
        'Cross-cutting rules written once: an auth middleware, a role and ownership check used by every query, and audit records written by an ORM hook, not by each route.',
        'Passwords with argon2 or bcrypt, lockout after repeated failures, rate-limited login, secrets from environment variables, and no hashes or tokens in any response or log.',
        'Seed data and one demo account per role; README with run steps and the demo logins.',
    ],
};

export const BLUEPRINTS: Blueprint[] = [ASPNET_MVC, API_BACKEND];

/** The blueprints that fit, best first; at most two, to keep every step cheap. */
export function blueprintsFor(text: string): Blueprint[] {
    return BLUEPRINTS.filter((b) => b.match.test(text)).slice(0, 2);
}

const SPEC_WORDS = /\b(?:requirements?|acceptance|mandatory|must|shall|functional|specification|assignment|evaluation\s+criteria|module|checklist|validation\s+rules?)\b/gi;

/** A request that is, or comes with, a requirements document. */
export function isSpec(prompt: string, documentText = ''): boolean {
    const text = `${prompt}\n${documentText}`;
    const hits = text.match(SPEC_WORDS)?.length ?? 0;
    return (documentText.length > 1_500 && hits >= 4) || (prompt.length > 600 && hits >= 6);
}

export const SPEC_METHOD = [
    'This request is a requirements document. Work like an engineer delivering against a spec:',
    '1. Before any code, write REQUIREMENTS.md: every numbered requirement, business rule and acceptance step from the document as a checklist row (id, requirement, where it will be done), marking the mandatory ones.',
    '2. Use the stack the document names. Do not swap it for another.',
    '3. Follow the document\'s own implementation order. Build the cross-cutting parts once, centrally (authentication, authorization, validation, audit, error handling), before the features that rely on them.',
    '4. Seed realistic demo data and one login per role.',
    '5. When it is built, walk the acceptance scenario step by step with real commands (build, run, call the API, tests) and tick each REQUIREMENTS.md row with its evidence. Fix every row that fails.',
    '6. Finish with EXPLAIN.md: the request flow, a requirement → file → how table, and a demo script. Say plainly anything not done.',
].join('\n');

/** The block added to the task: the spec method when it applies, and the blueprints that fit. */
export function referenceBlock(prompt: string, documentText = ''): string {
    const parts: string[] = [];
    if (isSpec(prompt, documentText)) {
        parts.push(SPEC_METHOD);
    }
    for (const blueprint of blueprintsFor(`${prompt}\n${documentText}`)) {
        parts.push(`How strong solutions of this kind are built (${blueprint.name}):\n${blueprint.points.map((p) => `- ${p}`).join('\n')}`);
    }
    return parts.length ? `<reference source="FreeAgentCoder">\n${parts.join('\n\n')}\n</reference>` : '';
}
