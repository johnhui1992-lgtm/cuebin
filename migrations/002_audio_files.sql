-- Uploaded MP3 bytes (metadata stays in playlists.songs JSONB).
-- Prefer Postgres BYTEA on Cursor publish-app hosting (no object store attached).
create table if not exists audio_files (
  id text not null,
  user_id text not null,
  stage text not null default 'production',
  filename text not null,
  mime_type text not null default 'audio/mpeg',
  byte_size integer not null,
  data bytea not null,
  created_at timestamptz not null default now(),
  primary key (user_id, stage, id)
);

create index if not exists audio_files_user_stage_idx
  on audio_files (user_id, stage);
