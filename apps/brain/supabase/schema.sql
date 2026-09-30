-- FreeAgentCoder website storage, for Supabase.
--
-- Run this once in the Supabase dashboard: SQL Editor > New query > paste > Run.
-- Running it again is safe; it only creates what is missing and replaces the
-- functions.
--
-- It holds the admin page's settings (the encrypted key pool, plans,
-- specialists) and the anonymous counts. Only the server can touch it: the
-- tables have row-level security with no policies, and the functions can only
-- be called with the service role (secret) key, never the public anon key.

create table if not exists public.fac_kv (
    key text primary key,
    value jsonb not null,
    expires_at timestamptz not null
);

create table if not exists public.fac_kv_members (
    key text not null references public.fac_kv (key) on delete cascade,
    member text not null,
    primary key (key, member)
);

create index if not exists fac_kv_expires on public.fac_kv (expires_at);

alter table public.fac_kv enable row level security;
alter table public.fac_kv_members enable row level security;
revoke all on table public.fac_kv, public.fac_kv_members from anon, authenticated;

-- Now and then, clear out what has expired. Called from the busy writers.
create or replace function public.fac_kv_sweep() returns void
language plpgsql as $$
begin
    if random() < 0.02 then
        delete from public.fac_kv where expires_at < now() - interval '1 hour';
    end if;
end;
$$;

-- SET key value EX ttl
create or replace function public.fac_kv_put(p_key text, p_value text, p_ttl integer) returns void
language plpgsql as $$
begin
    insert into public.fac_kv (key, value, expires_at)
    values (p_key, to_jsonb(p_value), now() + make_interval(secs => p_ttl))
    on conflict (key) do update set value = excluded.value, expires_at = excluded.expires_at;
    perform public.fac_kv_sweep();
end;
$$;

-- MGET key...  (values that are not text, such as counts, read as null)
create or replace function public.fac_kv_get_many(p_keys text[]) returns table (k text, v text)
language sql stable as $$
    select kv.key, case when jsonb_typeof(kv.value) = 'string' then kv.value #>> '{}' end
    from public.fac_kv kv
    where kv.key = any (p_keys) and kv.expires_at > now();
$$;

-- SET key 1 EX ttl NX: true only when the key was not already there.
create or replace function public.fac_kv_first_in(p_key text, p_ttl integer) returns boolean
language plpgsql as $$
begin
    insert into public.fac_kv (key, value, expires_at)
    values (p_key, to_jsonb('1'::text), now() + make_interval(secs => p_ttl))
    on conflict (key) do update set value = excluded.value, expires_at = excluded.expires_at
    where public.fac_kv.expires_at <= now();
    return found;
end;
$$;

-- HINCRBY key field by (for every field), then EXPIRE key ttl.
create or replace function public.fac_kv_add_counts(p_key text, p_counts jsonb, p_ttl integer) returns void
language plpgsql as $$
declare
    current jsonb;
    merged jsonb;
begin
    select case when jsonb_typeof(value) = 'object' and expires_at > now() then value else '{}'::jsonb end
    into current
    from public.fac_kv where key = p_key
    for update;
    current := coalesce(current, '{}'::jsonb);
    select coalesce(jsonb_object_agg(f, coalesce((current ->> f)::bigint, 0) + coalesce((p_counts ->> f)::bigint, 0)), '{}'::jsonb)
    into merged
    from (select jsonb_object_keys(current) as f union select jsonb_object_keys(p_counts)) fields;
    insert into public.fac_kv (key, value, expires_at)
    values (p_key, merged, now() + make_interval(secs => p_ttl))
    on conflict (key) do update set value = excluded.value, expires_at = excluded.expires_at;
    perform public.fac_kv_sweep();
end;
$$;

-- HGETALL key
create or replace function public.fac_kv_counts(p_key text) returns jsonb
language sql stable as $$
    select coalesce(
        (select value from public.fac_kv where key = p_key and expires_at > now() and jsonb_typeof(value) = 'object'),
        '{}'::jsonb
    );
$$;

-- SADD key member, then EXPIRE key ttl. An expired set starts again empty.
create or replace function public.fac_kv_add_member(p_key text, p_member text, p_ttl integer) returns void
language plpgsql as $$
begin
    delete from public.fac_kv where key = p_key and expires_at <= now();
    insert into public.fac_kv (key, value, expires_at)
    values (p_key, '"set"'::jsonb, now() + make_interval(secs => p_ttl))
    on conflict (key) do update set expires_at = excluded.expires_at;
    insert into public.fac_kv_members (key, member) values (p_key, p_member) on conflict do nothing;
end;
$$;

-- SCARD key
create or replace function public.fac_kv_member_count(p_key text) returns bigint
language sql stable as $$
    select count(*) from public.fac_kv_members m
    join public.fac_kv kv on kv.key = m.key
    where m.key = p_key and kv.expires_at > now();
$$;

-- SRANDMEMBER key limit
create or replace function public.fac_kv_members_of(p_key text, p_limit integer) returns setof text
language sql volatile as $$
    select m.member from public.fac_kv_members m
    join public.fac_kv kv on kv.key = m.key
    where m.key = p_key and kv.expires_at > now()
    order by random()
    limit p_limit;
$$;

do $$
declare
    fn text;
begin
    foreach fn in array array[
        'fac_kv_sweep()', 'fac_kv_put(text, text, integer)', 'fac_kv_get_many(text[])', 'fac_kv_first_in(text, integer)',
        'fac_kv_add_counts(text, jsonb, integer)', 'fac_kv_counts(text)', 'fac_kv_add_member(text, text, integer)',
        'fac_kv_member_count(text)', 'fac_kv_members_of(text, integer)'
    ] loop
        execute format('revoke all on function public.%s from public, anon, authenticated', fn);
        execute format('grant execute on function public.%s to service_role', fn);
    end loop;
end;
$$;

-- Tell the API about the new functions straight away.
notify pgrst, 'reload schema';
