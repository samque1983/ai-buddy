-- Conversations + turn-by-turn messages.
create table public.conversations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  character_id uuid not null references public.characters (id),
  daily_session_id uuid references public.daily_sessions (id) on delete set null,
  status text not null default 'active'
    check (status in ('active', 'ended', 'processing', 'finalized', 'failed')),
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  duration_seconds int not null default 0,
  summary jsonb,
  tomorrow_greeting text,
  created_at timestamptz not null default now()
);

create index conversations_user_idx on public.conversations (user_id, started_at desc);

create table public.messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations (id) on delete cascade,
  seq int not null,
  role text not null check (role in ('user', 'assistant')),
  content text not null,
  audio_duration_ms int,
  created_at timestamptz not null default now(),
  unique (conversation_id, seq)
);

create index messages_conversation_idx on public.messages (conversation_id, seq);
