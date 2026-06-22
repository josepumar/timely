# Timely — Family Timesheet System

A small web app for a family-managed business: employees log weekly time, submit for approval, and track expenses. An admin reviews, approves or rejects, and generates billing reports.

**Live site:** https://josepumar.github.io/timely  
**Current version:** v0.5.1  
**Stack:** Vanilla JS (single IIFE bundle, no build step) · Supabase (auth + Postgres + RLS) · GitHub Pages

---

## Supabase setup (first-time only)

1. Create a new Supabase project.
2. Run `schema.sql` in the SQL Editor (creates all tables, RLS policies, and the `handle_new_user` trigger).
3. Create three users in **Auth → Users**:
   - `alice@example.com` / any password (employee)
   - `bob@example.com` / any password (employee)
   - `admin@example.com` / any password (admin)
4. Run `seed.sql` in the SQL Editor (populates profiles, charge codes, expense categories, and sample data).
5. Run the migrations below (one-time, for existing projects):
   ```sql
   -- email column (added in v0.2)
   alter table profiles add column if not exists email text not null default '';
   update profiles p set email = u.email from auth.users u where p.id = u.id;
   insert into app_settings (key, value) values ('admin_email', '') on conflict (key) do nothing;

   -- approval note column (added in v0.3)
   alter table timesheets add column if not exists approval_note text;

   -- returned status + audit log (added in v0.4)
   alter table timesheets drop constraint if exists timesheets_status_check;
   alter table timesheets add constraint timesheets_status_check
     check (status in ('draft','submitted','approved','rejected','returned'));

   alter table expenses drop constraint if exists expenses_status_check;
   alter table expenses add constraint expenses_status_check
     check (status in ('draft','submitted','approved','rejected','returned'));

   drop policy if exists "update own draft" on timesheets;
   create policy "update own draft" on timesheets for update
     using  (user_id = auth.uid() and status in ('draft','rejected','returned'))
     with check (user_id = auth.uid());

   create table if not exists audit_log (
     id           uuid default uuid_generate_v4() primary key,
     entity_type  text not null check (entity_type in ('timesheet','expense')),
     entity_id    uuid not null,
     action       text not null,
     performed_by uuid references profiles(id) on delete set null,
     performed_at timestamptz default now(),
     note         text not null default ''
   );
   alter table audit_log enable row level security;
   drop policy if exists "admin read audit" on audit_log;
   drop policy if exists "admin insert audit" on audit_log;
   create policy "admin read audit"   on audit_log for select using (is_admin());
   create policy "admin insert audit" on audit_log for insert with check (is_admin());

   -- v0.5: saved reports + snapshots
   create table if not exists reports (
     id          uuid default uuid_generate_v4() primary key,
     name        text not null,
     include_all boolean not null default true,
     created_by  uuid references profiles(id) on delete set null,
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
     generated_by  uuid references profiles(id) on delete set null,
     generated_at  timestamptz default now(),
     date_from     date not null,
     date_to       date not null,
     ot_multiplier numeric(4,2) not null,
     output_json   jsonb not null
   );
   alter table reports          enable row level security;
   alter table report_employees enable row level security;
   alter table report_snapshots enable row level security;
   create policy "admin manage reports"   on reports          for all using (is_admin());
   create policy "admin manage re"        on report_employees for all using (is_admin());
   create policy "admin manage snapshots" on report_snapshots for all using (is_admin());

   -- v0.5.1: fix approved_by / performed_by / created_by / generated_by FKs
   -- (blocks user deletion without these — run even if you ran the blocks above)
   alter table timesheets     drop constraint if exists timesheets_approved_by_fkey;
   alter table timesheets     add  constraint timesheets_approved_by_fkey
     foreign key (approved_by) references profiles(id) on delete set null;
   alter table expenses       drop constraint if exists expenses_approved_by_fkey;
   alter table expenses       add  constraint expenses_approved_by_fkey
     foreign key (approved_by) references profiles(id) on delete set null;
   alter table audit_log      drop constraint if exists audit_log_performed_by_fkey;
   alter table audit_log      add  constraint audit_log_performed_by_fkey
     foreign key (performed_by) references profiles(id) on delete set null;
   alter table reports        drop constraint if exists reports_created_by_fkey;
   alter table reports        add  constraint reports_created_by_fkey
     foreign key (created_by) references profiles(id) on delete set null;
   alter table report_snapshots drop constraint if exists report_snapshots_generated_by_fkey;
   alter table report_snapshots add  constraint report_snapshots_generated_by_fkey
     foreign key (generated_by) references profiles(id) on delete set null;
   ```
6. Set your Supabase project URL and anon key in `bundle.js` (lines 46–47, constants `SUPABASE_URL` and `SUPABASE_ANON_KEY`).

### Production setup (blank slate, no sample data)

Skip steps 3 and 4 above. Instead:

1. Run `schema.sql` in the SQL Editor.
2. In **Authentication → Users**, create your real admin and employee accounts.
3. Promote the admin in the SQL Editor:
   ```sql
   update profiles set role = 'admin' where email = 'your-admin@email.com';
   ```
4. Log in as admin and configure Charge Codes, Expense Categories, Users & Roles, and Settings.

To delete a test user later, first clear any rows that reference them:
```sql
truncate table audit_log;
truncate table report_snapshots, report_employees, reports cascade;
delete from auth.users where email = 'test@example.com';
```

### RLS fixes applied (already in schema.sql)
These were corrected after initial deployment — re-running `schema.sql` is idempotent:
- `timesheets` — `update own draft` policy: added `with check (user_id = auth.uid())` to allow status transitions (draft → submitted).
- `expenses` — same fix.
- `profiles` — `admin update` policy: added `with check (is_admin())`.

---

## Running locally

No build step. Open `index.html` directly in your browser:

```
# Windows
start index.html

# macOS / Linux
open index.html
```

Or serve via a local server to avoid any `file://` CORS issues:

```bash
python -m http.server 8080
# then open http://localhost:8080
```

Requires Chrome 90+, Firefox 88+, Safari 15+, or Edge 90+.

---

## Credentials

**Development / mock mode** (set `SUPABASE_URL = ''` in `bundle.js`):

| Email | Password | Role |
|-------|----------|------|
| alice@example.com | pass | Employee |
| bob@example.com | pass | Employee |
| admin@example.com | pass | Admin |

**Production** (Supabase connected): use whatever email/password you created in Auth → Users. See *Production setup* above.

---

## Features

### Employee
- Weekly timesheet with ← → week navigator (Saturday–Friday weeks)
- Add time entries per day: time in/out, charge code, optional remark
- Hours rounded to nearest 0.5 h (mirrors Excel MROUND formula)
- Live totals: hours by charge code, regular vs. overtime, weekly total
- Save draft / Submit for approval
- Amber "Returned for revision" banner when admin sends a timesheet back; grid re-opens for editing and resubmission
- **My Expenses** — log, edit, submit, and track expenses by category
- **My Summary** — year-view table of all submitted/approved timesheets with earnings and expenses; Last 3 months / Full year toggle

### Admin
- **All Submissions** — filterable table of every non-draft timesheet and expense across all statuses; filter by status, type, employee name, year, and custom date range (defaults to current year)
- **Pending Approvals** — list of submitted timesheets; click to review
- **Review screen** — read-only grid + totals; Approve (with optional note) or Reject (reason required); Send Back (returns an approved item to the employee for revision, with required reason); full audit timeline showing every status change with actor and timestamp
- **Pending Expenses** — same approve/reject/send-back flow for expenses
- **Charge Codes** — add, inline-edit, deactivate/reactivate
- **Expense Categories** — same management UI
- **Users & Roles** — inline-edit name, email, role, hourly rate, banked hours
- **Billing Report** — one-off date-range report of all approved timesheets and expenses, grouped by employee with labor + expense subtotals and grand total; Print / Save as PDF
- **Reports** — saved report templates, each with a name and an employee scope (all or a named subset); generate a dated snapshot from any template; snapshots store the full billing output as a frozen JSON blob so the result never changes after generation; view past snapshots at any time
- **Settings** — admin notification email, OT threshold hours, OT pay multiplier (persisted to `app_settings` table)

### Statuses
| Status | Who sets it | Meaning |
|--------|-------------|---------|
| draft | Employee | Not yet submitted; editable |
| submitted | Employee | Awaiting admin decision |
| approved | Admin | Accepted |
| rejected | Admin | Declined; employee cannot re-edit |
| returned | Admin | Sent back for revision; employee can edit and resubmit |

### Email nudge (mailto-based, no server needed)
- After employee submits a timesheet → **✉ Notify admin** button appears (pre-filled mailto to the admin email set in Settings)
- After employee submits an expense → 10-second nudge banner with the same link
- After admin approves/rejects/sends back → decision panel replaced with outcome + **✉ Email [employee]** link (pre-filled mailto to the employee's profile email)

---

## File structure

```
index.html          App shell — loads Supabase CDN then bundle.js
bundle.js           Single IIFE: config, calc, auth, DB layer, all views, router
schema.sql          Supabase schema — tables, RLS policies, trigger, app_settings
seed.sql            Sample data mirroring Phase 1 mock dataset
seed_drop.sql       Truncates seed tables so seed.sql can be re-run
styles/
  main.css          CSS variables, layout, day/entry/totals styles
  components.css    Buttons, inputs, badges, tables, toasts
  responsive.css    640 px mobile breakpoint
```

Everything runtime lives in `bundle.js`. There is no build step, no npm, no framework.

---

## Architecture notes

- **Single IIFE bundle** — all code is one self-contained `(function(){ … })()`. No ES modules (GitHub Pages serves `file://` and CDN UMD builds are simpler).
- **Supabase JS v2 via CDN** — UMD build exposes `window.supabase`; initialized as `window.supabase.createClient(URL, KEY)`.
- **Mock fallback** — every DB function starts with `if (!_supabase) { /* mock body */ }`. Set `SUPABASE_URL = ''` to run fully offline with in-memory data.
- **RLS-only security** — the anon key is safe to commit. All data access is enforced by Postgres Row-Level Security. The service_role key is never used client-side.
- **snake_case ↔ camelCase** — four mapper helpers (`mapTimesheet`, `mapEntry`, `mapExpense`, `mapProfile`) translate between DB columns and app fields.
- **OT settings** — loaded from `app_settings` at startup into `_otThreshold` / `_otMultiplier`; all calculations use these runtime vars.
- **Week starts Saturday** — `WEEK_START_DAY = 6` (JS `Date.getDay()`).
- **Audit log** — every status change (submit / approve / reject / return) appends an event to `_dbAuditLog` (mock) or the `audit_log` table (Supabase). Surfaced as a timeline in the admin review screens.
- **Version** — `VERSION` constant in `bundle.js`; displayed on the login card and in the admin sidebar footer. Tag releases with `git tag vX.Y`.

---

## Calculation rules

Per-entry hours: `MROUND((timeOut − timeIn), 0.5)` — mirrors the original Excel sheet.

| Example | Result |
|---------|--------|
| 08:00 → 17:00 | 9.0 h |
| 08:00 → 17:15 | 9.5 h (9.25 rounds up) |
| 08:00 → 17:07 | 9.0 h (9.12 rounds down) |

Weekly totals: `regular = min(total, threshold)` · `overtime = max(0, total − threshold)`.  
Default threshold: 40 h. Configurable in Admin → Settings.

---

## Versioning

```bash
# Bump version in bundle.js (VERSION constant), then:
git add bundle.js
git commit -m "Bump version to X.Y"
git tag vX.Y
git push && git push origin vX.Y
```

---

## Pending items

These are ready to pick up in the next session:

### 1. Employee email is editable but not synced to Supabase Auth
The `profiles.email` field (used for mailto links) is set by the trigger on signup and editable in the Users screen. It is separate from `auth.users.email`. If a user's auth email changes, it won't propagate automatically.

**Suggested fix:** Either document this as a known limitation, or add a Supabase Edge Function/webhook that syncs `auth.users.email` → `profiles.email` on user update.

### 2. No confirmation before destructive actions
Deleting a draft expense has no "are you sure?" prompt. Rejecting a timesheet navigates away without confirmation. Consider adding a lightweight confirmation modal or inline confirmation step.

### 3. Pagination on Pending Approvals / Pending Expenses
Currently all submitted timesheets and expenses are loaded at once. For a larger team this could get long. The Expenses list already has 20-per-page pagination — the admin pending lists could use the same pattern.

### 4. Reports: date preferences not yet configurable per template
Currently the date range is chosen at generate time (same as the one-off Billing Report). A future enhancement would let each report template store preferred date settings (e.g. "always current month", "always last 30 days") so generating is one click.

### 5. Returned expenses not editable by employee (two-part bug)
When an admin sends an expense back with status `returned`, the employee cannot edit or resubmit it:
- **bundle.js** — the employee expenses list only checks `status === 'draft' || status === 'rejected'` for showing Edit/Submit buttons; needs `|| status === 'returned'`.
- **schema.sql / Supabase RLS** — the `expenses` `update own draft` policy uses `status = 'draft'`; needs to include `'rejected'` and `'returned'` to match the timesheet policy. Run in the SQL Editor:
  ```sql
  drop policy if exists "update own draft" on expenses;
  create policy "update own draft" on expenses for update
    using  (user_id = auth.uid() and status in ('draft','rejected','returned'))
    with check (user_id = auth.uid());
  ```
