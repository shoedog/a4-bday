create extension if not exists pgcrypto;

create table if not exists public.invite_codes (
  id uuid primary key default gen_random_uuid(),
  label text not null default 'Party invite',
  code_hash text not null unique,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.rsvps (
  id uuid primary key default gen_random_uuid(),
  invite_code_id uuid not null references public.invite_codes(id) on delete cascade,
  guest_token_hash text not null,
  lookup_key text not null,
  guest_name text not null,
  attending text not null check (attending in ('yes', 'no')),
  adults integer not null default 0 check (adults >= 0 and adults <= 12),
  children integer not null default 0 check (children >= 0 and children <= 12),
  note text default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint rsvps_invite_token_key unique (invite_code_id, guest_token_hash)
);

alter table public.rsvps drop constraint if exists rsvps_lookup_key_key;
alter table public.rsvps add column if not exists invite_code_id uuid references public.invite_codes(id) on delete cascade;
alter table public.rsvps add column if not exists guest_token_hash text;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'rsvps_invite_token_key'
      and conrelid = 'public.rsvps'::regclass
  ) then
    alter table public.rsvps
      add constraint rsvps_invite_token_key unique (invite_code_id, guest_token_hash);
  end if;
end;
$$;

alter table public.invite_codes enable row level security;
alter table public.rsvps enable row level security;

revoke all on public.invite_codes from anon;
revoke all on public.rsvps from anon;

drop policy if exists "Invite guests can read RSVP list" on public.rsvps;
drop policy if exists "Invite guests can add RSVP" on public.rsvps;
drop policy if exists "Invite guests can update RSVP" on public.rsvps;

create or replace function public.set_current_timestamp_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists set_rsvps_updated_at on public.rsvps;
create trigger set_rsvps_updated_at
  before update on public.rsvps
  for each row
  execute function public.set_current_timestamp_updated_at();

create or replace function public.rsvp_code_hash(p_code text)
returns text
language sql
stable
as $$
  select encode(digest(lower(trim(coalesce(p_code, ''))), 'sha256'), 'hex')
$$;

create or replace function public.create_invite_code(
  p_code text,
  p_label text default 'Party invite'
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  if length(trim(coalesce(p_code, ''))) < 6 then
    raise exception 'invite code must be at least 6 characters';
  end if;

  insert into public.invite_codes (label, code_hash)
  values (
    coalesce(nullif(trim(p_label), ''), 'Party invite'),
    public.rsvp_code_hash(p_code)
  )
  on conflict (code_hash) do update
    set active = true,
        label = excluded.label
  returning id into v_id;

  return v_id;
end;
$$;

create or replace function public.invite_code_id_for(p_code text)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select id
  from public.invite_codes
  where active = true
    and code_hash = public.rsvp_code_hash(p_code)
  limit 1
$$;

create or replace function public.submit_rsvp(
  p_invite_code text,
  p_guest_token text,
  p_guest_name text,
  p_attending text,
  p_adults integer,
  p_children integer,
  p_note text default ''
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_invite_id uuid;
  v_guest_name text;
  v_lookup_key text;
  v_token_hash text;
  v_note text;
  v_adults integer;
  v_children integer;
begin
  v_invite_id := public.invite_code_id_for(p_invite_code);

  if v_invite_id is null then
    raise exception 'invalid invite code';
  end if;

  v_guest_name := regexp_replace(trim(coalesce(p_guest_name, '')), '[[:space:]]+', ' ', 'g');
  v_note := left(regexp_replace(trim(coalesce(p_note, '')), '[[:space:]]+', ' ', 'g'), 220);

  if length(v_guest_name) < 1 or length(v_guest_name) > 120 then
    raise exception 'guest name must be between 1 and 120 characters';
  end if;

  if p_attending not in ('yes', 'no') then
    raise exception 'attending must be yes or no';
  end if;

  if length(trim(coalesce(p_guest_token, ''))) < 16 then
    raise exception 'missing RSVP token';
  end if;

  v_adults := greatest(0, least(12, coalesce(p_adults, 0)));
  v_children := greatest(0, least(12, coalesce(p_children, 0)));

  if p_attending = 'no' then
    v_adults := 0;
    v_children := 0;
  end if;

  v_token_hash := encode(digest(p_guest_token, 'sha256'), 'hex');
  v_lookup_key := lower(regexp_replace(v_guest_name, '[^[:alnum:]]+', '-', 'g'));
  v_lookup_key := trim(both '-' from v_lookup_key);

  if v_lookup_key = '' then
    v_lookup_key := encode(digest(v_guest_name, 'sha256'), 'hex');
  end if;

  update public.rsvps
  set guest_name = v_guest_name,
      lookup_key = v_lookup_key,
      attending = p_attending,
      adults = v_adults,
      children = v_children,
      note = v_note
  where invite_code_id = v_invite_id
    and guest_token_hash = v_token_hash;

  if not found then
    insert into public.rsvps (
      invite_code_id,
      guest_token_hash,
      lookup_key,
      guest_name,
      attending,
      adults,
      children,
      note
    )
    values (
      v_invite_id,
      v_token_hash,
      v_lookup_key,
      v_guest_name,
      p_attending,
      v_adults,
      v_children,
      v_note
    );
  end if;
end;
$$;

create or replace function public.list_rsvps(p_invite_code text)
returns table (
  guest_name text,
  adults integer,
  children integer
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_invite_id uuid;
begin
  v_invite_id := public.invite_code_id_for(p_invite_code);

  if v_invite_id is null then
    raise exception 'invalid invite code';
  end if;

  return query
    select r.guest_name, r.adults, r.children
    from public.rsvps r
    where r.invite_code_id = v_invite_id
      and r.attending = 'yes'
    order by lower(r.guest_name);
end;
$$;

revoke all on function public.rsvp_code_hash(text) from public, anon;
revoke all on function public.create_invite_code(text, text) from public, anon;
revoke all on function public.invite_code_id_for(text) from public, anon;
grant execute on function public.submit_rsvp(text, text, text, text, integer, integer, text) to anon;
grant execute on function public.list_rsvps(text) to anon;
