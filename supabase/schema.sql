-- Shalom PG — Supabase schema. Paste into Supabase → SQL Editor → Run (once, on a new project).
--
-- Who can do what
--   Owners (your parents): full control of their own houses, residents, payments and reminders. Nothing else.
--   Residents: can read their own profile/payments, edit only safe personal fields (photo, ID, emergency
--              contact, reminder channel), and report "I've paid". They can NEVER change rent, deposit,
--              room, due date or approval status, and can never mark a payment as received.

create extension if not exists pgcrypto;

-- ---------- tables ----------
create table public.owners (
  id uuid primary key references auth.users on delete cascade,
  name text not null default '',
  email text,
  phone text,
  upi_id text,
  upi_name text,
  pay_link text,
  remind_days int not null default 3,
  template text,
  created_at timestamptz not null default now()
);

create table public.houses (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.owners on delete cascade,
  name text not null,
  address text,
  hue int not null default 150,
  join_code text not null unique,
  created_at timestamptz not null default now()
);

create table public.tenants (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.owners on delete cascade,
  house_id uuid not null references public.houses on delete restrict,
  auth_user_id uuid unique references auth.users on delete set null,
  name text not null,
  phone text not null,
  email text not null,
  occupation text,
  room text,
  rent int not null default 0 check (rent >= 0),
  deposit int not null default 0 check (deposit >= 0),
  due_day int not null default 5 check (due_day between 1 and 28),
  joined_on date not null default current_date,
  photo_path text,
  id_type text,
  id_doc_path text,
  id_doc_name text,
  id_doc_type text,
  emergency_name text,
  emergency_phone text,
  channel text not null default 'whatsapp' check (channel in ('whatsapp', 'email', 'both')),
  notes text,                                   -- owner-only; never returned to residents
  status text not null default 'pending' check (status in ('pending', 'approved')),
  active boolean not null default true,
  moved_out_on date,
  created_at timestamptz not null default now()
);
create index on public.tenants (owner_id);

create table public.payments (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants on delete cascade,
  owner_id uuid not null references public.owners on delete cascade,
  period text not null check (period ~ '^\d{4}-\d{2}$'),
  amount int not null check (amount >= 0),
  method text not null default 'UPI',
  paid_on date not null default current_date,
  created_at timestamptz not null default now(),
  unique (tenant_id, period)
);

-- "I've paid" reports from residents, waiting for the owner's tick.
create table public.payment_claims (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants on delete cascade,
  owner_id uuid not null references public.owners on delete cascade,
  periods text[] not null,
  amount int not null check (amount >= 0),
  method text not null,
  ref text,
  note text,
  status text not null default 'pending' check (status in ('pending', 'confirmed', 'rejected')),
  resolved_at timestamptz,
  created_at timestamptz not null default now()
);

create table public.reminders (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants on delete cascade,
  owner_id uuid not null references public.owners on delete cascade,
  period text not null,
  channel text not null,
  auto boolean not null default false,
  status text not null default 'sent',
  created_at timestamptz not null default now()
);

-- ---------- helpers ----------
create or replace function public.my_tenant_id() returns uuid
language sql stable security definer set search_path = public as $$
  select id from public.tenants where auth_user_id = auth.uid() and active limit 1
$$;

create or replace function public.my_owner_id() returns uuid
language sql stable security definer set search_path = public as $$
  select owner_id from public.tenants where auth_user_id = auth.uid() and active limit 1
$$;
create or replace function public.i_am_approved() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.tenants where auth_user_id = auth.uid() and active and status = 'approved')
$$;

-- Owner accounts are created automatically when someone signs up as an owner.
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.raw_user_meta_data->>'role' = 'owner' then
    insert into public.owners (id, name, email) values (new.id, coalesce(new.raw_user_meta_data->>'name', ''), new.email);
  end if;
  return new;
end $$;
create trigger on_auth_user_created after insert on auth.users for each row execute function public.handle_new_user();

-- ---------- row level security ----------
alter table public.owners enable row level security;
alter table public.houses enable row level security;
alter table public.tenants enable row level security;
alter table public.payments enable row level security;
alter table public.payment_claims enable row level security;
alter table public.reminders enable row level security;

create policy "owner: self" on public.owners for all using (id = auth.uid()) with check (id = auth.uid());
create policy "owner: houses" on public.houses for all using (owner_id = auth.uid()) with check (owner_id = auth.uid());
create policy "owner: tenants" on public.tenants for all using (owner_id = auth.uid())
  with check (owner_id = auth.uid() and house_id in (select id from public.houses where owner_id = auth.uid()));
create policy "owner: payments" on public.payments for all using (owner_id = auth.uid())
  with check (owner_id = auth.uid() and tenant_id in (select id from public.tenants where owner_id = auth.uid()));
create policy "owner: reminders" on public.reminders for all using (owner_id = auth.uid())
  with check (owner_id = auth.uid() and tenant_id in (select id from public.tenants where owner_id = auth.uid()));
create policy "owner: read claims" on public.payment_claims for select using (owner_id = auth.uid());
create policy "owner: resolve claims" on public.payment_claims for update using (owner_id = auth.uid()) with check (owner_id = auth.uid());

-- Residents: read-only payments, and they may only *create* pending claims for themselves.
create policy "resident: payments" on public.payments for select using (tenant_id = public.my_tenant_id());
create policy "resident: read claims" on public.payment_claims for select using (tenant_id = public.my_tenant_id());
create policy "resident: report payment" on public.payment_claims for insert with check (
  tenant_id = public.my_tenant_id()
  and status = 'pending'
  and owner_id = public.my_owner_id()
  and public.i_am_approved()
);
-- (No resident policy on tenants: they use the functions below, which expose only safe fields.)

-- ---------- resident functions ----------
create or replace function public.house_for_code(code text)
returns table (name text, owner_name text, hue int)
language sql stable security definer set search_path = public as $$
  select h.name, o.name, h.hue from public.houses h join public.owners o on o.id = h.owner_id where h.join_code = upper(code)
$$;

create or replace function public.join_house(code text, data jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare h public.houses; new_id uuid;
begin
  if auth.uid() is null then raise exception 'Please sign in first'; end if;
  if exists (select 1 from public.tenants where auth_user_id = auth.uid()) then raise exception 'You have already joined a PG'; end if;
  select * into h from public.houses where join_code = upper(code);
  if not found then raise exception 'This invite link is no longer valid'; end if;
  insert into public.tenants (owner_id, house_id, auth_user_id, name, phone, email, occupation, joined_on,
                              id_type, emergency_name, emergency_phone, channel, status)
  values (h.owner_id, h.id, auth.uid(), data->>'name', data->>'phone', lower(data->>'email'), data->>'occupation',
          coalesce(nullif(data->>'joinedOn', '')::date, current_date), data->>'idType',
          data->>'emergencyName', data->>'emergencyPhone', coalesce(data->>'channel', 'whatsapp'), 'pending')
  returning id into new_id;
  return new_id;
end $$;

-- Everything the resident screen needs, without owner-only fields (notes, other residents, owner email).
create or replace function public.my_home() returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'tenant', to_jsonb(t) - 'notes' - 'auth_user_id',
    'house', jsonb_build_object('id', h.id, 'owner_id', h.owner_id, 'name', h.name, 'address', h.address, 'hue', h.hue),
    'owner', jsonb_build_object('id', o.id, 'name', o.name, 'phone', o.phone, 'upi_id', o.upi_id, 'upi_name', o.upi_name,
                                'pay_link', o.pay_link, 'remind_days', o.remind_days)
  )
  from public.tenants t join public.houses h on h.id = t.house_id join public.owners o on o.id = t.owner_id
  where t.id = public.my_tenant_id()
$$;

-- Residents can only change these fields. Rent, deposit, room, due date and status are untouchable here.
create or replace function public.update_my_profile(data jsonb) returns void
language plpgsql security definer set search_path = public as $$
begin
  update public.tenants set
    occupation      = coalesce(data->>'occupation', occupation),
    id_type         = coalesce(data->>'id_type', id_type),
    emergency_name  = coalesce(data->>'emergency_name', emergency_name),
    emergency_phone = coalesce(data->>'emergency_phone', emergency_phone),
    channel         = coalesce(data->>'channel', channel),
    photo_path      = coalesce(data->>'photo_path', photo_path),
    id_doc_path     = coalesce(data->>'id_doc_path', id_doc_path),
    id_doc_name     = coalesce(data->>'id_doc_name', id_doc_name),
    id_doc_type     = coalesce(data->>'id_doc_type', id_doc_type)
  where id = public.my_tenant_id();
end $$;

-- Supabase grants EXECUTE to anon by default; only the invite-link lookup should be callable signed-out.
revoke execute on function public.handle_new_user() from public, anon, authenticated;
revoke execute on function public.join_house(text, jsonb), public.my_home(), public.update_my_profile(jsonb),
  public.i_am_approved(), public.my_owner_id(), public.my_tenant_id() from public, anon;
grant execute on function public.join_house(text, jsonb), public.my_home(), public.update_my_profile(jsonb),
  public.i_am_approved(), public.my_owner_id(), public.my_tenant_id() to authenticated;
grant execute on function public.house_for_code(text) to anon, authenticated;

-- ---------- private storage for photos + ID proofs ----------
-- Paths look like  <owner_id>/<tenant_id>/photo-123.jpg
insert into storage.buckets (id, name, public, file_size_limit)
values ('documents', 'documents', false, 5242880) on conflict (id) do nothing;

create policy "owner: documents" on storage.objects for all
  using (bucket_id = 'documents' and (storage.foldername(name))[1] = auth.uid()::text)
  with check (bucket_id = 'documents' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "resident: own documents" on storage.objects for all
  using (bucket_id = 'documents' and (storage.foldername(name))[2] = public.my_tenant_id()::text)
  with check (bucket_id = 'documents' and (storage.foldername(name))[2] = public.my_tenant_id()::text
              and (storage.foldername(name))[1] = public.my_owner_id()::text);

-- ---------- daily automatic reminders, 9:00 AM IST (03:30 UTC) ----------
-- Later, once the send-reminders function and its WhatsApp/email keys are set up:
-- select cron.schedule('nivas-daily-reminders', '30 3 * * *', $$
--   select net.http_post(
--     url := 'https://<PROJECT_REF>.supabase.co/functions/v1/send-reminders',
--     headers := jsonb_build_object('Authorization', 'Bearer <SERVICE_ROLE_KEY>', 'Content-Type', 'application/json'),
--     body := '{}'::jsonb);
-- $$);

-- ---------- owner-only mode (applied 2026-11-07) ----------
-- Residents don't log in any more: owners add everything. Every new login account (e.g. added in
-- Dashboard → Authentication → Users → Add user) automatically becomes an owner, named from the
-- sign-up name or, failing that, from the email ("sunita.sharma@gmail.com" → "Sunita Sharma").
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.owners (id, name, email)
  values (new.id,
          coalesce(nullif(trim(new.raw_user_meta_data->>'name'), ''),
                   nullif(trim(initcap(regexp_replace(split_part(split_part(new.email, '@', 1), '+', 1), '[._0-9]+', ' ', 'g'))), ''),
                   'Owner'),
          new.email)
  on conflict (id) do nothing;
  return new;
end $$;
revoke execute on function public.handle_new_user() from public, anon, authenticated;
revoke execute on function public.join_house(text, jsonb), public.my_home(), public.update_my_profile(jsonb) from public, authenticated;
drop function if exists public.house_for_code(text);

-- ---------- security hardening (applied 2026-11-07) ----------
-- 1. Remove everything left over from the old resident portal (smaller attack surface).
drop policy if exists "resident: payments" on public.payments;
drop policy if exists "resident: own documents" on storage.objects;
drop table if exists public.payment_claims;
drop function if exists public.join_house(text, jsonb);
drop function if exists public.my_home();
drop function if exists public.update_my_profile(jsonb);
drop function if exists public.i_am_approved();
drop function if exists public.my_owner_id();
drop function if exists public.my_tenant_id();
alter table public.tenants drop column if exists auth_user_id;

-- 2. Signed-out visitors get no table privileges at all; TRUNCATE (which ignores row-level security) is removed.
revoke all on public.owners, public.houses, public.tenants, public.payments, public.reminders from anon;
revoke truncate, trigger, references on public.owners, public.houses, public.tenants, public.payments, public.reminders from authenticated;
alter default privileges in schema public revoke all on tables from anon;
alter default privileges in schema public revoke truncate, trigger, references on tables from authenticated;

-- 3. Documents bucket: private, max 5 MB, only photos and PDFs.
update storage.buckets
   set public = false,
       file_size_limit = 5242880,
       allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp', 'application/pdf']
 where id = 'documents';

-- 4. Sanity limits so bad or huge input can't be stored.
alter table public.tenants
  add constraint tenants_name_len check (char_length(name) between 1 and 120),
  add constraint tenants_phone_len check (char_length(phone) between 7 and 20),
  add constraint tenants_email_len check (char_length(email) <= 254),
  add constraint tenants_notes_len check (notes is null or char_length(notes) <= 2000),
  add constraint tenants_rent_max check (rent <= 10000000 and deposit <= 100000000);
alter table public.houses add constraint houses_name_len check (char_length(name) between 1 and 120);
alter table public.owners add constraint owners_pay_link_https check (pay_link is null or pay_link = '' or pay_link ~* '^https://');
