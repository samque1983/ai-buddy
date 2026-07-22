-- Curated, frequency/priority-ranked learning content organized into packs
-- (e.g. 'daily-core', 'ielts'). Packs are data, not code: adding a new pack is
-- inserting rows, the selection engine is pack-agnostic. Public read, seeded.
create table public.curriculum_expressions (
  id uuid primary key default gen_random_uuid(),
  pack text not null,
  rank int not null, -- priority within the pack; 1 = teach first
  level text not null default 'elementary'
    check (level in ('beginner', 'elementary', 'intermediate', 'advanced')),
  english text not null,
  chinese text not null,
  scenario text not null default '',
  formality text not null default 'casual' check (formality in ('casual', 'neutral', 'formal')),
  example_sentence text not null default '',
  common_mistake text not null default '',
  created_at timestamptz not null default now(),
  unique (pack, english)
);

create index curriculum_pack_rank_idx on public.curriculum_expressions (pack, rank);

alter table public.curriculum_expressions enable row level security;
create policy "curriculum readable by everyone"
  on public.curriculum_expressions for select using (true);

-- Which curriculum packs the user is currently learning from.
alter table public.profiles
  add column if not exists active_packs text[] not null default '{daily-core}';
