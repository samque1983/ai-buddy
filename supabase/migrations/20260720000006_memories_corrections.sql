-- Long-term memories (atomic facts) + structured corrections extracted post-session.
create table public.user_memories (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  type text not null check (type in ('profile', 'event', 'learning', 'relationship')),
  content text not null check (char_length(content) <= 300),
  importance smallint not null default 3 check (importance between 1 and 5),
  source_conversation_id uuid references public.conversations (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index user_memories_user_idx on public.user_memories (user_id, created_at desc);

create table public.corrections (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  conversation_id uuid not null references public.conversations (id) on delete cascade,
  original text not null,
  improved text not null,
  explanation text not null default '',
  category text not null default 'word-choice'
    check (category in ('grammar', 'word-choice', 'chinglish', 'pronunciation-note')),
  created_at timestamptz not null default now()
);

create index corrections_user_idx on public.corrections (user_id, created_at desc);
