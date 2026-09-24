-- Run once if you have already installed the original supabase.sql.
alter table public.songs add column if not exists effects jsonb default null;
alter table public.songs drop constraint if exists songs_path_key;
-- Versions share their source MP3. The file is removed only with its last version.
