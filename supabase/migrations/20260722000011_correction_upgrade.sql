-- Distinguish naturalness "upgrades" (correct-but-plain speech leveled up) from
-- error corrections, so the summary can surface them in their own section.
alter table public.corrections
  add column if not exists is_upgrade boolean not null default false;
