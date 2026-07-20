-- Daily expressions (5 per user per day) + per-expression mastery progress.
create table public.expressions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  daily_session_id uuid not null references public.daily_sessions (id) on delete cascade,
  date date not null,
  english text not null,
  chinese text not null,
  scenario text not null default '',
  formality text not null default 'casual' check (formality in ('casual', 'neutral', 'formal')),
  example_sentence text not null default '',
  common_mistake text not null default '',
  source jsonb,
  created_at timestamptz not null default now()
);

create index expressions_user_date_idx on public.expressions (user_id, date desc);

create table public.expression_progress (
  id uuid primary key default gen_random_uuid(),
  expression_id uuid not null unique references public.expressions (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  status text not null default 'new'
    check (status in ('new', 'seen', 'practicing', 'mastered', 'needs_review')),
  times_practiced int not null default 0,
  last_practiced_at timestamptz,
  review_stage int not null default 0,
  next_review_at date,
  updated_at timestamptz not null default now()
);

create index expression_progress_review_idx on public.expression_progress (user_id, next_review_at);
