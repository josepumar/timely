/**
 * db.js — In-memory data layer for Phase 1.
 * All functions return Promise<{ data, error }> to match the Supabase client
 * interface. Phase 2 swaps the bodies for real Supabase calls without touching callers.
 */

import { weeklyTotals } from './calc.js';
import { MOCK_USERS } from './auth.js';

// ─── Seed Data ──────────────────────────────────────────────────────────────

let _chargeCodes = [
  { id: 'cc1', code: 'ADMIN',    description: 'Administrative tasks',      active: true },
  { id: 'cc2', code: 'PROJ-A',   description: 'Project Alpha',             active: true },
  { id: 'cc3', code: 'PROJ-B',   description: 'Project Beta',              active: true },
  { id: 'cc4', code: 'TRAINING', description: 'Training & development',    active: true },
  { id: 'cc5', code: 'VACATION', description: 'Vacation / paid time off',  active: true },
];

// Timesheets: ts1 (Alice, submitted, week 2026-06-13), ts2 (Bob, draft, same week)
let _timesheets = [
  {
    id: 'ts1',
    userId: 'u1',
    weekStart: '2026-06-13',
    status: 'submitted',
    submittedAt: '2026-06-16T10:32:00Z',
    approvedBy: null,
    approvedAt: null,
    rejectionReason: null,
  },
  {
    id: 'ts2',
    userId: 'u2',
    weekStart: '2026-06-13',
    status: 'draft',
    submittedAt: null,
    approvedBy: null,
    approvedAt: null,
    rejectionReason: null,
  },
  {
    id: 'ts3',
    userId: 'u1',
    weekStart: '2026-06-06',
    status: 'approved',
    submittedAt: '2026-06-09T09:00:00Z',
    approvedBy: 'u3',
    approvedAt: '2026-06-10T14:00:00Z',
    rejectionReason: null,
  },
];

// Entries: dayOffset 0=Sat … 6=Fri  (Mon=2, Tue=3, Wed=4, Thu=5, Fri=6)
let _entries = [
  // ts1 (Alice, submitted) — Mon through Fri, 9h each = 45h total → 5h overtime
  { id: 'e1',  timesheetId: 'ts1', dayOffset: 2, timeIn: '08:00', timeOut: '17:00', chargeCodeId: 'cc2', remark: 'Alpha sprint planning' },
  { id: 'e2',  timesheetId: 'ts1', dayOffset: 3, timeIn: '08:00', timeOut: '17:00', chargeCodeId: 'cc2', remark: '' },
  { id: 'e3',  timesheetId: 'ts1', dayOffset: 4, timeIn: '08:00', timeOut: '17:00', chargeCodeId: 'cc2', remark: '' },
  { id: 'e4',  timesheetId: 'ts1', dayOffset: 5, timeIn: '08:00', timeOut: '17:00', chargeCodeId: 'cc2', remark: 'Code review' },
  { id: 'e5',  timesheetId: 'ts1', dayOffset: 6, timeIn: '08:00', timeOut: '17:00', chargeCodeId: 'cc2', remark: 'Sprint demo' },
  { id: 'e6',  timesheetId: 'ts1', dayOffset: 2, timeIn: '17:00', timeOut: '20:00', chargeCodeId: 'cc1', remark: 'Admin catch-up' },
  { id: 'e7',  timesheetId: 'ts1', dayOffset: 3, timeIn: '17:00', timeOut: '20:00', chargeCodeId: 'cc1', remark: '' },
  // ts2 (Bob, draft) — partial week
  { id: 'e10', timesheetId: 'ts2', dayOffset: 2, timeIn: '09:00', timeOut: '17:30', chargeCodeId: 'cc3', remark: 'Beta kickoff' },
  { id: 'e11', timesheetId: 'ts2', dayOffset: 3, timeIn: '09:00', timeOut: '17:30', chargeCodeId: 'cc3', remark: '' },
  { id: 'e12', timesheetId: 'ts2', dayOffset: 4, timeIn: '09:00', timeOut: '13:00', chargeCodeId: 'cc4', remark: 'Safety training' },
  // ts3 (Alice, approved previous week)
  { id: 'e20', timesheetId: 'ts3', dayOffset: 2, timeIn: '08:00', timeOut: '16:30', chargeCodeId: 'cc2', remark: '' },
  { id: 'e21', timesheetId: 'ts3', dayOffset: 3, timeIn: '08:00', timeOut: '16:30', chargeCodeId: 'cc2', remark: '' },
  { id: 'e22', timesheetId: 'ts3', dayOffset: 4, timeIn: '08:00', timeOut: '16:30', chargeCodeId: 'cc2', remark: '' },
  { id: 'e23', timesheetId: 'ts3', dayOffset: 5, timeIn: '08:00', timeOut: '16:30', chargeCodeId: 'cc2', remark: '' },
  { id: 'e24', timesheetId: 'ts3', dayOffset: 6, timeIn: '08:00', timeOut: '12:00', chargeCodeId: 'cc1', remark: 'End-of-week wrap-up' },
];

let _expenseCategories = [
  { id: 'cat1', name: 'Meals & Entertainment', description: '', active: true },
  { id: 'cat2', name: 'Office Supplies',        description: '', active: true },
  { id: 'cat3', name: 'Travel',                 description: '', active: true },
];

let _expenses = [
  {
    id: 'ex1',
    userId: 'u1',
    date: '2026-06-15',
    categoryId: 'cat1',
    amount: 45.00,
    description: 'Lunch with client',
    receiptRef: '',
    status: 'submitted',
    submittedAt: '2026-06-15T13:00:00Z',
    approvedBy: null,
    approvedAt: null,
    rejectionReason: null,
  },
  {
    id: 'ex2',
    userId: 'u2',
    date: '2026-06-10',
    categoryId: 'cat2',
    amount: 120.00,
    description: 'Office supplies — printer paper and toner',
    receiptRef: 'R-2345',
    status: 'approved',
    submittedAt: '2026-06-11T10:00:00Z',
    approvedBy: 'u3',
    approvedAt: '2026-06-12T09:00:00Z',
    rejectionReason: null,
  },
];

// Audit log: chronological record of status changes for timesheets and expenses
let _auditLog = [
  // ts1 (Alice, submitted)
  { id: 'al1', entityType: 'timesheet', entityId: 'ts1', action: 'submitted', byId: 'u1', byName: 'Alice Smith', at: '2026-06-16T10:32:00Z', note: '' },
  // ts3 (Alice, approved the week before)
  { id: 'al2', entityType: 'timesheet', entityId: 'ts3', action: 'submitted', byId: 'u1', byName: 'Alice Smith', at: '2026-06-09T09:00:00Z', note: '' },
  { id: 'al3', entityType: 'timesheet', entityId: 'ts3', action: 'approved',  byId: 'u3', byName: 'Carol Admin', at: '2026-06-10T14:00:00Z', note: '' },
  // ex1 (Alice expense, submitted)
  { id: 'al4', entityType: 'expense', entityId: 'ex1', action: 'submitted', byId: 'u1', byName: 'Alice Smith', at: '2026-06-15T13:00:00Z', note: '' },
  // ex2 (Bob expense, approved)
  { id: 'al5', entityType: 'expense', entityId: 'ex2', action: 'submitted', byId: 'u2', byName: 'Bob Jones',   at: '2026-06-11T10:00:00Z', note: '' },
  { id: 'al6', entityType: 'expense', entityId: 'ex2', action: 'approved',  byId: 'u3', byName: 'Carol Admin', at: '2026-06-12T09:00:00Z', note: '' },
];

let _nextId = 1000;
function newId() { return 'x' + (_nextId++); }

function ok(data)  { return Promise.resolve({ data, error: null }); }
function err(msg)  { return Promise.resolve({ data: null, error: new Error(msg) }); }

function _appendAudit(entityType, entityId, action, byId, note = '') {
  const user = MOCK_USERS.find(u => u.id === byId);
  _auditLog.push({
    id: newId(),
    entityType,
    entityId,
    action,
    byId,
    byName: user?.name ?? 'Unknown',
    at: new Date().toISOString(),
    note,
  });
}

// ─── Charge Codes ────────────────────────────────────────────────────────────

export function getChargeCodes() {
  return ok([..._chargeCodes]);
}

export function createChargeCode({ code, description }) {
  const cc = { id: newId(), code: code.trim(), description: description.trim(), active: true };
  _chargeCodes.push(cc);
  return ok(cc);
}

export function updateChargeCode(id, patch) {
  const idx = _chargeCodes.findIndex(c => c.id === id);
  if (idx === -1) return err('Charge code not found');
  _chargeCodes[idx] = { ..._chargeCodes[idx], ...patch };
  return ok(_chargeCodes[idx]);
}

export function deactivateChargeCode(id) {
  return updateChargeCode(id, { active: false });
}

export function reactivateChargeCode(id) {
  return updateChargeCode(id, { active: true });
}

// ─── Users ────────────────────────────────────────────────────────────────────

export function getUsers() {
  return ok(MOCK_USERS.map(({ password: _pw, ...u }) => u));
}

// ─── Timesheets ───────────────────────────────────────────────────────────────

export function getTimesheetForWeek(userId, weekStartIso) {
  const ts = _timesheets.find(t => t.userId === userId && t.weekStart === weekStartIso) ?? null;
  if (!ts) return ok({ timesheet: null, entries: [] });
  const entries = _entries.filter(e => e.timesheetId === ts.id).map(e => ({ ...e }));
  return ok({ timesheet: { ...ts }, entries });
}

export function getSubmittedTimesheets() {
  const submitted = _timesheets.filter(t => t.status === 'submitted');
  const result = submitted.map(ts => {
    const user = MOCK_USERS.find(u => u.id === ts.userId);
    const entries = _entries.filter(e => e.timesheetId === ts.id);
    const { total } = weeklyTotals(entries);
    return {
      timesheet: { ...ts },
      userName: user?.name ?? 'Unknown',
      totalHours: total,
    };
  });
  // Newest first
  result.sort((a, b) => (b.timesheet.submittedAt ?? '').localeCompare(a.timesheet.submittedAt ?? ''));
  return ok(result);
}

export function getAllTimesheets() {
  const nonDraft = _timesheets.filter(t => t.status !== 'draft');
  const result = nonDraft.map(ts => {
    const user = MOCK_USERS.find(u => u.id === ts.userId);
    const entries = _entries.filter(e => e.timesheetId === ts.id);
    const { total } = weeklyTotals(entries);
    return {
      timesheet: { ...ts },
      userName: user?.name ?? 'Unknown',
      totalHours: total,
    };
  });
  result.sort((a, b) => (b.timesheet.submittedAt ?? '').localeCompare(a.timesheet.submittedAt ?? ''));
  return ok(result);
}

export function getTimesheetById(id) {
  const ts = _timesheets.find(t => t.id === id);
  if (!ts) return err('Timesheet not found');
  const user    = MOCK_USERS.find(u => u.id === ts.userId);
  const entries = _entries.filter(e => e.timesheetId === id).map(e => ({ ...e }));
  const totals  = weeklyTotals(entries);
  return ok({ timesheet: { ...ts }, user: user ?? null, entries, totals });
}

/**
 * Upsert all entries for a timesheet (replace strategy — mirrors Supabase upsert).
 * Creates timesheet row if it doesn't exist yet.
 */
export function saveTimesheet(userId, weekStartIso, entries) {
  let ts = _timesheets.find(t => t.userId === userId && t.weekStart === weekStartIso);
  if (!ts) {
    ts = {
      id: newId(),
      userId,
      weekStart: weekStartIso,
      status: 'draft',
      submittedAt: null,
      approvedBy: null,
      approvedAt: null,
      rejectionReason: null,
    };
    _timesheets.push(ts);
  }
  // Replace all entries for this timesheet
  _entries = _entries.filter(e => e.timesheetId !== ts.id);
  const newEntries = entries.map(e => ({
    ...e,
    id: e.id ?? newId(),
    timesheetId: ts.id,
  }));
  _entries.push(...newEntries);
  return ok({ timesheet: { ...ts }, entries: newEntries });
}

export function submitTimesheet(timesheetId) {
  const ts = _timesheets.find(t => t.id === timesheetId);
  if (!ts) return err('Timesheet not found');
  if (ts.status !== 'draft' && ts.status !== 'rejected' && ts.status !== 'returned') {
    return err('Timesheet cannot be submitted in its current state');
  }
  ts.status = 'submitted';
  ts.submittedAt = new Date().toISOString();
  ts.rejectionReason = null;
  _appendAudit('timesheet', timesheetId, 'submitted', ts.userId);
  return ok({ ...ts });
}

export function approveTimesheet(timesheetId, adminUserId, note = '') {
  const ts = _timesheets.find(t => t.id === timesheetId);
  if (!ts) return err('Timesheet not found');
  ts.status = 'approved';
  ts.approvedBy = adminUserId ?? null;
  ts.approvedAt = new Date().toISOString();
  _appendAudit('timesheet', timesheetId, 'approved', adminUserId, note);
  return ok({ ...ts });
}

export function rejectTimesheet(timesheetId, reason, adminUserId) {
  const ts = _timesheets.find(t => t.id === timesheetId);
  if (!ts) return err('Timesheet not found');
  ts.status = 'rejected';
  ts.rejectionReason = reason;
  _appendAudit('timesheet', timesheetId, 'rejected', adminUserId, reason);
  return ok({ ...ts });
}

export function returnTimesheet(timesheetId, reason, adminUserId) {
  const ts = _timesheets.find(t => t.id === timesheetId);
  if (!ts) return err('Timesheet not found');
  ts.status = 'returned';
  ts.rejectionReason = reason;
  _appendAudit('timesheet', timesheetId, 'returned', adminUserId, reason);
  return ok({ ...ts });
}

export function getTimesheetsByUser(userId) {
  const sheets = _timesheets
    .filter(t => t.userId === userId)
    .sort((a, b) => b.weekStart.localeCompare(a.weekStart))
    .map(ts => {
      const entries = _entries.filter(e => e.timesheetId === ts.id);
      const { total } = weeklyTotals(entries);
      return { timesheet: { ...ts }, totalHours: total };
    });
  return ok(sheets);
}

// ─── Expenses ─────────────────────────────────────────────────────────────────

export function getExpenseCategories() {
  return ok([..._expenseCategories]);
}

export function getAllExpenses() {
  const nonDraft = _expenses.filter(e => e.status !== 'draft');
  const result = nonDraft.map(ex => {
    const user = MOCK_USERS.find(u => u.id === ex.userId);
    const category = _expenseCategories.find(c => c.id === ex.categoryId);
    return {
      expense: { ...ex },
      userName: user?.name ?? 'Unknown',
      categoryName: category?.name ?? 'Uncategorized',
    };
  });
  result.sort((a, b) => (b.expense.submittedAt ?? '').localeCompare(a.expense.submittedAt ?? ''));
  return ok(result);
}

export function getExpenseById(id) {
  const ex = _expenses.find(e => e.id === id);
  if (!ex) return err('Expense not found');
  const user = MOCK_USERS.find(u => u.id === ex.userId);
  const category = _expenseCategories.find(c => c.id === ex.categoryId);
  return ok({ expense: { ...ex }, user: user ?? null, categoryName: category?.name ?? 'Uncategorized' });
}

export function approveExpense(id, adminUserId, note = '') {
  const ex = _expenses.find(e => e.id === id);
  if (!ex) return err('Expense not found');
  ex.status = 'approved';
  ex.approvedBy = adminUserId ?? null;
  ex.approvedAt = new Date().toISOString();
  _appendAudit('expense', id, 'approved', adminUserId, note);
  return ok({ ...ex });
}

export function rejectExpense(id, reason, adminUserId) {
  const ex = _expenses.find(e => e.id === id);
  if (!ex) return err('Expense not found');
  ex.status = 'rejected';
  ex.rejectionReason = reason;
  _appendAudit('expense', id, 'rejected', adminUserId, reason);
  return ok({ ...ex });
}

export function returnExpense(id, reason, adminUserId) {
  const ex = _expenses.find(e => e.id === id);
  if (!ex) return err('Expense not found');
  ex.status = 'returned';
  ex.rejectionReason = reason;
  _appendAudit('expense', id, 'returned', adminUserId, reason);
  return ok({ ...ex });
}

// ─── Audit Log ────────────────────────────────────────────────────────────────

export function getAuditLog(entityType, entityId) {
  const events = _auditLog
    .filter(e => e.entityType === entityType && e.entityId === entityId)
    .sort((a, b) => a.at.localeCompare(b.at));
  return ok(events.map(e => ({ ...e })));
}
