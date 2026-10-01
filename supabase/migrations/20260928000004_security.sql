-- Lock everything down: RLS on, no policies for anon/authenticated.
-- Only server-side code using the service-role key (which bypasses RLS) can read or write.

do $$
declare
  t text;
begin
  foreach t in array array[
    'customers', 'transactions', 'payouts',
    'conversations', 'conversation_turns', 'retrieval_logs', 'tool_call_logs',
    'support_tickets', 'escalations', 'conversation_events', 'evaluations', 'kb_chunks'
  ]
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on table public.%I from anon, authenticated', t);
  end loop;
end
$$;

revoke all on sequence public.ticket_ref_seq, public.escalation_ref_seq from anon, authenticated;
revoke execute on function public.search_kb_chunks_fts(text, integer) from public, anon, authenticated;
revoke execute on function public.match_kb_chunks(extensions.vector, integer) from public, anon, authenticated;
grant execute on function public.search_kb_chunks_fts(text, integer) to service_role;
grant execute on function public.match_kb_chunks(extensions.vector, integer) to service_role;
