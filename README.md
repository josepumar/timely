# Timely — Family Timesheet System

A small web app for a family-managed business: employees log weekly time, submit for approval, and track expenses. An admin reviews, approves or rejects, and generates billing reports.

**Live site:** https://josepumar.github.io/timely  
**Current version:** v0.2  
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
5. Run the email-column migration (one-time, for existing projects):
   ```sql
   alter table profiles add column if not exists email text not null default '';
   update profiles p set email = u.email from auth.users u where p.id = u.id;
   insert into app_settings (key, value) values ('admin_email', '') on conflict (key) do nothing;
   ```
6. Set your Supabase project URL and anon key in `bundle.js` (lines 46–47, constants `SUPABASE_URL` and `SUPABASE_ANON_KEY`).

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

| Email | Role |
|-------|------|
| alice@example.com | Employee |
| bob@example.com | Employee |
| admin@example.com | Admin |

Passwords are whatever you set when creating the users in Supabase Auth.  
When `SUPABASE_URL` is blank the app falls back to mock data with password `pass` for all users.

---

## Features

### Employee
- Weekly timesheet with ← → week navigator (Saturday–Friday weeks)
- Add time entries per day: time in/out, charge code, optional remark
- Hours rounded to nearest 0.5 h (mirrors Excel MROUND formula)
- Live totals: hours by charge code, regular vs. overtime, weekly total
- Save draft / Submit for approval
- **My Expenses** — log, edit, submit, and track expenses by category
- **My Summary** — year-view table of all submitted/approved timesheets with earnings and expenses; Last 3 months / Full year toggle

### Admin
- **Pending Approvals** — list of submitted timesheets; click to review
- **Review screen** — read-only grid + totals; Approve or Reject (rejection requires a reason)
- **Pending Expenses** — same approve/reject flow for expenses
- **Charge Codes** — add, inline-edit, deactivate/reactivate
- **Expense Categories** — same management UI
- **Users & Roles** — inline-edit name, email, role, hourly rate, banked hours
- **Billing Report** — date-range report of all approved timesheets and expenses, grouped by employee with labor + expense subtotals and grand total
- **Settings** — admin notification email, OT threshold hours, OT pay multiplier (persisted to `app_settings` table)

### Email nudge (mailto-based, no server needed)
- After employee submits a timesheet → **✉ Notify admin** button appears (pre-filled mailto to the admin email set in Settings)
- After employee submits an expense → 10-second nudge banner with the same link
- After admin approves/rejects → decision panel replaced with outcome + **✉ Email [employee]** link (pre-filled mailto to the employee's profile email)

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

### 1. Banked hours auto-adjustment
When a timesheet is approved, automatically update the employee's `banked_hours` in `profiles` based on the difference between hours worked and the OT threshold. Currently `banked_hours` must be updated manually via Admin → Users.

**Suggested approach:** In `approveTimesheet()` (Supabase path), after the status update, compute `delta = totals.regular - _otThreshold` and call `updateProfile(userId, { bankedHours: currentBanked + delta })`. Requires fetching current `banked_hours` before updating.

### 2. Admin can write a note on approval
Currently the approve action has no message field — only rejection has a reason. A short optional "approval note" field on the review screen would let the admin leave feedback for the employee.

**Suggested approach:** Add an `approval_note text` column to `timesheets`. Show it as an optional textarea alongside the Approve button. Display it on the employee's timesheet view when status is `approved`.

### 3. Employee email is editable but not synced to Supabase Auth
The `profiles.email` field (used for mailto links) is set by the trigger on signup and editable in the Users screen. It is separate from `auth.users.email`. If a user's auth email changes, it won't propagate automatically.

**Suggested fix:** Either document this as a known limitation, or add a Supabase Edge Function/webhook that syncs `auth.users.email` → `profiles.email` on user update.

### 4. No confirmation before destructive actions
Deleting a draft expense has no "are you sure?" prompt. Rejecting a timesheet navigates away without confirmation. Consider adding a lightweight confirmation modal or inline confirmation step.

### 5. Pagination on Pending Approvals / Pending Expenses
Currently all submitted timesheets and expenses are loaded at once. For a larger team this could get long. The Expenses list already has 20-per-page pagination — the admin pending lists could use the same pattern.
