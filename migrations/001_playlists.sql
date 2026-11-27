create table if not exists playlists (
  user_id text not null,
  stage text not null default 'production',
  songs jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now(),
  primary key (user_id, stage)
);
