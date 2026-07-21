-- Provider-spend accounting: every AI turn attempt (greeting, converse, even
-- empty transcriptions) is counted atomically BEFORE calling paid providers.
alter table public.daily_sessions
  add column if not exists turns_attempted int not null default 0;

create or replace function public.increment_turn_attempts(p_date date)
returns int
language plpgsql
security invoker
as $$
declare
  v_count int;
begin
  insert into public.daily_sessions (user_id, date, turns_attempted)
  values (auth.uid(), p_date, 1)
  on conflict (user_id, date)
  do update set turns_attempted = public.daily_sessions.turns_attempted + 1
  returning turns_attempted into v_count;
  return v_count;
end;
$$;
