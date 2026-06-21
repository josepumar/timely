# Timely — Family Timesheet System

A small web application for family members of a family-management business to track
their working time each week and have it approved by an admin.

**Current state: Phase 1 — UI only (mock data, no backend)**

---

## Running locally

No build step needed. Open `index.html` directly in your browser:

```
# macOS / Linux
open index.html

# Windows
start index.html

# Or just double-click index.html in Explorer / Finder
```

Requires a modern browser (Chrome 90+, Firefox 88+, Safari 15+, Edge 90+).
ES modules load from relative paths — if your browser blocks local ES module
imports you can serve via a simple local server:

```
# Python 3
python -m http.server 8080
# then open http://localhost:8080
```

---

## Demo credentials (Phase 1 mock data)

| Email | Password | Role |
|-------|----------|------|
| alice@example.com | pass | Employee |
| bob@example.com   | pass | Employee |
| admin@example.com | pass | Admin |

---

## What you can click through

### Employee view (login as alice or bob)
- **Week navigator** ← → — browse any week Saturday–Friday
- **Add entries** — click "+ Add" on any day row to add a time entry
- **Time In / Time Out** — live per-entry hour calculation (MROUND to nearest 0.5 h)
- **Charge code** — select from dropdown
- **Remark** — optional free text per entry
- **Weekly totals** — live summary table: hours by charge code, regular vs overtime (40 h threshold), total
- **Remarks roll-up** — combined day-prefixed list of all remarks
- **Banked hours** — current balance shown in the summary panel
- **Save Draft** — saves the current entries (becomes enabled once you make a change)
- **Submit for Approval** — locks the timesheet and marks it "Submitted"
- Pre-seeded: Alice has a *submitted* timesheet for the week of Jun 13 2026;
  Bob has a *draft* for the same week

### Admin view (login as admin@example.com)
- **Pending Approvals** — list of all submitted timesheets with employee name, week, total hours
- **Review screen** — read-only entry grid + summary; Approve or Reject (rejection requires a reason)
- **Charge Codes** — add codes, inline-edit name/description, deactivate/reactivate
- **Users** — read-only list of users and roles with banked-hour balances

---

## File structure

```
index.html              App shell
config.js               Supabase credentials (empty in Phase 1) + business constants
app.js                  Hash router, navigate(), showToast()
auth.js                 Mock auth (Phase 2: swap to Supabase Auth)
db.js                   In-memory data layer (Phase 2: swap to Supabase client calls)
calc.js                 Pure calculation functions (mround, weeklyTotals, remarksRollup)
views/
  login.js              Login screen
  employee.js           Employee weekly timesheet view
  admin-layout.js       Shared admin sidebar shell
  admin-approvals.js    Admin pending approvals inbox
  admin-review.js       Admin timesheet review + approve/reject
  admin-charge-codes.js Charge code management
  admin-users.js        User/role list
  timesheet-rows.js     Shared read-only entry-row renderer
styles/
  main.css              CSS variables, layout, day/entry/totals styles
  components.css        Buttons, inputs, badges, tables, toasts
  responsive.css        640px mobile breakpoint
```

---

## Development phases

| Phase | Description | Status |
|-------|-------------|--------|
| 1 | UI + mock data (this) | ✅ Complete |
| 2 | Supabase schema + auth | Pending |
| 3 | Real data CRUD | Pending |
| 4 | Approval workflow + mailto nudge | Pending |
| 5 | Admin management (users, settings, bank) | Pending |
| 6 | GitHub Pages deploy | Pending |

---

## Calculation rules

Per-entry hours = `MROUND((TimeOut − TimeIn in hours), 0.5)` — mirrors the Excel
spreadsheet. Examples:
- 08:00 → 17:00 = 9.0 h
- 08:00 → 17:15 = 9.5 h (9.25 rounds up to nearest 0.5)
- 08:00 → 17:07 = 9.0 h (9.117 rounds down)

Weekly: Regular = min(total, threshold). Overtime = max(0, total − threshold).
Default threshold = 40 h (configurable in `config.js`).
