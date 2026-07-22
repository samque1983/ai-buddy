-- Persist the latest attempt score (0-10) so the UI can mirror mastery and
-- so review scheduling is driven by quality, not just "did they try it".
alter table public.expression_progress
  add column if not exists last_score smallint check (last_score between 0 and 10);
