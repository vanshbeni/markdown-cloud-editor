-- ─────────────────────────────────────────────────────────────
--  schema.sql  —  MarkCloud Supabase Setup
--  Run this in: Supabase Dashboard → SQL Editor → New Query
-- ─────────────────────────────────────────────────────────────

-- ── Table 1: Rooms ────────────────────────────────────────────
create table if not exists rooms (
  id          uuid primary key default gen_random_uuid(),
  created_at  timestamp with time zone default now()
);

-- ── Table 2: Files ────────────────────────────────────────────
create table if not exists files (
  id         uuid primary key default gen_random_uuid(),
  room_id    uuid references rooms(id) on delete cascade not null,
  name       text not null default 'untitled.md',
  content    text not null default '',
  created_at timestamp with time zone default now(),
  updated_at timestamp with time zone default now()
);

-- ── Index: fast lookup of files by room ──────────────────────
create index if not exists idx_files_room_id on files(room_id);

-- ── RLS: Row-Level Security ───────────────────────────────────
--  Anyone with the room UUID can read/write files in that room.
--  No auth required — the UUID is the access token.

alter table rooms enable row level security;
alter table files enable row level security;

-- Rooms: allow anon to insert and select
create policy "anon can insert rooms"
  on rooms for insert to anon with check (true);

create policy "anon can select rooms"
  on rooms for select to anon using (true);

-- Files: allow anon to do everything (scoped to existing rooms)
create policy "anon can select files"
  on files for select to anon using (true);

create policy "anon can insert files"
  on files for insert to anon with check (true);

create policy "anon can update files"
  on files for update to anon using (true);

create policy "anon can delete files"
  on files for delete to anon using (true);

-- ── Enable Realtime on the files table ───────────────────────
--  Also do this in: Dashboard → Database → Replication → files ✓
alter publication supabase_realtime add table files;
