-- Approved knowledge base stored as chunks.
-- Full-text search always works; vector search is used when embeddings are populated
-- (EMBEDDINGS_API_KEY set at ingest time). Embeddings are 1024-dim for both providers.

create extension if not exists vector with schema extensions;

create table if not exists public.kb_chunks (
  id            uuid primary key default gen_random_uuid(),
  chunk_key     text not null unique,         -- stable slug so re-ingesting upserts instead of duplicating
  source_title  text not null,                -- e.g. "RelayPay Knowledge Base › Frequently Asked Questions"
  section       text not null,                -- the heading the chunk sits under
  content       text not null,
  summary       text not null,
  position      integer not null,
  embedding     extensions.vector(1024),
  tsv           tsvector generated always as (
                  setweight(to_tsvector('english'::regconfig, coalesce(section, '')), 'A') ||
                  setweight(to_tsvector('english'::regconfig, coalesce(content, '')), 'B')
                ) stored,
  updated_at    timestamptz not null default now()
);

create index if not exists kb_chunks_tsv_idx on public.kb_chunks using gin (tsv);
create index if not exists kb_chunks_embedding_idx on public.kb_chunks
  using hnsw (embedding extensions.vector_cosine_ops);

-- Full-text search. Uses OR semantics over the query's lexemes so conversational
-- questions ("what fees does RelayPay charge...") still match; ranking rewards chunks
-- that match more terms, with section headings weighted above body text.
create or replace function public.search_kb_chunks_fts(query_text text, match_count integer default 4)
returns table (id uuid, source_title text, section text, content text, summary text, score real)
language sql
stable
security invoker
set search_path = public
as $$
  -- Stopword-only or empty queries have no lexemes: q is then empty and no rows return
  -- (to_tsquery on an empty string would raise a syntax error).
  with lexemes as (
    select array(
      select quote_literal(lexeme) from unnest(to_tsvector('english', coalesce(query_text, '')))
      -- The brand name appears in nearly every chunk, so it only adds noise to ranking.
      where lexeme not in ('relaypay', 'relay', 'pay')
    ) as terms
  ),
  q as (
    select to_tsquery('simple', array_to_string(terms, ' | ')) as tsq
    from lexemes
    where cardinality(terms) > 0
  )
  select c.id, c.source_title, c.section, c.content, c.summary,
         ts_rank_cd(c.tsv, q.tsq, 32)::real as score
  from public.kb_chunks c, q
  where c.tsv @@ q.tsq
  order by score desc, c.position asc
  limit greatest(match_count, 1);
$$;

-- Vector search (cosine similarity).
create or replace function public.match_kb_chunks(query_embedding extensions.vector(1024), match_count integer default 4)
returns table (id uuid, source_title text, section text, content text, summary text, score real)
language sql
stable
security invoker
set search_path = public, extensions
as $$
  select c.id, c.source_title, c.section, c.content, c.summary,
         (1 - (c.embedding <=> query_embedding))::real as score
  from public.kb_chunks c
  where c.embedding is not null
  order by c.embedding <=> query_embedding
  limit greatest(match_count, 1);
$$;
