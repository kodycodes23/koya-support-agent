-- Public (guest) access and web chat. Safe to re-run.
--  * conversations.channel gains 'chat' (typed conversations on the website).
--  * escalations.category gains 'onboarding' (prospective customers who want to open an account).

alter table public.conversations drop constraint if exists conversations_channel_check;
alter table public.conversations
  add constraint conversations_channel_check check (channel in ('voice', 'chat', 'text', 'eval'));

alter table public.escalations drop constraint if exists escalations_category_check;
alter table public.escalations
  add constraint escalations_category_check check (category in ('compliance', 'account', 'dispute', 'payment', 'onboarding', 'other'));
