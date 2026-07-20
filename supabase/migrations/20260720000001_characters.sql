-- Characters: the 4 fixed AI companions. Seeded; admin-managed, public read.
create table public.characters (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  name text not null,
  avatar_url text not null default '',
  tts_voice text not null,
  preview_audio_url text not null default '',
  preview_text text not null default '',
  tagline text not null default '',
  suited_for text not null default '',
  personality text not null default '',
  speaking_style text not null default '',
  correction_style text not null default '',
  system_prompt_fragment text not null default '',
  is_active boolean not null default true,
  sort_order int not null default 0,
  created_at timestamptz not null default now()
);
