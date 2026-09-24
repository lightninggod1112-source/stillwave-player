-- Replace YOUR_EMAIL@example.com with your own email address before running.
-- Run once in Supabase SQL Editor. The tables and bucket deny access to everyone else.

create or replace function public.is_music_owner()
returns boolean
language sql stable security invoker
set search_path = ''
as $$
  select lower(coalesce((select auth.jwt()->>'email'), '')) = lower('YOUR_EMAIL@example.com')
    and (select auth.uid()) is not null;
$$;

grant execute on function public.is_music_owner() to authenticated;

create table if not exists public.songs (
  id uuid primary key,
  user_id uuid not null references auth.users(id),
  title text not null,
  artist text not null default 'Unknown artist',
  path text not null unique,
  duration integer not null default 0,
  created_at timestamptz not null default now()
);
create table if not exists public.playlists (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id),
  name text not null,
  created_at timestamptz not null default now()
);
create table if not exists public.playlist_songs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id),
  playlist_id uuid not null references public.playlists(id) on delete cascade,
  song_id uuid not null references public.songs(id) on delete cascade,
  position integer not null default 0,
  unique(playlist_id,song_id)
);

alter table public.songs enable row level security;
alter table public.playlists enable row level security;
alter table public.playlist_songs enable row level security;

grant select, insert, update, delete on public.songs, public.playlists, public.playlist_songs to authenticated;

create policy "owner reads songs" on public.songs for select to authenticated using (public.is_music_owner() and user_id = (select auth.uid()));
create policy "owner adds songs" on public.songs for insert to authenticated with check (public.is_music_owner() and user_id = (select auth.uid()) and path like (select auth.uid())::text || '/%');
create policy "owner edits songs" on public.songs for update to authenticated using (public.is_music_owner() and user_id = (select auth.uid())) with check (public.is_music_owner() and user_id = (select auth.uid()));
create policy "owner deletes songs" on public.songs for delete to authenticated using (public.is_music_owner() and user_id = (select auth.uid()));
create policy "owner reads playlists" on public.playlists for select to authenticated using (public.is_music_owner() and user_id = (select auth.uid()));
create policy "owner adds playlists" on public.playlists for insert to authenticated with check (public.is_music_owner() and user_id = (select auth.uid()));
create policy "owner edits playlists" on public.playlists for update to authenticated using (public.is_music_owner() and user_id = (select auth.uid())) with check (public.is_music_owner() and user_id = (select auth.uid()));
create policy "owner deletes playlists" on public.playlists for delete to authenticated using (public.is_music_owner() and user_id = (select auth.uid()));
create policy "owner reads entries" on public.playlist_songs for select to authenticated using (public.is_music_owner() and user_id = (select auth.uid()));
create policy "owner adds entries" on public.playlist_songs for insert to authenticated with check (public.is_music_owner() and user_id = (select auth.uid()) and exists(select 1 from public.playlists p where p.id=playlist_id and p.user_id=(select auth.uid())) and exists(select 1 from public.songs s where s.id=song_id and s.user_id=(select auth.uid())));
create policy "owner edits entries" on public.playlist_songs for update to authenticated using (public.is_music_owner() and user_id = (select auth.uid())) with check (public.is_music_owner() and user_id = (select auth.uid()));
create policy "owner deletes entries" on public.playlist_songs for delete to authenticated using (public.is_music_owner() and user_id = (select auth.uid()));

insert into storage.buckets (id,name,public,file_size_limit,allowed_mime_types)
values ('music','music',false,52428800,array['audio/mpeg'])
on conflict (id) do update set public=false,file_size_limit=52428800,allowed_mime_types=array['audio/mpeg'];
create policy "owner reads audio" on storage.objects for select to authenticated using (bucket_id='music' and public.is_music_owner() and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "owner uploads audio" on storage.objects for insert to authenticated with check (bucket_id='music' and public.is_music_owner() and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "owner deletes audio" on storage.objects for delete to authenticated using (bucket_id='music' and public.is_music_owner() and (storage.foldername(name))[1] = (select auth.uid())::text);
-- Run once if you have already installed the original supabase.sql.
alter table public.songs add column if not exists effects jsonb default null;
alter table public.songs drop constraint if exists songs_path_key;
-- Versions share their source MP3. The file is removed only with its last version.
