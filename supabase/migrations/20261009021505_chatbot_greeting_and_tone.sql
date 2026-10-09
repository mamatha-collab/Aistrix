-- Chatbot apps: the first message users see, and a tone preset that the
-- backend appends to the system prompt at run time.

alter table public.apps add column if not exists greeting text;
alter table public.apps add column if not exists tone text;

alter table public.apps drop constraint if exists apps_greeting_length;
alter table public.apps add constraint apps_greeting_length
  check (greeting is null or length(greeting) <= 1000);

alter table public.apps drop constraint if exists apps_tone_preset;
alter table public.apps add constraint apps_tone_preset
  check (tone is null or tone in ('friendly', 'professional', 'concise', 'playful', 'empathetic'));
