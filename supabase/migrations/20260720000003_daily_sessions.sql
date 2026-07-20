-- Daily sessions: one row per user per (timezone-local) day.
-- Anchors the day's 5 expressions, talk time, and streak accounting.
create table public.daily_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  date date not null,
  expressions_generated boolean not null default false,
  conversation_count int not null default 0,
  talk_seconds int not null default 0,
  completed boolean not null default false,
  created_at timestamptz not null default now(),
  unique (user_id, date)
);

create index daily_sessions_user_date_idx on public.daily_sessions (user_id, date desc);
