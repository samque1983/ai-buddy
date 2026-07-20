-- Profiles: 1:1 with auth.users, created automatically on signup.
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  nickname text,
  english_level text check (english_level in ('beginner', 'elementary', 'intermediate', 'advanced')),
  goals text[] not null default '{}',
  interests text[] not null default '{}',
  correction_preference text not null default 'balanced'
    check (correction_preference in ('light', 'balanced', 'strict')),
  speech_speed numeric not null default 1.0 check (speech_speed between 0.5 and 1.5),
  subtitles_enabled boolean not null default true,
  selected_character_id uuid references public.characters (id),
  timezone text not null default 'Asia/Shanghai',
  streak_current int not null default 0,
  streak_longest int not null default 0,
  last_active_date date,
  total_talk_seconds int not null default 0,
  onboarding_completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id) values (new.id);
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();
