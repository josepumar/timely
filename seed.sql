-- ─── Timely — Seed Data ───────────────────────────────────────────────────────
-- Run AFTER schema.sql and AFTER creating users in Supabase Auth.
-- Mirrors the Phase 1 mock dataset.
-- Looks up real user UUIDs by email — no manual substitution needed.

DO $$
DECLARE
  alice_id uuid;
  bob_id   uuid;
  admin_id uuid;
  cc1 uuid := uuid_generate_v4();
  cc2 uuid := uuid_generate_v4();
  cc3 uuid := uuid_generate_v4();
  ec1 uuid := uuid_generate_v4();
  ec2 uuid := uuid_generate_v4();
  ec3 uuid := uuid_generate_v4();
  ec4 uuid := uuid_generate_v4();
  ec5 uuid := uuid_generate_v4();
  ts1 uuid := uuid_generate_v4();
  ts2 uuid := uuid_generate_v4();
  ts3 uuid := uuid_generate_v4();
  ts4 uuid := uuid_generate_v4();
BEGIN
  SELECT id INTO alice_id FROM auth.users WHERE email = 'alice@example.com';
  SELECT id INTO bob_id   FROM auth.users WHERE email = 'bob@example.com';
  SELECT id INTO admin_id FROM auth.users WHERE email = 'admin@example.com';

  IF alice_id IS NULL OR bob_id IS NULL OR admin_id IS NULL THEN
    RAISE EXCEPTION 'One or more users not found in auth.users — create them first.';
  END IF;

  -- ── Profiles (trigger created rows; update to set names/roles/rates) ─────
  UPDATE profiles SET name='Alice Smith', role='employee', hourly_rate=55, banked_hours=2.5
    WHERE id = alice_id;
  UPDATE profiles SET name='Bob Jones',   role='employee', hourly_rate=48, banked_hours=-1.0
    WHERE id = bob_id;
  UPDATE profiles SET name='Carol Admin', role='admin',    hourly_rate=0,  banked_hours=0
    WHERE id = admin_id;

  -- ── Charge codes ─────────────────────────────────────────────────────────
  INSERT INTO charge_codes (id, name, description, active) VALUES
    (cc1, 'PROJ-A', 'Project Alpha development', true),
    (cc2, 'ADMIN',  'Administrative & internal',  true),
    (cc3, 'PROJ-B', 'Project Beta development',   true);

  -- ── Expense categories ───────────────────────────────────────────────────
  INSERT INTO expense_categories (id, name, description, active) VALUES
    (ec1, 'Mileage',              'Vehicle mileage reimbursement', true),
    (ec2, 'Meals & Entertainment','Client meals and team lunches',  true),
    (ec3, 'Accommodation',        'Hotel and lodging',              true),
    (ec4, 'Supplies',             'Office and job supplies',        true),
    (ec5, 'Other',                'Miscellaneous expenses',         true);

  -- ── Alice: submitted timesheet — week of 2026-06-13 ─────────────────────
  INSERT INTO timesheets (id, user_id, week_start, status, submitted_at) VALUES
    (ts1, alice_id, '2026-06-13', 'submitted', '2026-06-16T12:00:00Z');
  INSERT INTO timesheet_entries (timesheet_id, day_offset, time_in, time_out, charge_code_id, remark) VALUES
    (ts1, 2, '08:00', '17:00', cc1, 'Sprint planning'),
    (ts1, 3, '08:00', '17:00', cc1, ''),
    (ts1, 4, '08:00', '17:00', cc1, 'Stakeholder demo'),
    (ts1, 5, '08:00', '17:00', cc1, ''),
    (ts1, 6, '08:00', '12:00', cc2, 'Weekly admin');

  -- ── Alice: approved timesheet — week of 2026-06-06 ──────────────────────
  INSERT INTO timesheets (id, user_id, week_start, status, submitted_at, approved_by, approved_at) VALUES
    (ts2, alice_id, '2026-06-06', 'approved', '2026-06-09T08:00:00Z', admin_id, '2026-06-10T14:00:00Z');
  INSERT INTO timesheet_entries (timesheet_id, day_offset, time_in, time_out, charge_code_id, remark) VALUES
    (ts2, 2, '08:00', '17:00', cc1, ''),
    (ts2, 3, '08:00', '17:30', cc1, 'Client call'),
    (ts2, 4, '08:00', '17:00', cc1, ''),
    (ts2, 5, '08:00', '17:00', cc2, 'Invoicing'),
    (ts2, 6, '08:00', '12:00', cc1, '');

  -- ── Bob: draft timesheet — week of 2026-06-13 ───────────────────────────
  INSERT INTO timesheets (id, user_id, week_start, status) VALUES
    (ts3, bob_id, '2026-06-13', 'draft');
  INSERT INTO timesheet_entries (timesheet_id, day_offset, time_in, time_out, charge_code_id, remark) VALUES
    (ts3, 2, '09:00', '18:00', cc3, 'Bug fixes'),
    (ts3, 3, '09:00', '18:00', cc3, '');

  -- ── Bob: approved timesheet — week of 2026-06-06 (45 h = 40 reg + 5 OT) ─
  INSERT INTO timesheets (id, user_id, week_start, status, submitted_at, approved_by, approved_at) VALUES
    (ts4, bob_id, '2026-06-06', 'approved', '2026-06-09T10:15:00Z', admin_id, '2026-06-10T15:00:00Z');
  INSERT INTO timesheet_entries (timesheet_id, day_offset, time_in, time_out, charge_code_id, remark) VALUES
    (ts4, 2, '08:00', '18:00', cc3, 'Beta feature dev'),
    (ts4, 3, '08:00', '18:00', cc3, ''),
    (ts4, 4, '08:00', '18:00', cc3, ''),
    (ts4, 5, '08:00', '18:00', cc3, 'Code review session'),
    (ts4, 6, '08:00', '13:00', cc3, '');

  -- ── Expenses ─────────────────────────────────────────────────────────────

  -- Alice: submitted expense
  INSERT INTO expenses
    (user_id, date, category_id, amount, description, receipt_ref, status, submitted_at)
  VALUES
    (alice_id, '2026-06-16', ec2, 42.50, 'Team lunch', '', 'submitted', '2026-06-16T15:00:00Z');

  -- Alice: approved expense
  INSERT INTO expenses
    (user_id, date, category_id, amount, description, receipt_ref, status,
     submitted_at, approved_by, approved_at)
  VALUES
    (alice_id, '2026-06-10', ec1, 67.20, 'Client site visit — 112 miles @ $0.60', '',
     'approved', '2026-06-10T17:00:00Z', admin_id, '2026-06-11T09:00:00Z');

  -- Bob: approved expense
  INSERT INTO expenses
    (user_id, date, category_id, amount, description, receipt_ref, status,
     submitted_at, approved_by, approved_at)
  VALUES
    (bob_id, '2026-06-09', ec4, 28.00, 'Office supplies', '',
     'approved', '2026-06-09T11:00:00Z', admin_id, '2026-06-10T15:00:00Z');

END;
$$;
