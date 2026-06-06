-- Migration: create library_entries
-- Foundation F-01: the single, per-user-isolated persistence layer for Gaming Library.
-- Defines public.library_entries with value constraints, a per-user index, RLS enabled,
-- and four granular per-operation policies scoped to the authenticated role on
-- auth.uid() = user_id. The anon role is granted no policy and therefore has no access.

create table public.library_entries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  title text not null,
  platform text not null,
  play_status text not null default 'not_played'
    check (play_status in ('not_played', 'playing_now', 'played', 'completed', 'completed_100')),
  play_time_hours integer check (play_time_hours >= 0),
  date_bought date,
  genre text,
  length_hours numeric,
  release_year integer,
  developer text,
  release_date date,
  igdb_id bigint,
  metadata_status text check (metadata_status in ('matched', 'no_match')),
  created_at timestamptz not null default now()
);

-- Per-user index: covers every per-user query this foundation needs.
create index on public.library_entries (user_id);

-- Row Level Security: mandatory per project convention.
alter table public.library_entries enable row level security;

-- Granular per-operation policies, all scoped to the authenticated role.
-- INSERT/UPDATE carry WITH CHECK so a user can never write rows owned by someone else.
create policy "Users select own entries" on public.library_entries
  for select to authenticated using (auth.uid() = user_id);

create policy "Users insert own entries" on public.library_entries
  for insert to authenticated with check (auth.uid() = user_id);

create policy "Users update own entries" on public.library_entries
  for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "Users delete own entries" on public.library_entries
  for delete to authenticated using (auth.uid() = user_id);
