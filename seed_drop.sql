-- ─── Timely — Reset seed data ─────────────────────────────────────────────────
-- Removes all seeded rows so seed.sql can be re-run cleanly.
-- profiles rows are NOT removed (they are owned by auth.users).

truncate table timesheet_entries restart identity cascade;
truncate table expenses          restart identity cascade;
truncate table timesheets        restart identity cascade;
truncate table charge_codes      restart identity cascade;
truncate table expense_categories restart identity cascade;
-- app_settings rows are preserved (insert ... on conflict do nothing in schema.sql)
