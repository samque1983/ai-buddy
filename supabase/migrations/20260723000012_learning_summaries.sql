-- Whole-journey learning summary (one row per user), shown on the stats page.
-- Written by the post-session pipeline (service role); users read their own.
create table if not exists public.learning_summaries (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  content jsonb not null,
  updated_at timestamptz not null default now()
);

alter table public.learning_summaries enable row level security;

create policy "own learning_summaries" on public.learning_summaries
  for select using (auth.uid() = user_id);
