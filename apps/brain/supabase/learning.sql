-- FreeAgentCoder fleet learning, for Supabase.
--
-- Run this once in the Supabase dashboard: SQL Editor > New query > paste > Run.
-- Running it again is safe: it only creates what is missing and replaces the
-- functions.
--
-- What installs that said "OK, start using the agent" share, so every user's
-- mistakes improve the agent for everyone. Never code, file contents or
-- prompts: general lessons, normalised error patterns, task outcomes and
-- ratings, and chore patterns with names removed. Only the server can touch
-- it: row-level security with no policies, and the functions run only with the
-- service role (secret) key.

-- Lessons learned from corrections, merged when the same rule comes from several installs.
create table if not exists public.fac_lessons (
    hash text primary key,
    text text not null,
    stack text not null default '',
    status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
    occurrences integer not null default 1,
    installs integer not null default 1,
    first_seen timestamptz not null default now(),
    last_seen timestamptz not null default now()
);

-- Errors that came back within a task, normalised (no values, paths or line numbers).
create table if not exists public.fac_error_patterns (
    signature text primary key,
    tool text not null default '',
    stack text not null default '',
    occurrences bigint not null default 1,
    repeats bigint not null default 0,
    first_seen timestamptz not null default now(),
    last_seen timestamptz not null default now(),
    draft_rule text not null default '',
    status text not null default 'new' check (status in ('new', 'drafted', 'approved', 'ignored'))
);

-- One row per finished task: what kind, which model ended it, and how it went.
create table if not exists public.fac_task_outcomes (
    id bigint generated always as identity primary key,
    created_at timestamptz not null default now(),
    install text not null,
    extension text not null default '',
    kind text not null default 'other',
    tier text not null default 'deep',
    provider text not null default '',
    model text not null default '',
    completed boolean not null default false,
    corrected boolean not null default false,
    steps integer not null default 0,
    tokens integer not null default 0,
    duration_ms integer not null default 0,
    paused boolean not null default false,
    repeated_errors integer not null default 0
);
create index if not exists fac_task_outcomes_recent on public.fac_task_outcomes (created_at desc);
create index if not exists fac_task_outcomes_model on public.fac_task_outcomes (tier, provider, created_at desc);

-- A thumbs up or down after a task, with the reasons picked.
create table if not exists public.fac_feedback (
    id bigint generated always as identity primary key,
    created_at timestamptz not null default now(),
    install text not null,
    kind text not null default 'other',
    provider text not null default '',
    model text not null default '',
    good boolean not null,
    reasons text[] not null default '{}'
);
create index if not exists fac_feedback_recent on public.fac_feedback (created_at desc);

-- Chores Fyx learned, as patterns with names removed.
create table if not exists public.fac_fyx_patterns (
    pattern text primary key,
    command text not null,
    occurrences integer not null default 1,
    installs integer not null default 1,
    status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
    first_seen timestamptz not null default now(),
    last_seen timestamptz not null default now()
);

-- Examples for fine-tuning, built from our own benchmark runs and approved rules.
create table if not exists public.fac_training_examples (
    id bigint generated always as identity primary key,
    created_at timestamptz not null default now(),
    source text not null check (source in ('benchmark', 'lesson', 'error_rule')),
    kind text not null default 'other',
    situation text not null,
    bad_step text not null default '',
    better_step text not null,
    status text not null default 'pending' check (status in ('pending', 'approved', 'rejected'))
);

-- Which install has already counted towards a merged row, so "installs" counts people, not repeats.
create table if not exists public.fac_learning_seen (
    kind text not null,
    ref text not null,
    install text not null,
    primary key (kind, ref, install)
);

alter table public.fac_lessons enable row level security;
alter table public.fac_error_patterns enable row level security;
alter table public.fac_task_outcomes enable row level security;
alter table public.fac_feedback enable row level security;
alter table public.fac_fyx_patterns enable row level security;
alter table public.fac_training_examples enable row level security;
alter table public.fac_learning_seen enable row level security;
revoke all on table public.fac_lessons, public.fac_error_patterns, public.fac_task_outcomes, public.fac_feedback,
    public.fac_fyx_patterns, public.fac_training_examples, public.fac_learning_seen from anon, authenticated;

-- True the first time this install reports this item.
create or replace function public.fac_learning_first(p_kind text, p_ref text, p_install text) returns boolean
language plpgsql as $$
begin
    insert into public.fac_learning_seen (kind, ref, install) values (p_kind, p_ref, p_install) on conflict do nothing;
    return found;
end;
$$;

create or replace function public.fac_learn_lesson(p_hash text, p_text text, p_stack text, p_install text) returns void
language plpgsql as $$
declare
    fresh boolean := public.fac_learning_first('lesson', p_hash, p_install);
begin
    insert into public.fac_lessons (hash, text, stack) values (p_hash, p_text, p_stack)
    on conflict (hash) do update set
        occurrences = public.fac_lessons.occurrences + 1,
        installs = public.fac_lessons.installs + case when fresh then 1 else 0 end,
        last_seen = now();
end;
$$;

create or replace function public.fac_learn_error(p_signature text, p_tool text, p_stack text, p_count integer, p_repeats integer) returns void
language plpgsql as $$
begin
    insert into public.fac_error_patterns (signature, tool, stack, occurrences, repeats)
    values (p_signature, p_tool, p_stack, greatest(p_count, 1), greatest(p_repeats, 0))
    on conflict (signature) do update set
        occurrences = public.fac_error_patterns.occurrences + greatest(p_count, 1),
        repeats = public.fac_error_patterns.repeats + greatest(p_repeats, 0),
        last_seen = now();
end;
$$;

create or replace function public.fac_learn_fyx(p_pattern text, p_command text, p_install text) returns void
language plpgsql as $$
declare
    fresh boolean := public.fac_learning_first('fyx', p_pattern, p_install);
begin
    insert into public.fac_fyx_patterns (pattern, command) values (p_pattern, p_command)
    on conflict (pattern) do update set
        occurrences = public.fac_fyx_patterns.occurrences + 1,
        installs = public.fac_fyx_patterns.installs + case when fresh then 1 else 0 end,
        last_seen = now();
end;
$$;

-- How each model does on each tier over the last p_days: the evidence for learned routing.
create or replace function public.fac_model_scores(p_days integer) returns table (
    tier text, provider text, model text, tasks bigint, completed bigint, corrected bigint,
    avg_steps numeric, avg_tokens numeric, good bigint, bad bigint
)
language sql stable as $$
    with o as (
        select tier, provider, model, count(*) as tasks, count(*) filter (where completed) as completed,
               count(*) filter (where corrected) as corrected, avg(steps) as avg_steps, avg(tokens) as avg_tokens
        from public.fac_task_outcomes
        where created_at > now() - make_interval(days => p_days) and provider <> ''
        group by tier, provider, model
    ), f as (
        select provider, model, count(*) filter (where good) as good, count(*) filter (where not good) as bad
        from public.fac_feedback
        where created_at > now() - make_interval(days => p_days)
        group by provider, model
    )
    select o.tier, o.provider, o.model, o.tasks, o.completed, o.corrected,
           round(o.avg_steps, 1), round(o.avg_tokens), coalesce(f.good, 0), coalesce(f.bad, 0)
    from o left join f on f.provider = o.provider and f.model = o.model;
$$;

revoke all on function public.fac_learning_first(text, text, text), public.fac_learn_lesson(text, text, text, text),
    public.fac_learn_error(text, text, text, integer, integer), public.fac_learn_fyx(text, text, text),
    public.fac_model_scores(integer) from public, anon, authenticated;
