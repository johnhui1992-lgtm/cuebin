-- Chunked MP3 upload sessions (bypass host body-size caps on single POSTs).
create table if not exists audio_upload_sessions (
  id text not null,
  user_id text not null,
  stage text not null default 'production',
  filename text not null,
  mime_type text not null default 'audio/mpeg',
  total_bytes integer not null,
  created_at timestamptz not null default now(),
  primary key (user_id, stage, id)
);

create table if not exists audio_upload_chunks (
  user_id text not null,
  stage text not null default 'production',
  session_id text not null,
  chunk_index integer not null,
  byte_size integer not null,
  data bytea not null,
  primary key (user_id, stage, session_id, chunk_index)
);

create index if not exists audio_upload_chunks_session_idx
  on audio_upload_chunks (user_id, stage, session_id);
