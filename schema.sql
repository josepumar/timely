-- ─── Timely — Supabase Schema ─────────────────────────────────────────────────
-- Run this in the Supabase SQL Editor after creating your project.
-- Safe to re-run: uses IF NOT EXISTS / OR REPLACE where possible.

create extension if not exists "uuid-ossp";

-- ─── Tables ───────────────────────────────────────────────────────────────────

create table if not exists profiles (
  id           uuid references auth.users(id) on delete cascade primary key,
  name         text not null,
  role         text not null check (role in ('employee','admin')) default 'employee',
  hourly_rate  numeric(10,2) not null default 0,
  banked_hours numeric(6,2)  not null default 0,
  email        text not null default ''
);

create table if not exists app_settings (
  key   text primary key,
  value text not null
);
insert into app_settings (key, value) values
  ('ot_threshold_hours', '40'),
  ('ot_multiplier',      '1.5'),
  ('week_start_day',     '6'),
  ('admin_email',        '')
on conflict (key) do nothing;

create table if not exists charge_codes (
  id          uuid default uuid_generate_v4() primary key,
  name        text not null,
  description text not null default '',
  active      boolean not null default true,
  created_at  timestamptz default now()
);

create table if not exists expense_categories (
  id          uuid default uuid_generate_v4() primary key,
  name        text not null,
  description text not null default '',
  active      boolean not null default true,
  created_at  timestamptz default now()
);

create table if not exists timesheets (
  id               uuid default uuid_generate_v4() primary key,
  user_id          uuid references profiles(id) on delete cascade not null,
  week_start       date not null,
  status           text not null default 'draft'
                   check (status in ('draft','submitted','approved','rejected','returned')),
  submitted_at     timestamptz,
  approved_by      uuid references profiles(id),
  approved_at      timestamptz,
  rejection_reason text,
  approval_note    text,
  unique(user_id, week_start)
);

create table if not exists timesheet_entries (
  id             uuid default uuid_generate_v4() primary key,
  timesheet_id   uuid references timesheets(id) on delete cascade not null,
  day_offset     smallint not null check (day_offset between 0 and 6),
  time_in        text,
  time_out       text,
  charge_code_id uuid references charge_codes(id),
  remark         text not null default ''
);

create table if not exists expenses (
  id               uuid default uuid_generate_v4() primary key,
  user_id          uuid references profiles(id) on delete cascade not null,
  date             date not null,
  category_id      uuid references expense_categories(id),
  amount           numeric(10,2) not null check (amount > 0),
  description      text not null,
  receipt_ref      text not null default '',
  status           text not null default 'draft'
                   check (status in ('draft','submitted','approved','rejected','returned')),
  submitted_at     timestamptz,
  approved_by      uuid references profiles(id),
  approved_at      timestamptz,
  rejection_reason text
);

create table if not exists audit_log (
  id           uuid default uuid_generate_v4() primary key,
  entity_type  text not null check (entity_type in ('timesheet','expense')),
  entity_id    uuid not null,
  action       text not null,
  performed_by uuid references profiles(id),
  performed_at timestamptz default now(),
  note         text not null default ''
);

alter table audit_log enable row level security;
drop policy if exists "admin read audit" on audit_log;
drop policy if exists "admin insert audit" on audit_log;
create policy "admin read audit"   on audit_log for select using (is_admin());
create policy "admin insert audit" on audit_log for insert with check (is_admin());

create table if not exists reports (
  id          uuid default uuid_generate_v4() primary key,
  name        text not null,
  include_all boolean not null default true,
  created_by  uuid references profiles(id),
  created_at  timestamptz default now()
);

create table if not exists report_employees (
  report_id uuid references reports(id) on delete cascade,
  user_id   uuid references profiles(id) on delete cascade,
  primary key (report_id, user_id)
);

create table if not exists report_snapshots (
  id            uuid default uuid_generate_v4() primary key,
  report_id     uuid references reports(id) on delete cascade,
  generated_by  uuid references profiles(id),
  generated_at  timestamptz default now(),
  date_from     date not null,
  date_to       date not null,
  ot_multiplier numeric(4,2) not null,
  output_json   jsonb not null
);

alter table reports          enable row level security;
alter table report_employees enable row level security;
alter table report_snapshots enable row level security;

drop policy if exists "admin manage reports"   on reports;
drop policy if exists "admin manage re"        on report_employees;
drop policy if exists "admin manage snapshots" on report_snapshots;

create policy "admin manage reports"   on reports          for all using (is_admin());
create policy "admin manage re"        on report_employees for all using (is_admin());
create policy "admin manage snapshots" on report_snapshots for all using (is_admin());

-- ─── Trigger: auto-create profile on sign-up ──────────────────────────────────

create or replace function handle_new_user()
returns trigger language plpgsql security definer as $$
begin
  insert into public.profiles (id, name, role, email)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'name', new.email),
    'employee',
    new.email
  );
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function handle_new_user();

-- ─── Row-Level Security ───────────────────────────────────────────────────────

alter table profiles           enable row level security;
alter table charge_codes       enable row level security;
alter table expense_categories enable row level security;
alter table timesheets         enable row level security;
alter table timesheet_entries  enable row level security;
alter table expenses           enable row level security;
alter table app_settings       enable row level security;

-- Helper: avoids recursion because security definer bypasses RLS on profiles
create or replace function is_admin()
returns boolean language sql security definer as $$
  select exists (select 1 from profiles where id = auth.uid() and role = 'admin')
$$;

-- profiles
drop policy if exists "own profile"     on profiles;
drop policy if exists "admin view all"  on profiles;
drop policy if exists "admin update"    on profiles;
create policy "own profile"    on profiles for select using (id = auth.uid());
create policy "admin view all" on profiles for select using (is_admin());
create policy "admin update"   on profiles for update using (is_admin()) with check (is_admin());

-- charge_codes
drop policy if exists "auth read"    on charge_codes;
drop policy if exists "admin manage" on charge_codes;
create policy "auth read"    on charge_codes for select using (auth.uid() is not null);
create policy "admin manage" on charge_codes for all    using (is_admin());

-- expense_categories
drop policy if exists "auth read"    on expense_categories;
drop policy if exists "admin manage" on expense_categories;
create policy "auth read"    on expense_categories for select using (auth.uid() is not null);
create policy "admin manage" on expense_categories for all    using (is_admin());

-- app_settings
drop policy if exists "auth read"    on app_settings;
drop policy if exists "admin update" on app_settings;
create policy "auth read"    on app_settings for select using (auth.uid() is not null);
create policy "admin update" on app_settings for update using (is_admin());

-- timesheets
drop policy if exists "own timesheets"   on timesheets;
drop policy if exists "admin view all"   on timesheets;
drop policy if exists "insert own"       on timesheets;
drop policy if exists "update own draft" on timesheets;
drop policy if exists "admin update any" on timesheets;
create policy "own timesheets"   on timesheets for select using (user_id = auth.uid());
create policy "admin view all"   on timesheets for select using (is_admin());
create policy "insert own"       on timesheets for insert with check (user_id = auth.uid());
create policy "update own draft" on timesheets for update
  using  (user_id = auth.uid() and status in ('draft','rejected','returned'))
  with check (user_id = auth.uid());
create policy "admin update any" on timesheets for update using (is_admin());

-- timesheet_entries
drop policy if exists "own entries"        on timesheet_entries;
drop policy if exists "admin read entries" on timesheet_entries;
create policy "own entries" on timesheet_entries for all
  using (exists (
    select 1 from timesheets t
    where t.id = timesheet_id and t.user_id = auth.uid()
  ));
create policy "admin read entries" on timesheet_entries for select using (is_admin());

-- expenses
drop policy if exists "own expenses"      on expenses;
drop policy if exists "admin view all"    on expenses;
drop policy if exists "insert own"        on expenses;
drop policy if exists "update own draft"  on expenses;
drop policy if exists "admin update any"  on expenses;
drop policy if exists "delete own draft"  on expenses;
create policy "own expenses"     on expenses for select using (user_id = auth.uid());
create policy "admin view all"   on expenses for select using (is_admin());
create policy "insert own"       on expenses for insert with check (user_id = auth.uid());
create policy "update own draft" on expenses for update
  using  (user_id = auth.uid() and status = 'draft')
  with check (user_id = auth.uid());
create policy "admin update any" on expenses for update using (is_admin());
create policy "delete own draft" on expenses for delete
  using (user_id = auth.uid() and status = 'draft');
