-- Seed tables: customers, transactions, payouts.
-- Columns mirror assets/seed-data/*.csv and the schema guide.

create table if not exists public.customers (
  customer_id     text primary key,
  company_name    text not null,
  contact_name    text not null,
  contact_email   text not null,
  plan            text not null check (plan in ('Starter', 'Growth', 'Scale')),
  account_status  text not null check (account_status in ('active', 'restricted', 'pending verification')),
  region          text not null,
  kyc_status      text not null check (kyc_status in ('pending', 'approved', 'review required')),
  support_notes   text not null default ''
);

create unique index if not exists customers_contact_email_key on public.customers (lower(contact_email));
create index if not exists customers_company_name_idx on public.customers (lower(company_name));

create table if not exists public.transactions (
  transaction_id       text primary key,
  customer_id          text not null references public.customers (customer_id) on delete cascade,
  transaction_type     text not null check (transaction_type in ('incoming transfer', 'outgoing payout', 'invoice payment')),
  amount               numeric(14, 2) not null,
  currency             text not null,
  destination_country  text,
  status               text not null check (status in ('processing', 'completed', 'delayed', 'failed', 'review required')),
  created_at           date not null,
  estimated_arrival    date,
  support_summary      text not null default ''
);

create index if not exists transactions_customer_idx on public.transactions (customer_id);

create table if not exists public.payouts (
  payout_id       text primary key,
  transaction_id  text references public.transactions (transaction_id) on delete set null,
  customer_id     text not null references public.customers (customer_id) on delete cascade,
  recipient_name  text not null,
  amount          numeric(14, 2) not null,
  currency        text not null,
  status          text not null check (status in ('scheduled', 'processing', 'completed', 'failed', 'review required')),
  scheduled_for   date,
  failure_reason  text
);

create index if not exists payouts_transaction_idx on public.payouts (transaction_id);
create index if not exists payouts_customer_idx on public.payouts (customer_id);
