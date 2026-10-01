-- Runtime records created by the agent: conversations, turns, retrieval logs,
-- tool calls, tickets, escalations, conversation events, evaluations.

create extension if not exists pgcrypto;

create table if not exists public.conversations (
  id                    uuid primary key default gen_random_uuid(),
  channel               text not null check (channel in ('voice', 'text', 'eval')),
  vapi_call_id          text unique,
  caller_id             text,
  verified_customer_id  text references public.customers (customer_id) on delete set null,
  agent_session_id      text,
  started_at            timestamptz not null default now(),
  ended_at              timestamptz,
  final_status          text not null default 'active'
                        check (final_status in ('active', 'completed', 'escalated', 'ticket_created', 'abandoned', 'error')),
  ended_reason          text,
  summary               text,
  metadata              jsonb not null default '{}'::jsonb,
  created_at            timestamptz not null default now()
);

create index if not exists conversations_started_idx on public.conversations (started_at desc);

create table if not exists public.conversation_turns (
  id                  uuid primary key default gen_random_uuid(),
  conversation_id     uuid not null references public.conversations (id) on delete cascade,
  turn_index          integer not null,
  user_transcript     text not null,
  assistant_response  text not null,
  answer_type         text not null check (answer_type in ('answered', 'clarifying', 'escalated', 'declined', 'lookup')),
  confidence          text check (confidence in ('high', 'medium', 'low')),
  uncertainty_note    text,
  tools_used          text[] not null default '{}',
  latency_ms          integer,
  created_at          timestamptz not null default now(),
  unique (conversation_id, turn_index)
);

create table if not exists public.retrieval_logs (
  id               uuid primary key default gen_random_uuid(),
  conversation_id  uuid references public.conversations (id) on delete cascade,
  query            text not null,
  retrieval_mode   text not null check (retrieval_mode in ('vector', 'fts')),
  chunk_ids        uuid[] not null default '{}',
  chunks           jsonb not null default '[]'::jsonb,
  source_title     text,
  source_summary   text,
  created_at       timestamptz not null default now()
);

create index if not exists retrieval_logs_conversation_idx on public.retrieval_logs (conversation_id);

create table if not exists public.tool_call_logs (
  id               uuid primary key default gen_random_uuid(),
  conversation_id  uuid references public.conversations (id) on delete cascade,
  tool_name        text not null,
  purpose          text not null,
  input_summary    text,
  result_summary   text,
  status           text not null check (status in ('success', 'not_found', 'error', 'denied')),
  error_message    text,
  duration_ms      integer,
  created_at       timestamptz not null default now()
);

create index if not exists tool_call_logs_conversation_idx on public.tool_call_logs (conversation_id);

create sequence if not exists public.ticket_ref_seq start 1001;
create sequence if not exists public.escalation_ref_seq start 5001;

create table if not exists public.support_tickets (
  id               uuid primary key default gen_random_uuid(),
  ticket_ref       text not null unique default ('TKT-' || nextval('public.ticket_ref_seq')::text),
  conversation_id  uuid references public.conversations (id) on delete set null,
  customer_id      text references public.customers (customer_id) on delete set null,
  transaction_id   text references public.transactions (transaction_id) on delete set null,
  category         text not null check (category in ('payment', 'payout', 'invoice', 'account', 'compliance', 'technical', 'other')),
  priority         text not null check (priority in ('low', 'medium', 'high', 'urgent')),
  summary          text not null,
  status           text not null default 'open' check (status in ('open', 'in_progress', 'closed')),
  created_at       timestamptz not null default now()
);

create table if not exists public.escalations (
  id                 uuid primary key default gen_random_uuid(),
  escalation_ref     text not null unique default ('ESC-' || nextval('public.escalation_ref_seq')::text),
  conversation_id    uuid references public.conversations (id) on delete set null,
  ticket_id          uuid references public.support_tickets (id) on delete set null,
  customer_id        text references public.customers (customer_id) on delete set null,
  user_name          text not null,
  user_email         text not null,
  category           text not null check (category in ('compliance', 'account', 'dispute', 'payment', 'other')),
  reason             text not null,
  call_booked        boolean not null default false,
  preferred_time     text,
  follow_up_summary  text,
  status             text not null default 'open' check (status in ('open', 'in_progress', 'closed')),
  created_at         timestamptz not null default now()
);

create table if not exists public.conversation_events (
  id               uuid primary key default gen_random_uuid(),
  conversation_id  uuid references public.conversations (id) on delete cascade,
  event_type       text not null,
  summary          text not null,
  metadata         jsonb not null default '{}'::jsonb,
  created_at       timestamptz not null default now()
);

create index if not exists conversation_events_conversation_idx on public.conversation_events (conversation_id);

create table if not exists public.evaluations (
  id                 uuid primary key default gen_random_uuid(),
  run_id             uuid not null,
  scenario_id        text not null,
  scenario_name      text not null,
  input              text not null,
  expected_behavior  text not null,
  actual_behavior    text not null,
  tools_called       text[] not null default '{}',
  answer_type        text,
  passed             boolean not null,
  notes              text,
  conversation_id    uuid references public.conversations (id) on delete set null,
  created_at         timestamptz not null default now()
);

create index if not exists evaluations_run_idx on public.evaluations (run_id);
