-- Adds "pending" to ticket and escalation statuses, for cases waiting on the customer or a third
-- party. Pending still counts as open for duplicate detection (only "closed" ends a case).
-- Safe to re-run.

alter table public.support_tickets drop constraint if exists support_tickets_status_check;
alter table public.support_tickets
  add constraint support_tickets_status_check check (status in ('open', 'pending', 'in_progress', 'closed'));

alter table public.escalations drop constraint if exists escalations_status_check;
alter table public.escalations
  add constraint escalations_status_check check (status in ('open', 'pending', 'in_progress', 'closed'));

-- The admin page lists the newest cases first.
create index if not exists support_tickets_created_idx on public.support_tickets (created_at desc);
create index if not exists escalations_created_idx on public.escalations (created_at desc);
