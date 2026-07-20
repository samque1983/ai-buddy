-- Row Level Security: users only touch their own rows; characters are public read.
alter table public.characters enable row level security;
alter table public.profiles enable row level security;
alter table public.daily_sessions enable row level security;
alter table public.conversations enable row level security;
alter table public.messages enable row level security;
alter table public.expressions enable row level security;
alter table public.expression_progress enable row level security;
alter table public.user_memories enable row level security;
alter table public.corrections enable row level security;

create policy "characters are readable by everyone"
  on public.characters for select using (true);

create policy "own profile" on public.profiles
  for all using (auth.uid() = id) with check (auth.uid() = id);

create policy "own daily_sessions" on public.daily_sessions
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "own conversations" on public.conversations
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "own messages" on public.messages
  for all using (
    exists (
      select 1 from public.conversations c
      where c.id = conversation_id and c.user_id = auth.uid()
    )
  ) with check (
    exists (
      select 1 from public.conversations c
      where c.id = conversation_id and c.user_id = auth.uid()
    )
  );

create policy "own expressions" on public.expressions
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "own expression_progress" on public.expression_progress
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "own user_memories" on public.user_memories
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "own corrections" on public.corrections
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
