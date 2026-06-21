(function () {
  'use strict';

  // ─── Utilities ────────────────────────────────────────────────────────────
  function esc(str) {
    return String(str ?? '')
      .replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function fmtHours(n) {
    return Number.isFinite(n) ? n.toFixed(1) : '—';
  }

  function fmtMoney(n) {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n || 0);
  }

  function formatWeekLabel(satDate) {
    const fri = new Date(satDate);
    fri.setDate(fri.getDate() + 6);
    const fmt = d => d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    return `${fmt(satDate)} – ${fmt(fri)}`;
  }

  function formatWeekShort(weekStart) {
    const sat = new Date(weekStart + 'T00:00:00');
    const fri = new Date(sat); fri.setDate(fri.getDate() + 6);
    const fmt = d => d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    return `${fmt(sat)} – ${fmt(fri)}`;
  }

  function formatDateTime(iso) {
    return new Date(iso).toLocaleString('en-US', {
      month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit'
    });
  }

  function statusLabel(s) {
    return { draft: 'Draft', submitted: 'Submitted', approved: 'Approved', rejected: 'Rejected' }[s] ?? s;
  }

  const DAY_LABELS = ['SAT', 'SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI'];

  // ─── Config ───────────────────────────────────────────────────────────────
  const SUPABASE_URL      = 'https://knuelttymrfepbxhvsmw.supabase.co';
  const SUPABASE_ANON_KEY = 'sb_publishable_HUxpRSe0oe1qIWs3uA8xbA_H2g2d7gv';

  const VERSION = '0.2';
  const OT_THRESHOLD_HOURS    = 40;
  const WEEK_START_DAY        = 6;
  // Runtime values — overwritten by loadAppSettings() on startup
  var _otThreshold  = OT_THRESHOLD_HOURS;
  var _otMultiplier = 1.5;
  var _adminEmail   = '';

  function mailtoLink(to, subject, body) {
    return 'mailto:' + encodeURIComponent(to) +
      '?subject=' + encodeURIComponent(subject) +
      '&body='    + encodeURIComponent(body);
  }

  // ─── Supabase Client ──────────────────────────────────────────────────────
  // Null when URL is empty — app falls back to mock auth/data (Phase 1 behaviour).
  var _supabase = (SUPABASE_URL && SUPABASE_ANON_KEY)
    ? window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
    : null;

  // ─── Calc ─────────────────────────────────────────────────────────────────
  function mround(value, multiple) {
    if (multiple === 0) return 0;
    return Math.round(value / multiple) * multiple;
  }

  function parseTime(str) {
    if (!str || typeof str !== 'string') return NaN;
    const [h, m] = str.split(':').map(Number);
    if (isNaN(h) || isNaN(m)) return NaN;
    return h * 60 + m;
  }

  function hoursFromTimes(timeIn, timeOut) {
    const inMin  = parseTime(timeIn);
    const outMin = parseTime(timeOut);
    if (isNaN(inMin) || isNaN(outMin)) return 0;
    const diff = (outMin - inMin) / 60;
    return diff < 0 ? 0 : diff;
  }

  function roundedHours(timeIn, timeOut) {
    return mround(hoursFromTimes(timeIn, timeOut), 0.5);
  }

  function totalsByChargeCode(entries) {
    return entries.reduce((acc, e) => {
      if (!e.chargeCodeId) return acc;
      const h = roundedHours(e.timeIn, e.timeOut);
      acc[e.chargeCodeId] = (acc[e.chargeCodeId] ?? 0) + h;
      return acc;
    }, {});
  }

  function weeklyTotals(entries, threshold) {
    if (threshold === undefined) threshold = _otThreshold;
    const byCode   = totalsByChargeCode(entries);
    const total    = Object.values(byCode).reduce((s, h) => s + h, 0);
    const regular  = Math.min(total, threshold);
    const overtime = Math.max(0, total - threshold);
    return { total, regular, overtime, byCode };
  }

  function remarksRollup(entries) {
    const byDay = {};
    for (const e of entries) {
      const r = e.remark ? e.remark.trim() : '';
      if (r) {
        byDay[e.dayOffset] = byDay[e.dayOffset] ? byDay[e.dayOffset] + '; ' + r : r;
      }
    }
    return Object.keys(byDay)
      .sort((a, b) => Number(a) - Number(b))
      .map(d => `${DAY_LABELS[d]}: ${byDay[d]}`)
      .join('\n');
  }

  // ─── Auth ─────────────────────────────────────────────────────────────────
  const MOCK_USERS = [
    { id: 'u1', email: 'alice@example.com', password: 'pass', role: 'employee', name: 'Alice Smith',  bankedHours:  2.5, hourlyRate: 55 },
    { id: 'u2', email: 'bob@example.com',   password: 'pass', role: 'employee', name: 'Bob Jones',    bankedHours: -1.0, hourlyRate: 48 },
    { id: 'u3', email: 'admin@example.com', password: 'pass', role: 'admin',    name: 'Carol Admin',  bankedHours:  0,   hourlyRate:  0 },
  ];

  let _currentUser = null;

  async function login(email, password) {
    if (!_supabase) {
      // Mock fallback when Supabase is not configured
      var user = MOCK_USERS.find(function(u) {
        return u.email.toLowerCase() === email.toLowerCase() && u.password === password;
      });
      if (user) { _currentUser = user; return user; }
      return null;
    }
    var r = await _supabase.auth.signInWithPassword({ email: email, password: password });
    if (r.error || !r.data.user) return null;
    var profile = await loadProfile(r.data.user);
    if (profile) { _currentUser = profile; return profile; }
    return null;
  }

  function logout() {
    _currentUser = null;
    if (_supabase) _supabase.auth.signOut(); // fire-and-forget; router navigates immediately
  }

  function currentUser() { return _currentUser; }

  async function loadProfile(authUser) {
    if (!_supabase) return null;
    var r = await _supabase
      .from('profiles')
      .select('id, name, role, email, hourly_rate, banked_hours')
      .eq('id', authUser.id)
      .single();
    if (r.error || !r.data) return null;
    var d = r.data;
    return {
      id: d.id,
      email: authUser.email,
      role: d.role,
      name: d.name,
      hourlyRate:   d.hourly_rate  || 0,
      bankedHours:  d.banked_hours || 0
    };
  }

  // ─── Navigate + Toast (defined early so views can reference them) ─────────
  function navigate(hash) {
    window.location.hash = hash;
  }

  function showToast(message, type) {
    if (!type) type = 'info';
    const container = document.getElementById('toast-container');
    if (!container) return;
    const toast = document.createElement('div');
    toast.className = 'toast toast--' + type;
    toast.textContent = message;
    toast.setAttribute('role', 'status');
    container.appendChild(toast);
    setTimeout(function () {
      toast.classList.add('toast--leaving');
      toast.addEventListener('animationend', function () { toast.remove(); }, { once: true });
    }, 3000);
  }

  // ─── DB ───────────────────────────────────────────────────────────────────
  let _dbChargeCodes = [
    { id: 'cc1', code: 'ADMIN',    description: 'Administrative tasks',     active: true },
    { id: 'cc2', code: 'PROJ-A',   description: 'Project Alpha',            active: true },
    { id: 'cc3', code: 'PROJ-B',   description: 'Project Beta',             active: true },
    { id: 'cc4', code: 'TRAINING', description: 'Training & development',   active: true },
    { id: 'cc5', code: 'VACATION', description: 'Vacation / paid time off', active: true },
  ];

  let _dbTimesheets = [
    { id: 'ts1', userId: 'u1', weekStart: '2026-06-13', status: 'submitted',
      submittedAt: '2026-06-16T10:32:00Z', approvedBy: null, approvedAt: null, rejectionReason: null },
    { id: 'ts2', userId: 'u2', weekStart: '2026-06-13', status: 'draft',
      submittedAt: null, approvedBy: null, approvedAt: null, rejectionReason: null },
    { id: 'ts3', userId: 'u1', weekStart: '2026-06-06', status: 'approved',
      submittedAt: '2026-06-09T09:00:00Z', approvedBy: 'u3', approvedAt: '2026-06-10T14:00:00Z', rejectionReason: null },
    { id: 'ts4', userId: 'u2', weekStart: '2026-06-06', status: 'approved',
      submittedAt: '2026-06-09T10:15:00Z', approvedBy: 'u3', approvedAt: '2026-06-10T15:00:00Z', rejectionReason: null },
  ];

  let _dbEntries = [
    { id: 'e1',  timesheetId: 'ts1', dayOffset: 2, timeIn: '08:00', timeOut: '17:00', chargeCodeId: 'cc2', remark: 'Alpha sprint planning' },
    { id: 'e2',  timesheetId: 'ts1', dayOffset: 3, timeIn: '08:00', timeOut: '17:00', chargeCodeId: 'cc2', remark: '' },
    { id: 'e3',  timesheetId: 'ts1', dayOffset: 4, timeIn: '08:00', timeOut: '17:00', chargeCodeId: 'cc2', remark: '' },
    { id: 'e4',  timesheetId: 'ts1', dayOffset: 5, timeIn: '08:00', timeOut: '17:00', chargeCodeId: 'cc2', remark: 'Code review' },
    { id: 'e5',  timesheetId: 'ts1', dayOffset: 6, timeIn: '08:00', timeOut: '17:00', chargeCodeId: 'cc2', remark: 'Sprint demo' },
    { id: 'e6',  timesheetId: 'ts1', dayOffset: 2, timeIn: '17:00', timeOut: '20:00', chargeCodeId: 'cc1', remark: 'Admin catch-up' },
    { id: 'e7',  timesheetId: 'ts1', dayOffset: 3, timeIn: '17:00', timeOut: '20:00', chargeCodeId: 'cc1', remark: '' },
    { id: 'e10', timesheetId: 'ts2', dayOffset: 2, timeIn: '09:00', timeOut: '17:30', chargeCodeId: 'cc3', remark: 'Beta kickoff' },
    { id: 'e11', timesheetId: 'ts2', dayOffset: 3, timeIn: '09:00', timeOut: '17:30', chargeCodeId: 'cc3', remark: '' },
    { id: 'e12', timesheetId: 'ts2', dayOffset: 4, timeIn: '09:00', timeOut: '13:00', chargeCodeId: 'cc4', remark: 'Safety training' },
    { id: 'e20', timesheetId: 'ts3', dayOffset: 2, timeIn: '08:00', timeOut: '16:30', chargeCodeId: 'cc2', remark: '' },
    { id: 'e21', timesheetId: 'ts3', dayOffset: 3, timeIn: '08:00', timeOut: '16:30', chargeCodeId: 'cc2', remark: '' },
    { id: 'e22', timesheetId: 'ts3', dayOffset: 4, timeIn: '08:00', timeOut: '16:30', chargeCodeId: 'cc2', remark: '' },
    { id: 'e23', timesheetId: 'ts3', dayOffset: 5, timeIn: '08:00', timeOut: '16:30', chargeCodeId: 'cc2', remark: '' },
    { id: 'e24', timesheetId: 'ts3', dayOffset: 6, timeIn: '08:00', timeOut: '12:00', chargeCodeId: 'cc1', remark: 'End-of-week wrap-up' },
    { id: 'e30', timesheetId: 'ts4', dayOffset: 2, timeIn: '08:00', timeOut: '18:00', chargeCodeId: 'cc3', remark: 'Beta feature dev' },
    { id: 'e31', timesheetId: 'ts4', dayOffset: 3, timeIn: '08:00', timeOut: '18:00', chargeCodeId: 'cc3', remark: '' },
    { id: 'e32', timesheetId: 'ts4', dayOffset: 4, timeIn: '08:00', timeOut: '18:00', chargeCodeId: 'cc3', remark: '' },
    { id: 'e33', timesheetId: 'ts4', dayOffset: 5, timeIn: '08:00', timeOut: '18:00', chargeCodeId: 'cc3', remark: 'Code review session' },
    { id: 'e34', timesheetId: 'ts4', dayOffset: 6, timeIn: '08:00', timeOut: '13:00', chargeCodeId: 'cc3', remark: '' },
  ];

  let _dbExpenseCategories = [
    { id: 'ec1', name: 'Mileage',               description: 'Vehicle mileage reimbursement', active: true },
    { id: 'ec2', name: 'Meals & Entertainment',  description: 'Client meals and team lunches',  active: true },
    { id: 'ec3', name: 'Accommodation',          description: 'Hotel and lodging',              active: true },
    { id: 'ec4', name: 'Supplies',               description: 'Office and job supplies',        active: true },
    { id: 'ec5', name: 'Other',                  description: 'Miscellaneous expenses',         active: true },
  ];

  let _dbExpenses = [
    { id: 'exp1', userId: 'u1', date: '2026-06-16', categoryId: 'ec2', amount: 42.50,
      description: 'Team lunch', receiptRef: '',
      status: 'submitted', submittedAt: '2026-06-16T15:00:00Z',
      approvedBy: null, approvedAt: null, rejectionReason: null },
    { id: 'exp2', userId: 'u1', date: '2026-06-10', categoryId: 'ec1', amount: 67.20,
      description: 'Client site visit — 112 miles @ $0.60', receiptRef: '',
      status: 'approved', submittedAt: '2026-06-10T17:00:00Z',
      approvedBy: 'u3', approvedAt: '2026-06-11T09:00:00Z', rejectionReason: null },
    { id: 'exp3', userId: 'u2', date: '2026-06-09', categoryId: 'ec4', amount: 28.00,
      description: 'Office supplies', receiptRef: '',
      status: 'approved', submittedAt: '2026-06-09T11:00:00Z',
      approvedBy: 'u3', approvedAt: '2026-06-10T15:00:00Z', rejectionReason: null },
  ];

  let _dbNextId = 1000;
  function dbNewId() { return 'x' + (_dbNextId++); }

  function ok(data)  { return Promise.resolve({ data: data, error: null }); }
  function dbErr(msg){ return Promise.resolve({ data: null, error: new Error(msg) }); }

  function mapTimesheet(r) {
    return { id: r.id, userId: r.user_id, weekStart: r.week_start, status: r.status,
             submittedAt: r.submitted_at, approvedBy: r.approved_by,
             approvedAt: r.approved_at, rejectionReason: r.rejection_reason };
  }
  function mapEntry(r) {
    return { id: r.id, timesheetId: r.timesheet_id, dayOffset: r.day_offset,
             timeIn: r.time_in || '', timeOut: r.time_out || '',
             chargeCodeId: r.charge_code_id, remark: r.remark || '' };
  }
  function mapExpense(r) {
    return { id: r.id, userId: r.user_id, date: r.date, categoryId: r.category_id,
             amount: r.amount, description: r.description, receiptRef: r.receipt_ref || '',
             status: r.status, submittedAt: r.submitted_at, approvedBy: r.approved_by,
             approvedAt: r.approved_at, rejectionReason: r.rejection_reason };
  }
  function mapProfile(r) {
    return { id: r.id, name: r.name, role: r.role, email: r.email || '',
             hourlyRate: r.hourly_rate || 0, bankedHours: r.banked_hours || 0 };
  }

  async function getChargeCodes() {
    if (!_supabase) { return ok(_dbChargeCodes.map(function(c){ return Object.assign({}, c); })); }
    var r = await _supabase.from('charge_codes').select('*').order('name');
    if (r.error) return dbErr(r.error.message);
    return ok(r.data.map(function(row){ return { id: row.id, code: row.name, description: row.description, active: row.active }; }));
  }
  async function createChargeCode(cc) {
    if (!_supabase) {
      var c = { id: dbNewId(), code: cc.code.trim(), description: cc.description.trim(), active: true };
      _dbChargeCodes.push(c);
      return ok(Object.assign({}, c));
    }
    var r = await _supabase.from('charge_codes').insert({ name: cc.code.trim(), description: cc.description.trim() }).select().single();
    if (r.error) return dbErr(r.error.message);
    return ok({ id: r.data.id, code: r.data.name, description: r.data.description, active: r.data.active });
  }
  async function updateChargeCode(id, patch) {
    if (!_supabase) {
      var idx = _dbChargeCodes.findIndex(function(c){ return c.id === id; });
      if (idx === -1) return dbErr('Charge code not found');
      _dbChargeCodes[idx] = Object.assign({}, _dbChargeCodes[idx], patch);
      return ok(Object.assign({}, _dbChargeCodes[idx]));
    }
    var update = {};
    if (patch.code        !== undefined) update.name        = patch.code;
    if (patch.description !== undefined) update.description = patch.description;
    if (patch.active      !== undefined) update.active      = patch.active;
    var r = await _supabase.from('charge_codes').update(update).eq('id', id).select().single();
    if (r.error) return dbErr(r.error.message);
    return ok({ id: r.data.id, code: r.data.name, description: r.data.description, active: r.data.active });
  }
  function deactivateChargeCode(id)  { return updateChargeCode(id, { active: false }); }
  function reactivateChargeCode(id)  { return updateChargeCode(id, { active: true });  }

  async function getUsers() {
    if (!_supabase) {
      return ok(MOCK_USERS.map(function(u){ var copy = Object.assign({}, u); delete copy.password; return copy; }));
    }
    var r = await _supabase.from('profiles').select('id, name, role, email, hourly_rate, banked_hours').order('name');
    if (r.error) return dbErr(r.error.message);
    return ok(r.data.map(function(row){ return Object.assign(mapProfile(row), { email: '' }); }));
  }

  async function updateProfile(id, patch) {
    if (!_supabase) {
      var u = MOCK_USERS.find(function(u){ return u.id === id; });
      if (!u) return dbErr('User not found');
      Object.assign(u, patch);
      return ok(Object.assign({}, u));
    }
    var row = {};
    if (patch.name        !== undefined) row.name         = patch.name;
    if (patch.role        !== undefined) row.role         = patch.role;
    if (patch.email       !== undefined) row.email        = patch.email;
    if (patch.hourlyRate  !== undefined) row.hourly_rate  = patch.hourlyRate;
    if (patch.bankedHours !== undefined) row.banked_hours = patch.bankedHours;
    var r = await _supabase.from('profiles').update(row).eq('id', id).select().single();
    if (r.error) return dbErr(r.error.message);
    return ok(mapProfile(r.data));
  }

  async function loadAppSettings() {
    if (!_supabase) return;
    var r = await _supabase.from('app_settings').select('key, value');
    if (r.error || !r.data) return;
    r.data.forEach(function(row) {
      if (row.key === 'ot_threshold_hours') _otThreshold  = parseFloat(row.value) || OT_THRESHOLD_HOURS;
      if (row.key === 'ot_multiplier')      _otMultiplier = parseFloat(row.value) || OT_MULTIPLIER_DEFAULT;
      if (row.key === 'admin_email')        _adminEmail   = row.value || '';
    });
  }

  async function saveAppSetting(key, value) {
    if (!_supabase) return ok(true);
    var r = await _supabase.from('app_settings').update({ value: String(value) }).eq('key', key);
    if (r.error) return dbErr(r.error.message);
    if (key === 'ot_threshold_hours') _otThreshold  = parseFloat(value) || OT_THRESHOLD_HOURS;
    if (key === 'ot_multiplier')      _otMultiplier = parseFloat(value) || OT_MULTIPLIER_DEFAULT;
    if (key === 'admin_email')        _adminEmail   = value || '';
    return ok(true);
  }

  async function getTimesheetForWeek(userId, weekStartIso) {
    if (!_supabase) {
      var ts = _dbTimesheets.find(function(t){ return t.userId === userId && t.weekStart === weekStartIso; }) || null;
      if (!ts) return ok({ timesheet: null, entries: [] });
      var entries = _dbEntries.filter(function(e){ return e.timesheetId === ts.id; }).map(function(e){ return Object.assign({}, e); });
      return ok({ timesheet: Object.assign({}, ts), entries: entries });
    }
    var r = await _supabase.from('timesheets').select('*, timesheet_entries(*)').eq('user_id', userId).eq('week_start', weekStartIso).maybeSingle();
    if (r.error) return dbErr(r.error.message);
    if (!r.data) return ok({ timesheet: null, entries: [] });
    return ok({ timesheet: mapTimesheet(r.data), entries: (r.data.timesheet_entries || []).map(mapEntry) });
  }

  async function getSubmittedTimesheets() {
    if (!_supabase) {
      var submitted = _dbTimesheets.filter(function(t){ return t.status === 'submitted'; });
      var result = submitted.map(function(ts) {
        var user    = MOCK_USERS.find(function(u){ return u.id === ts.userId; });
        var entries = _dbEntries.filter(function(e){ return e.timesheetId === ts.id; });
        var totals  = weeklyTotals(entries);
        return { timesheet: Object.assign({}, ts), userName: user ? user.name : 'Unknown', totalHours: totals.total };
      });
      result.sort(function(a, b){ return (b.timesheet.submittedAt || '').localeCompare(a.timesheet.submittedAt || ''); });
      return ok(result);
    }
    var r = await _supabase.from('timesheets').select('*, timesheet_entries(*)').eq('status', 'submitted').order('submitted_at', { ascending: false });
    if (r.error) return dbErr(r.error.message);
    var userIds = r.data.map(function(row){ return row.user_id; }).filter(function(id, i, arr){ return arr.indexOf(id) === i; });
    var pr = userIds.length ? await _supabase.from('profiles').select('id, name').in('id', userIds) : { data: [], error: null };
    if (pr.error) return dbErr(pr.error.message);
    var profileMap = {};
    (pr.data || []).forEach(function(p){ profileMap[p.id] = p.name; });
    return ok(r.data.map(function(row){
      var entries = (row.timesheet_entries || []).map(mapEntry);
      return { timesheet: mapTimesheet(row), userName: profileMap[row.user_id] || 'Unknown', totalHours: weeklyTotals(entries).total };
    }));
  }

  async function getTimesheetById(id) {
    if (!_supabase) {
      var ts = _dbTimesheets.find(function(t){ return t.id === id; });
      if (!ts) return dbErr('Timesheet not found');
      var user    = MOCK_USERS.find(function(u){ return u.id === ts.userId; });
      var entries = _dbEntries.filter(function(e){ return e.timesheetId === id; }).map(function(e){ return Object.assign({}, e); });
      var totals  = weeklyTotals(entries);
      return ok({ timesheet: Object.assign({}, ts), user: user || null, entries: entries, totals: totals });
    }
    var r = await _supabase.from('timesheets').select('*, timesheet_entries(*)').eq('id', id).single();
    if (r.error) return dbErr(r.error.message);
    var pr = await _supabase.from('profiles').select('id, name, role, email, hourly_rate, banked_hours').eq('id', r.data.user_id).single();
    if (pr.error) return dbErr(pr.error.message);
    var entries = (r.data.timesheet_entries || []).map(mapEntry);
    return ok({ timesheet: mapTimesheet(r.data), user: mapProfile(pr.data), entries: entries, totals: weeklyTotals(entries) });
  }

  async function saveTimesheet(userId, weekStartIso, entries) {
    if (!_supabase) {
      var ts = _dbTimesheets.find(function(t){ return t.userId === userId && t.weekStart === weekStartIso; });
      if (!ts) {
        ts = { id: dbNewId(), userId: userId, weekStart: weekStartIso, status: 'draft',
               submittedAt: null, approvedBy: null, approvedAt: null, rejectionReason: null };
        _dbTimesheets.push(ts);
      }
      _dbEntries = _dbEntries.filter(function(e){ return e.timesheetId !== ts.id; });
      var newEntries = entries.map(function(e){
        return Object.assign({}, e, { id: e.id || dbNewId(), timesheetId: ts.id });
      });
      _dbEntries = _dbEntries.concat(newEntries);
      return ok({ timesheet: Object.assign({}, ts), entries: newEntries });
    }
    var tsRes = await _supabase.from('timesheets').select('id, status').eq('user_id', userId).eq('week_start', weekStartIso).maybeSingle();
    if (tsRes.error) return dbErr(tsRes.error.message);
    var tsId;
    if (tsRes.data) {
      tsId = tsRes.data.id;
    } else {
      var ins = await _supabase.from('timesheets').insert({ user_id: userId, week_start: weekStartIso, status: 'draft' }).select('id').single();
      if (ins.error) return dbErr(ins.error.message);
      tsId = ins.data.id;
    }
    var del = await _supabase.from('timesheet_entries').delete().eq('timesheet_id', tsId);
    if (del.error) return dbErr(del.error.message);
    var newRows = entries.map(function(e){
      return { timesheet_id: tsId, day_offset: e.dayOffset, time_in: e.timeIn, time_out: e.timeOut,
               charge_code_id: e.chargeCodeId || null, remark: e.remark || '' };
    });
    if (newRows.length) {
      var insE = await _supabase.from('timesheet_entries').insert(newRows).select();
      if (insE.error) return dbErr(insE.error.message);
    }
    var tsGet = await _supabase.from('timesheets').select('*, timesheet_entries(*)').eq('id', tsId).single();
    if (tsGet.error) return dbErr(tsGet.error.message);
    return ok({ timesheet: mapTimesheet(tsGet.data), entries: (tsGet.data.timesheet_entries || []).map(mapEntry) });
  }

  async function submitTimesheet(timesheetId) {
    if (!_supabase) {
      var ts = _dbTimesheets.find(function(t){ return t.id === timesheetId; });
      if (!ts) return dbErr('Timesheet not found');
      if (ts.status !== 'draft' && ts.status !== 'rejected') return dbErr('Cannot submit in current state');
      ts.status = 'submitted';
      ts.submittedAt = new Date().toISOString();
      ts.rejectionReason = null;
      return ok(Object.assign({}, ts));
    }
    var r = await _supabase.from('timesheets').update({ status: 'submitted', submitted_at: new Date().toISOString(), rejection_reason: null }).eq('id', timesheetId).select().single();
    if (r.error) return dbErr(r.error.message);
    return ok(mapTimesheet(r.data));
  }

  async function approveTimesheet(timesheetId, adminUserId) {
    if (!_supabase) {
      var ts = _dbTimesheets.find(function(t){ return t.id === timesheetId; });
      if (!ts) return dbErr('Timesheet not found');
      ts.status = 'approved';
      ts.approvedBy = adminUserId || null;
      ts.approvedAt = new Date().toISOString();
      return ok(Object.assign({}, ts));
    }
    var r = await _supabase.from('timesheets').update({ status: 'approved', approved_by: adminUserId || null, approved_at: new Date().toISOString() }).eq('id', timesheetId).select().single();
    if (r.error) return dbErr(r.error.message);
    return ok(mapTimesheet(r.data));
  }

  async function rejectTimesheet(timesheetId, reason) {
    if (!_supabase) {
      var ts = _dbTimesheets.find(function(t){ return t.id === timesheetId; });
      if (!ts) return dbErr('Timesheet not found');
      ts.status = 'rejected';
      ts.rejectionReason = reason;
      return ok(Object.assign({}, ts));
    }
    var r = await _supabase.from('timesheets').update({ status: 'rejected', rejection_reason: reason }).eq('id', timesheetId).select().single();
    if (r.error) return dbErr(r.error.message);
    return ok(mapTimesheet(r.data));
  }

  async function getTimesheetsByUser(userId) {
    if (!_supabase) {
      var sheets = _dbTimesheets.filter(function(ts){ return ts.userId === userId && ts.status !== 'draft'; });
      return ok(sheets.map(function(ts){
        return { timesheet: ts, entries: _dbEntries.filter(function(e){ return e.timesheetId === ts.id; }) };
      }));
    }
    var r = await _supabase.from('timesheets').select('*, timesheet_entries(*)').eq('user_id', userId).neq('status', 'draft').order('week_start', { ascending: false });
    if (r.error) return dbErr(r.error.message);
    return ok(r.data.map(function(row){
      return { timesheet: mapTimesheet(row), entries: (row.timesheet_entries || []).map(mapEntry) };
    }));
  }

  // ─── Expense DB Functions ─────────────────────────────────────────────────
  async function getExpenseCategories() {
    if (!_supabase) { return ok(_dbExpenseCategories.map(function(c){ return Object.assign({}, c); })); }
    var r = await _supabase.from('expense_categories').select('*').order('name');
    if (r.error) return dbErr(r.error.message);
    return ok(r.data.map(function(row){ return { id: row.id, name: row.name, description: row.description, active: row.active }; }));
  }

  async function createExpenseCategory(cat) {
    if (!_supabase) {
      var c = { id: dbNewId(), name: cat.name.trim(), description: cat.description.trim(), active: true };
      _dbExpenseCategories.push(c);
      return ok(Object.assign({}, c));
    }
    var r = await _supabase.from('expense_categories').insert({ name: cat.name.trim(), description: cat.description.trim() }).select().single();
    if (r.error) return dbErr(r.error.message);
    return ok({ id: r.data.id, name: r.data.name, description: r.data.description, active: r.data.active });
  }

  async function updateExpenseCategory(id, patch) {
    if (!_supabase) {
      var idx = _dbExpenseCategories.findIndex(function(c){ return c.id === id; });
      if (idx === -1) return dbErr('Category not found');
      _dbExpenseCategories[idx] = Object.assign({}, _dbExpenseCategories[idx], patch);
      return ok(Object.assign({}, _dbExpenseCategories[idx]));
    }
    var r = await _supabase.from('expense_categories').update(patch).eq('id', id).select().single();
    if (r.error) return dbErr(r.error.message);
    return ok({ id: r.data.id, name: r.data.name, description: r.data.description, active: r.data.active });
  }

  function deactivateExpenseCategory(id) { return updateExpenseCategory(id, { active: false }); }
  function reactivateExpenseCategory(id) { return updateExpenseCategory(id, { active: true });  }

  async function getExpensesByUser(userId) {
    if (!_supabase) {
      var list = _dbExpenses
        .filter(function(e){ return e.userId === userId; })
        .sort(function(a, b){ return b.date.localeCompare(a.date); })
        .map(function(e){
          var cat = _dbExpenseCategories.find(function(c){ return c.id === e.categoryId; });
          return Object.assign({}, e, { categoryName: cat ? cat.name : '—' });
        });
      return ok(list);
    }
    var r = await _supabase.from('expenses').select('*, expense_categories(name)').eq('user_id', userId).order('date', { ascending: false });
    if (r.error) return dbErr(r.error.message);
    return ok(r.data.map(function(row){
      return Object.assign(mapExpense(row), { categoryName: (row.expense_categories && row.expense_categories.name) || '—' });
    }));
  }

  async function getPendingExpenses() {
    if (!_supabase) {
      var list = _dbExpenses
        .filter(function(e){ return e.status === 'submitted'; })
        .sort(function(a, b){ return (b.submittedAt || '').localeCompare(a.submittedAt || ''); })
        .map(function(e){
          var u   = MOCK_USERS.find(function(u){ return u.id === e.userId; });
          var cat = _dbExpenseCategories.find(function(c){ return c.id === e.categoryId; });
          return Object.assign({}, e, { userName: u ? u.name : 'Unknown', categoryName: cat ? cat.name : '—' });
        });
      return ok(list);
    }
    var r = await _supabase.from('expenses').select('*, expense_categories(name)').eq('status', 'submitted').order('submitted_at', { ascending: false });
    if (r.error) return dbErr(r.error.message);
    var userIds = r.data.map(function(row){ return row.user_id; }).filter(function(id, i, arr){ return arr.indexOf(id) === i; });
    var pr = userIds.length ? await _supabase.from('profiles').select('id, name').in('id', userIds) : { data: [], error: null };
    if (pr.error) return dbErr(pr.error.message);
    var profileMap = {};
    (pr.data || []).forEach(function(p){ profileMap[p.id] = p.name; });
    return ok(r.data.map(function(row){
      return Object.assign(mapExpense(row), {
        userName: profileMap[row.user_id] || 'Unknown',
        categoryName: (row.expense_categories && row.expense_categories.name) || '—'
      });
    }));
  }

  async function getExpenseById(id) {
    if (!_supabase) {
      var e = _dbExpenses.find(function(x){ return x.id === id; });
      if (!e) return dbErr('Expense not found');
      var u   = MOCK_USERS.find(function(u){ return u.id === e.userId; });
      var cat = _dbExpenseCategories.find(function(c){ return c.id === e.categoryId; });
      return ok(Object.assign({}, e, { user: u || null, categoryName: cat ? cat.name : '—' }));
    }
    var r = await _supabase.from('expenses').select('*, expense_categories(name)').eq('id', id).single();
    if (r.error) return dbErr(r.error.message);
    var pr = await _supabase.from('profiles').select('id, name, role, email, hourly_rate, banked_hours').eq('id', r.data.user_id).single();
    if (pr.error) return dbErr(pr.error.message);
    return ok(Object.assign(mapExpense(r.data), {
      user: mapProfile(pr.data),
      categoryName: (r.data.expense_categories && r.data.expense_categories.name) || '—'
    }));
  }

  async function saveExpense(userId, data) {
    if (!_supabase) {
      if (data.id) {
        var idx = _dbExpenses.findIndex(function(e){ return e.id === data.id; });
        if (idx !== -1) {
          _dbExpenses[idx] = Object.assign({}, _dbExpenses[idx], data);
          return ok(Object.assign({}, _dbExpenses[idx]));
        }
      }
      var newExp = Object.assign({
        id: dbNewId(), userId: userId,
        status: 'draft', submittedAt: null,
        approvedBy: null, approvedAt: null, rejectionReason: null
      }, data);
      _dbExpenses.push(newExp);
      return ok(Object.assign({}, newExp));
    }
    var row = { user_id: userId, date: data.date, category_id: data.categoryId,
                amount: data.amount, description: data.description, receipt_ref: data.receiptRef || '' };
    if (data.id) {
      var r = await _supabase.from('expenses').update(row).eq('id', data.id).select().single();
      if (r.error) return dbErr(r.error.message);
      return ok(mapExpense(r.data));
    }
    var r = await _supabase.from('expenses').insert(row).select().single();
    if (r.error) return dbErr(r.error.message);
    return ok(mapExpense(r.data));
  }

  async function submitExpense(id) {
    if (!_supabase) {
      var e = _dbExpenses.find(function(x){ return x.id === id; });
      if (!e) return dbErr('Expense not found');
      if (e.status !== 'draft' && e.status !== 'rejected') return dbErr('Cannot submit in current state');
      e.status = 'submitted';
      e.submittedAt = new Date().toISOString();
      e.rejectionReason = null;
      return ok(Object.assign({}, e));
    }
    var r = await _supabase.from('expenses').update({ status: 'submitted', submitted_at: new Date().toISOString(), rejection_reason: null }).eq('id', id).select().single();
    if (r.error) return dbErr(r.error.message);
    return ok(mapExpense(r.data));
  }

  async function approveExpense(id, adminUserId) {
    if (!_supabase) {
      var e = _dbExpenses.find(function(x){ return x.id === id; });
      if (!e) return dbErr('Expense not found');
      e.status = 'approved';
      e.approvedBy = adminUserId || null;
      e.approvedAt = new Date().toISOString();
      return ok(Object.assign({}, e));
    }
    var r = await _supabase.from('expenses').update({ status: 'approved', approved_by: adminUserId || null, approved_at: new Date().toISOString() }).eq('id', id).select().single();
    if (r.error) return dbErr(r.error.message);
    return ok(mapExpense(r.data));
  }

  async function rejectExpense(id, reason) {
    if (!_supabase) {
      var e = _dbExpenses.find(function(x){ return x.id === id; });
      if (!e) return dbErr('Expense not found');
      e.status = 'rejected';
      e.rejectionReason = reason;
      return ok(Object.assign({}, e));
    }
    var r = await _supabase.from('expenses').update({ status: 'rejected', rejection_reason: reason }).eq('id', id).select().single();
    if (r.error) return dbErr(r.error.message);
    return ok(mapExpense(r.data));
  }

  async function deleteExpense(id) {
    if (!_supabase) {
      var idx = _dbExpenses.findIndex(function(e){ return e.id === id; });
      if (idx === -1) return dbErr('Expense not found');
      _dbExpenses.splice(idx, 1);
      return ok(true);
    }
    var r = await _supabase.from('expenses').delete().eq('id', id);
    if (r.error) return dbErr(r.error.message);
    return ok(true);
  }

  // ─── Timesheet Rows (shared read-only renderer) ───────────────────────────
  function entryRowReadonlyHtml(entry, chargeCodes) {
    var cc  = chargeCodes.find(function(c){ return c.id === entry.chargeCodeId; });
    var hrs = fmtHours(roundedHours(entry.timeIn, entry.timeOut));
    return '<div class="entry-row entry-row--readonly">' +
      '<div class="entry-row__times">' +
        '<span class="readonly-time">' + esc(entry.timeIn) + '</span>' +
        '<span class="entry-row__sep">–</span>' +
        '<span class="readonly-time">' + esc(entry.timeOut) + '</span>' +
        '<span class="entry-row__hours">' + hrs + ' h</span>' +
      '</div>' +
      '<div class="entry-row__meta">' +
        '<span class="readonly-cc">' + esc(cc ? cc.code : '—') + '</span>' +
        (entry.remark ? '<span class="readonly-remark">' + esc(entry.remark) + '</span>' : '') +
      '</div>' +
    '</div>';
  }

  function timesheetGridReadonlyHtml(entries, chargeCodes, weekStart) {
    var satDate = new Date(weekStart + 'T00:00:00');
    var html = '<div class="timesheet-grid">';
    for (var d = 0; d < 7; d++) {
      var dayDate  = new Date(satDate);
      dayDate.setDate(satDate.getDate() + d);
      var dayLabel   = DAY_LABELS[d];
      var dateStr    = dayDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
      var dayEntries = entries.filter(function(e){ return e.dayOffset === d; });
      html += '<div class="day-row">' +
        '<div class="day-row__header">' +
          '<span class="day-row__label">' + dayLabel + ' <span class="day-row__date">' + dateStr + '</span></span>' +
        '</div>' +
        '<div class="day-row__entries">' +
          (dayEntries.length === 0
            ? '<p class="day-row__empty">No entries</p>'
            : dayEntries.map(function(e){ return entryRowReadonlyHtml(e, chargeCodes); }).join('')) +
        '</div>' +
      '</div>';
    }
    html += '</div>';
    return html;
  }

  // ─── Admin Layout ──────────────────────────────────────────────────────────
  function renderAdminShell(root, currentHash, title) {
    var user = currentUser();
    root.innerHTML =
      '<div class="admin-layout">' +
        '<nav class="admin-sidebar" aria-label="Admin navigation">' +
          '<div class="admin-sidebar__brand">Timely<span>Admin Panel</span></div>' +
          '<ul class="admin-nav" role="list">' +
            adminNavItem('#/admin/approvals',          'Pending Approvals',  currentHash) +
            adminNavItem('#/admin/expenses',           'Pending Expenses',   currentHash) +
            adminNavItem('#/admin/charge-codes',       'Charge Codes',       currentHash) +
            adminNavItem('#/admin/expense-categories', 'Expense Categories', currentHash) +
            adminNavItem('#/admin/users',              'Users',              currentHash) +
            adminNavItem('#/admin/billing',            'Billing Report',     currentHash) +
            adminNavItem('#/admin/settings',           'Settings',           currentHash) +
          '</ul>' +
          '<div class="admin-sidebar__footer">' +
            '<div style="font-size:var(--font-size-xs);color:var(--color-neutral-400);margin-bottom:var(--space-2)">' +
              'Signed in as<br><strong style="color:var(--color-neutral-200)">' + esc(user ? user.name : '') + '</strong>' +
            '</div>' +
            '<button class="btn btn--ghost btn--sm" id="logout-btn" style="color:var(--color-neutral-400);padding-left:0">← Sign Out</button>' +
            '<div style="font-size:var(--font-size-xs);color:var(--color-neutral-600);margin-top:var(--space-3)">v' + VERSION + '</div>' +
          '</div>' +
        '</nav>' +
        '<main class="admin-main" id="admin-content">' +
          (title ? '<h1>' + esc(title) + '</h1>' : '') +
        '</main>' +
      '</div>';

    root.querySelector('#logout-btn').addEventListener('click', function () {
      logout(); navigate('#/login');
    });
    return root.querySelector('#admin-content');
  }

  function adminNavItem(href, label, currentHash) {
    var isActive = currentHash.indexOf(href) === 0;
    return '<li><a href="' + href + '"' + (isActive ? ' aria-current="page"' : '') + '>' + esc(label) + '</a></li>';
  }

  // ─── Login View ────────────────────────────────────────────────────────────
  function loginRender(root) {
    root.innerHTML =
      '<div class="login-page">' +
        '<div class="login-card">' +
          '<div class="login-card__logo"><h1>Timely</h1><p>Family Timesheet System</p></div>' +
          '<form class="login-form" id="login-form" novalidate>' +
            '<div class="form-group">' +
              '<label for="email">Email address</label>' +
              '<input id="email" class="input" type="email" autocomplete="username" required placeholder="you@example.com">' +
            '</div>' +
            '<div class="form-group">' +
              '<label for="password">Password</label>' +
              '<input id="password" class="input" type="password" autocomplete="current-password" required placeholder="••••••••">' +
            '</div>' +
            '<p class="login-error" id="login-error" role="alert" aria-live="polite"></p>' +
            '<button type="submit" class="btn btn--primary btn--block">Sign In</button>' +
          '</form>' +
          '<p style="margin-top:1.5rem;font-size:0.8rem;color:var(--color-neutral-400);text-align:center">' +
            'Demo: alice@example.com / pass &nbsp;|&nbsp; admin@example.com / pass' +
          '</p>' +
          '<p style="margin-top:0.5rem;font-size:0.75rem;color:var(--color-neutral-300);text-align:center">v' + VERSION + '</p>' +
        '</div>' +
      '</div>';

    root.querySelector('#email').focus();

    root.querySelector('#login-form').addEventListener('submit', async function (e) {
      e.preventDefault();
      var errorEl   = root.querySelector('#login-error');
      var email     = root.querySelector('#email').value.trim();
      var password  = root.querySelector('#password').value;
      errorEl.textContent = '';
      if (!email || !password) { errorEl.textContent = 'Please enter your email and password.'; return; }
      var submitBtn = e.target.querySelector('button[type="submit"]');
      submitBtn.disabled = true; submitBtn.textContent = 'Signing in…';
      var user = await login(email, password);
      submitBtn.disabled = false; submitBtn.textContent = 'Sign In';
      if (!user) {
        errorEl.textContent = 'Invalid email or password.';
        root.querySelector('#password').value = '';
        root.querySelector('#password').focus();
        return;
      }
      navigate(user.role === 'admin' ? '#/admin/approvals' : '#/employee');
    });

    return Promise.resolve();
  }

  // ─── Employee View ─────────────────────────────────────────────────────────
  var _empRoot, _empWeekStart, _empTimesheet, _empEntries, _empChargeCodes, _empIsDirty;
  var _empPendingWeek = null;
  var _empNextLocalId = 0;

  function empLocalId() { return 'new-' + (_empNextLocalId++); }

  function empGetWeekStart(date) {
    var d = new Date(date);
    d.setHours(0, 0, 0, 0);
    while (d.getDay() !== WEEK_START_DAY) d.setDate(d.getDate() - 1);
    return d;
  }

  function empIsoDate(date) {
    var y = date.getFullYear();
    var m = String(date.getMonth() + 1).padStart(2, '0');
    var d = String(date.getDate()).padStart(2, '0');
    return y + '-' + m + '-' + d;
  }

  function empIsEditable() {
    var s = _empTimesheet ? _empTimesheet.status : null;
    return !s || s === 'draft' || s === 'rejected';
  }

  function empMakeEmptyEntry(dayOffset) {
    return { id: empLocalId(), timesheetId: null, dayOffset: dayOffset,
             timeIn: '', timeOut: '', chargeCodeId: (_empChargeCodes[0] ? _empChargeCodes[0].id : ''), remark: '' };
  }

  async function employeeRender(root) {
    _empRoot       = root;
    if (_empPendingWeek) {
      _empWeekStart = empGetWeekStart(new Date(_empPendingWeek + 'T00:00:00'));
      _empPendingWeek = null;
    } else {
      _empWeekStart = empGetWeekStart(new Date());
    }
    _empEntries    = [];
    _empIsDirty    = false;
    var ccResult   = await getChargeCodes();
    _empChargeCodes = (ccResult.data || []).filter(function(c){ return c.active; });
    await empLoadWeek();
  }

  async function empLoadWeek() {
    var user = currentUser();
    var result = await getTimesheetForWeek(user.id, empIsoDate(_empWeekStart));
    if (result.error) { showToast('Failed to load timesheet', 'error'); return; }
    _empTimesheet = result.data.timesheet;
    _empEntries   = result.data.entries.map(function(e){ return Object.assign({}, e); });
    _empIsDirty   = false;
    empRenderShell();
    empRenderDayRows();
    empRenderTotals();
  }

  function empRenderShell() {
    var user   = currentUser();
    var status = _empTimesheet ? _empTimesheet.status : 'draft';
    var rejReason = _empTimesheet ? _empTimesheet.rejectionReason : null;

    _empRoot.innerHTML =
      '<div class="employee-view">' +
        '<header class="view-header">' +
          '<button class="btn btn--icon btn--secondary" id="prev-week" aria-label="Previous week">←</button>' +
          '<span class="view-header__week" id="week-label">' + formatWeekLabel(_empWeekStart) + '</span>' +
          '<button class="btn btn--icon btn--secondary" id="next-week" aria-label="Next week">→</button>' +
          '<div class="view-header__right">' +
            '<span class="badge badge--' + status + '" id="status-badge">' + statusLabel(status) + '</span>' +
            '<span class="view-header__user">' + esc(user.name) + '</span>' +
            '<a href="#/employee/expenses" class="btn btn--ghost btn--sm">My Expenses</a>' +
            '<a href="#/employee/summary" class="btn btn--ghost btn--sm">My Summary</a>' +
            '<button class="btn btn--ghost btn--sm" id="logout-btn">Sign Out</button>' +
          '</div>' +
        '</header>' +
        (rejReason ? '<div style="background:var(--color-danger-light);border:1px solid var(--color-danger);color:var(--color-danger-text);border-radius:var(--radius-md);padding:var(--space-3) var(--space-4);margin-bottom:var(--space-4);font-size:var(--font-size-sm)"><strong>Rejected:</strong> ' + esc(rejReason) + '</div>' : '') +
        '<div class="timesheet-grid" id="timesheet-grid"></div>' +
        '<div class="totals-section" id="totals-section">' +
          '<h2>Weekly Summary</h2>' +
          '<table class="totals-table" aria-label="Weekly totals">' +
            '<thead><tr><th scope="col">Charge Code</th><th scope="col" style="text-align:right">Hours</th></tr></thead>' +
            '<tbody id="totals-by-code"></tbody>' +
            '<tfoot id="totals-footer"></tfoot>' +
          '</table>' +
          '<div id="earnings-section"></div>' +
          '<div id="remarks-container"></div>' +
          '<div class="banked-hours">Bank balance: <strong id="banked-hours">' + fmtHours(user.bankedHours) + ' h</strong></div>' +
        '</div>' +
        '<footer class="action-bar" id="action-bar"></footer>' +
      '</div>';

    _empRoot.querySelector('#prev-week').addEventListener('click', function () {
      _empWeekStart.setDate(_empWeekStart.getDate() - 7); empLoadWeek();
    });
    _empRoot.querySelector('#next-week').addEventListener('click', function () {
      _empWeekStart.setDate(_empWeekStart.getDate() + 7); empLoadWeek();
    });
    _empRoot.querySelector('#logout-btn').addEventListener('click', function () {
      logout(); navigate('#/login');
    });
    empRenderActionBar();
  }

  function empRenderActionBar() {
    var bar = _empRoot.querySelector('#action-bar');
    if (!bar) return;
    if (!empIsEditable()) { bar.innerHTML = ''; return; }
    bar.innerHTML =
      '<button class="btn btn--secondary" id="save-btn"' + (_empIsDirty ? '' : ' disabled') + '>Save Draft</button>' +
      '<button class="btn btn--primary" id="submit-btn">Submit for Approval</button>';
    bar.querySelector('#save-btn').addEventListener('click', empHandleSave);
    bar.querySelector('#submit-btn').addEventListener('click', empHandleSubmit);
  }

  function empRenderDayRows() {
    var grid = _empRoot.querySelector('#timesheet-grid');
    if (!grid) return;
    if (!empIsEditable()) {
      grid.innerHTML = timesheetGridReadonlyHtml(_empEntries, _empChargeCodes, empIsoDate(_empWeekStart));
      return;
    }
    var satDate = new Date(_empWeekStart);
    var html = '';
    for (var d = 0; d < 7; d++) {
      var dayDate  = new Date(satDate);
      dayDate.setDate(satDate.getDate() + d);
      var dayLabel   = DAY_LABELS[d];
      var dateStr    = dayDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
      var dayEntries = _empEntries.filter(function(e){ return e.dayOffset === d; });
      html +=
        '<div class="day-row" data-day="' + d + '">' +
          '<div class="day-row__header">' +
            '<span class="day-row__label">' + dayLabel + ' <span class="day-row__date">' + dateStr + '</span></span>' +
            '<button class="btn btn--sm btn--ghost add-entry-btn" data-day="' + d + '" aria-label="Add entry for ' + dayLabel + ' ' + dateStr + '">+ Add</button>' +
          '</div>' +
          '<div class="day-row__entries" id="day-entries-' + d + '">' +
            (dayEntries.length === 0 ? '<p class="day-row__empty">No entries</p>' : '') +
            dayEntries.map(empEntryRowHtml).join('') +
          '</div>' +
        '</div>';
    }
    grid.innerHTML = html;
    grid.addEventListener('click',  empHandleGridClick);
    grid.addEventListener('input',  empHandleEntryInput);
    grid.addEventListener('change', empHandleEntryInput);
  }

  function empEntryRowHtml(entry) {
    var hrs = (entry.timeIn && entry.timeOut) ? fmtHours(roundedHours(entry.timeIn, entry.timeOut)) : '—';
    var ccOptions = _empChargeCodes.map(function(cc) {
      return '<option value="' + esc(cc.id) + '"' + (cc.id === entry.chargeCodeId ? ' selected' : '') + '>' + esc(cc.code) + ' — ' + esc(cc.description) + '</option>';
    }).join('');
    var id = esc(entry.id);
    return '<div class="entry-row" data-entry-id="' + id + '">' +
      '<div class="entry-row__times">' +
        '<label class="sr-only" for="in-' + id + '">Time In</label>' +
        '<input id="in-' + id + '" class="input input--time" type="time" value="' + esc(entry.timeIn) + '" data-field="timeIn">' +
        '<span class="entry-row__sep">–</span>' +
        '<label class="sr-only" for="out-' + id + '">Time Out</label>' +
        '<input id="out-' + id + '" class="input input--time" type="time" value="' + esc(entry.timeOut) + '" data-field="timeOut">' +
        '<span class="entry-row__hours" id="hrs-' + id + '">' + hrs + ' h</span>' +
      '</div>' +
      '<div class="entry-row__meta">' +
        '<label class="sr-only" for="cc-' + id + '">Charge Code</label>' +
        '<select id="cc-' + id + '" class="input input--select" data-field="chargeCodeId" style="min-width:160px">' + ccOptions + '</select>' +
        '<label class="sr-only" for="rem-' + id + '">Remark</label>' +
        '<input id="rem-' + id + '" class="input" type="text" placeholder="Remark (optional)" value="' + esc(entry.remark) + '" data-field="remark" style="flex:1;min-width:120px">' +
        '<span class="entry-row__remove">' +
          '<button class="btn btn--icon btn--danger remove-entry-btn" data-entry-id="' + id + '" aria-label="Remove this entry">✕</button>' +
        '</span>' +
      '</div>' +
    '</div>';
  }

  function empHandleGridClick(e) {
    var addBtn = e.target.closest('.add-entry-btn');
    if (addBtn) {
      var day   = Number(addBtn.dataset.day);
      var entry = empMakeEmptyEntry(day);
      _empEntries.push(entry);
      empMarkDirty();
      var container = _empRoot.querySelector('#day-entries-' + day);
      if (container) {
        var emptyEl = container.querySelector('.day-row__empty');
        if (emptyEl) emptyEl.remove();
        container.insertAdjacentHTML('beforeend', empEntryRowHtml(entry));
        var inEl = container.querySelector('#in-' + entry.id);
        if (inEl) inEl.focus();
      }
      return;
    }
    var removeBtn = e.target.closest('.remove-entry-btn');
    if (removeBtn) {
      var entryId = removeBtn.dataset.entryId;
      _empEntries = _empEntries.filter(function(e){ return e.id !== entryId; });
      empMarkDirty();
      var row = _empRoot.querySelector('.entry-row[data-entry-id="' + entryId + '"]');
      if (row) {
        var cont = row.closest('.day-row__entries');
        row.remove();
        if (!cont.querySelector('.entry-row')) cont.innerHTML = '<p class="day-row__empty">No entries</p>';
      }
      empRecalcTotals();
    }
  }

  function empHandleEntryInput(e) {
    var row = e.target.closest('[data-entry-id]');
    if (!row) return;
    var entryId = row.dataset.entryId;
    var field   = e.target.dataset.field;
    var value   = e.target.value;
    var entry   = _empEntries.find(function(en){ return en.id === entryId; });
    if (!entry || !field) return;
    entry[field] = value;
    empMarkDirty();
    if (field === 'timeIn' || field === 'timeOut') {
      var hrsEl = _empRoot.querySelector('#hrs-' + entryId);
      if (hrsEl) hrsEl.textContent = (entry.timeIn && entry.timeOut ? fmtHours(roundedHours(entry.timeIn, entry.timeOut)) : '—') + ' h';
      empRecalcTotals();
    }
  }

  function empMarkDirty() {
    _empIsDirty = true;
    var saveBtn = _empRoot.querySelector('#save-btn');
    if (saveBtn) saveBtn.disabled = false;
  }

  function empRenderTotals() { empRecalcTotals(); }

  function empRecalcTotals() {
    var result   = weeklyTotals(_empEntries, _otThreshold);
    var total    = result.total, regular = result.regular, overtime = result.overtime, byCode = result.byCode;
    var tbodyEl  = _empRoot.querySelector('#totals-by-code');
    if (tbodyEl) {
      var codeRows = Object.keys(byCode).filter(function(ccId){ return byCode[ccId] > 0; }).map(function(ccId) {
        var cc = _empChargeCodes.find(function(c){ return c.id === ccId; });
        return '<tr><th scope="row" style="font-weight:normal">' + esc(cc ? cc.code : ccId) +
          '<br><small style="color:var(--color-neutral-400)">' + esc(cc ? cc.description : '') + '</small></th>' +
          '<td style="text-align:right">' + fmtHours(byCode[ccId]) + '</td></tr>';
      }).join('');
      tbodyEl.innerHTML = codeRows || '<tr><td colspan="2" style="color:var(--color-neutral-400);font-style:italic">No hours recorded</td></tr>';
    }
    var footerEl = _empRoot.querySelector('#totals-footer');
    if (footerEl) {
      footerEl.innerHTML =
        '<tr class="totals-table__divider"><th scope="row">Regular</th><td style="text-align:right">' + fmtHours(regular) + '</td></tr>' +
        (overtime > 0 ? '<tr class="totals-table__overtime"><th scope="row">Overtime</th><td style="text-align:right">' + fmtHours(overtime) + '</td></tr>' : '') +
        '<tr class="totals-table__total"><th scope="row">Total</th><td style="text-align:right">' + fmtHours(total) + '</td></tr>';
    }
    var earnEl = _empRoot ? _empRoot.querySelector('#earnings-section') : null;
    if (earnEl) {
      var empUser = currentUser();
      var empRate = empUser ? (empUser.hourlyRate || 0) : 0;
      if (empRate > 0) {
        var empOtRate = empRate * _otMultiplier;
        var regAmt    = regular  * empRate;
        var otAmt     = overtime * empOtRate;
        var totAmt    = regAmt + otAmt;
        var fmtM = function(n) { return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n); };
        earnEl.innerHTML =
          '<div style="border-top:1px solid var(--color-neutral-200);margin-top:var(--space-3);padding-top:var(--space-3)">' +
            '<p style="font-size:var(--font-size-sm);font-weight:600;color:var(--color-neutral-600);margin-bottom:var(--space-2)">Estimated Earnings</p>' +
            '<table class="totals-table"><tbody>' +
              '<tr><th scope="row" style="font-weight:normal;color:var(--color-neutral-600)">Regular &nbsp;' + fmtHours(regular) + ' h &times; ' + fmtM(empRate) + '</th><td style="text-align:right">' + fmtM(regAmt) + '</td></tr>' +
              (overtime > 0 ? '<tr><th scope="row" style="font-weight:normal;color:var(--color-neutral-600)">Overtime &nbsp;' + fmtHours(overtime) + ' h &times; ' + fmtM(empOtRate) + '</th><td style="text-align:right">' + fmtM(otAmt) + '</td></tr>' : '') +
            '</tbody><tfoot>' +
              '<tr class="totals-table__total"><th scope="row">Total</th><td style="text-align:right">' + fmtM(totAmt) + '</td></tr>' +
            '</tfoot></table>' +
          '</div>';
      } else {
        earnEl.innerHTML = '';
      }
    }

    var remarksEl = _empRoot.querySelector('#remarks-container');
    if (remarksEl) {
      var rollup = remarksRollup(_empEntries);
      remarksEl.innerHTML = rollup
        ? '<div style="margin-top:var(--space-4)"><p style="font-size:var(--font-size-sm);font-weight:600;color:var(--color-neutral-600);margin-bottom:var(--space-2)">Remarks Summary</p><div class="remarks-rollup">' + esc(rollup) + '</div></div>'
        : '';
    }
  }

  async function empHandleSave() {
    var user    = currentUser();
    var saveBtn = _empRoot.querySelector('#save-btn');
    if (saveBtn) { saveBtn.disabled = true; saveBtn.textContent = 'Saving…'; }
    var result = await saveTimesheet(user.id, empIsoDate(_empWeekStart), _empEntries);
    if (result.error) {
      showToast('Save failed: ' + result.error.message, 'error');
      if (saveBtn) { saveBtn.disabled = false; saveBtn.textContent = 'Save Draft'; }
      return;
    }
    _empTimesheet = result.data.timesheet;
    _empEntries   = result.data.entries;
    _empIsDirty   = false;
    if (saveBtn) { saveBtn.disabled = true; saveBtn.textContent = 'Save Draft'; }
    showToast('Timesheet saved.', 'success');
  }

  async function empHandleSubmit() {
    if (_empEntries.length === 0) { showToast('Add at least one time entry before submitting.', 'error'); return; }
    if (_empIsDirty) await empHandleSave();
    if (!_empTimesheet) { showToast('Save failed. Cannot submit.', 'error'); return; }
    var result = await submitTimesheet(_empTimesheet.id);
    if (result.error) { showToast(result.error.message, 'error'); return; }
    _empTimesheet = result.data;
    _empIsDirty   = false;
    var badge = _empRoot.querySelector('#status-badge');
    if (badge) { badge.className = 'badge badge--submitted'; badge.textContent = 'Submitted'; }
    var bar = _empRoot.querySelector('#action-bar');
    if (bar) {
      if (_adminEmail) {
        var _su = currentUser();
        var _wk = formatWeekShort(empIsoDate(_empWeekStart));
        var _href = mailtoLink(_adminEmail,
          'Timesheet ready for review — ' + (_su ? _su.name : '') + ', ' + _wk,
          'Hi,\n\nMy timesheet for ' + _wk + ' has been submitted and is ready for your review.\n\n— ' + (_su ? _su.name : ''));
        bar.innerHTML = '<div style="padding:var(--space-3) 0"><a href="' + esc(_href) + '" class="btn btn--secondary btn--sm">✉ Notify admin</a></div>';
      } else {
        bar.innerHTML = '';
      }
    }
    var grid = _empRoot.querySelector('#timesheet-grid');
    if (grid) grid.innerHTML = timesheetGridReadonlyHtml(_empEntries, _empChargeCodes, empIsoDate(_empWeekStart));
    var rejBanner = _empRoot.querySelector('[style*="danger-light"]');
    if (rejBanner) rejBanner.remove();
    showToast('Timesheet submitted for approval.', 'success');
  }

  // ─── Admin Approvals ───────────────────────────────────────────────────────
  async function adminApprovalsRender(root) {
    var main = renderAdminShell(root, '#/admin/approvals', 'Pending Approvals');
    var result = await getSubmittedTimesheets();
    if (result.error) {
      main.insertAdjacentHTML('beforeend', '<p style="color:var(--color-danger)">Failed to load: ' + esc(result.error.message) + '</p>');
      return;
    }
    var items = result.data || [];
    if (items.length === 0) {
      main.insertAdjacentHTML('beforeend', '<div class="empty-state"><p>✓ All caught up!</p><small>No timesheets are waiting for review.</small></div>');
      return;
    }
    var rows = items.map(function(item) {
      var ts = item.timesheet;
      return '<tr>' +
        '<td data-label="Employee">' + esc(item.userName) + '</td>' +
        '<td data-label="Week of">'  + formatWeekShort(ts.weekStart) + '</td>' +
        '<td data-label="Total Hours" style="text-align:right">' + fmtHours(item.totalHours) + ' h</td>' +
        '<td data-label="Submitted">' + (ts.submittedAt ? formatDateTime(ts.submittedAt) : '—') + '</td>' +
        '<td data-label=" "><div class="data-table__actions"><button class="btn btn--primary btn--sm review-btn" data-id="' + esc(ts.id) + '">Review</button></div></td>' +
      '</tr>';
    }).join('');
    main.insertAdjacentHTML('beforeend',
      '<div class="table-wrapper"><table class="data-table" aria-label="Submitted timesheets pending review">' +
        '<thead><tr><th scope="col">Employee</th><th scope="col">Week of</th>' +
        '<th scope="col" style="text-align:right">Total Hours</th><th scope="col">Submitted</th>' +
        '<th scope="col"><span class="sr-only">Actions</span></th></tr></thead>' +
        '<tbody>' + rows + '</tbody></table></div>'
    );
    main.addEventListener('click', function(e) {
      var btn = e.target.closest('.review-btn');
      if (btn) navigate('#/admin/review/' + btn.dataset.id);
    });
  }

  // ─── Admin Review ──────────────────────────────────────────────────────────
  async function adminReviewRender(root, params) {
    var id   = params.id;
    var main = renderAdminShell(root, '#/admin/review/' + id, '');

    var results = await Promise.all([getTimesheetById(id), getChargeCodes()]);
    var tsResult = results[0], ccResult = results[1];

    if (tsResult.error || !tsResult.data) {
      main.innerHTML = '<a class="back-link" href="#/admin/approvals">← Back to Approvals</a><p style="color:var(--color-danger)">Timesheet not found.</p>';
      return;
    }
    var ts          = tsResult.data.timesheet;
    var user        = tsResult.data.user;
    var entries     = tsResult.data.entries;
    var totals      = tsResult.data.totals;
    var chargeCodes = ccResult.data || [];
    var rollup      = remarksRollup(entries);

    var byCodeRows = Object.keys(totals.byCode).filter(function(ccId){ return totals.byCode[ccId] > 0; }).map(function(ccId) {
      var cc = chargeCodes.find(function(c){ return c.id === ccId; });
      return '<tr><th scope="row" style="font-weight:normal">' + esc(cc ? cc.code : ccId) + '</th><td style="text-align:right">' + fmtHours(totals.byCode[ccId]) + '</td></tr>';
    }).join('');

    main.innerHTML =
      '<a class="back-link" href="#/admin/approvals">← Back to Approvals</a>' +
      '<div style="display:flex;align-items:center;gap:var(--space-4);margin-bottom:var(--space-6);flex-wrap:wrap">' +
        '<h1 style="margin:0">' + esc(user ? user.name : 'Employee') + ' — ' + esc(formatWeekShort(ts.weekStart)) + '</h1>' +
        '<span class="badge badge--' + ts.status + '">' + statusLabel(ts.status) + '</span>' +
      '</div>' +
      '<div style="display:grid;grid-template-columns:1fr 280px;gap:var(--space-6);align-items:start" id="review-grid">' +
        '<div>' +
          '<h2 style="font-size:var(--font-size-lg);margin-bottom:var(--space-4)">Time Entries</h2>' +
          timesheetGridReadonlyHtml(entries, chargeCodes, ts.weekStart) +
        '</div>' +
        '<aside>' +
          '<div class="section-card" style="margin-top:0"><h2>Weekly Summary</h2>' +
            '<table class="totals-table" aria-label="Weekly totals">' +
              '<thead><tr><th scope="col">Charge Code</th><th scope="col" style="text-align:right">Hours</th></tr></thead>' +
              '<tbody>' + byCodeRows + '</tbody>' +
              '<tfoot>' +
                '<tr class="totals-table__divider"><th scope="row">Regular</th><td style="text-align:right">' + fmtHours(totals.regular) + '</td></tr>' +
                (totals.overtime > 0 ? '<tr class="totals-table__overtime"><th scope="row">Overtime</th><td style="text-align:right">' + fmtHours(totals.overtime) + '</td></tr>' : '') +
                '<tr class="totals-table__total"><th scope="row">Total</th><td style="text-align:right">' + fmtHours(totals.total) + '</td></tr>' +
              '</tfoot>' +
            '</table>' +
            (rollup ? '<div style="margin-top:var(--space-4)"><p style="font-size:var(--font-size-sm);font-weight:600;color:var(--color-neutral-600);margin-bottom:var(--space-2)">Remarks</p><div class="remarks-rollup">' + esc(rollup) + '</div></div>' : '') +
          '</div>' +
          (ts.status === 'submitted' ?
            '<div class="section-card"><h2>Decision</h2>' +
              '<div style="display:flex;flex-direction:column;gap:var(--space-4)">' +
                '<button class="btn btn--success btn--block" id="approve-btn">✓ Approve</button>' +
                '<div class="reject-section">' +
                  '<label for="reject-reason">Rejection reason <span style="color:var(--color-danger)">*</span></label>' +
                  '<textarea id="reject-reason" class="input input--textarea" rows="3" placeholder="Required — employee will see this message"></textarea>' +
                  '<button class="btn btn--danger btn--block" id="reject-btn" style="margin-top:var(--space-2)">✕ Reject</button>' +
                '</div>' +
              '</div>' +
            '</div>' : '') +
        '</aside>' +
      '</div>';

    if (ts.status !== 'submitted') return;
    var adminId = currentUser() ? currentUser().id : null;

    function tsDecisionDone(label, empEmail, empName, subject, body) {
      var aside = main.querySelector('aside');
      if (!aside) { navigate('#/admin/approvals'); return; }
      var emailBtn = (empEmail)
        ? '<a href="' + esc(mailtoLink(empEmail, subject, body)) + '" class="btn btn--secondary btn--block" style="margin-top:var(--space-3)">✉ Email ' + esc(empName) + '</a>'
        : '';
      aside.innerHTML =
        '<div class="section-card" style="margin-top:0">' +
          '<p style="font-weight:600;margin-bottom:var(--space-3)">' + label + '</p>' +
          emailBtn +
          '<a href="#/admin/approvals" class="btn btn--ghost btn--block" style="margin-top:var(--space-2)">← Back to list</a>' +
        '</div>';
    }

    main.querySelector('#approve-btn').addEventListener('click', async function () {
      var btn = main.querySelector('#approve-btn');
      btn.disabled = true; btn.textContent = 'Approving…';
      var res = await approveTimesheet(id, adminId);
      if (res.error) { showToast(res.error.message, 'error'); btn.disabled = false; btn.textContent = '✓ Approve'; return; }
      showToast('Timesheet approved.', 'success');
      tsDecisionDone('✓ Approved',
        user ? user.email : '', user ? user.name : 'employee',
        'Timesheet approved — ' + formatWeekShort(ts.weekStart),
        'Hi ' + (user ? user.name : '') + ',\n\nYour timesheet for ' + formatWeekShort(ts.weekStart) + ' has been approved.\n\nThanks!');
    });

    main.querySelector('#reject-btn').addEventListener('click', async function () {
      var reason   = main.querySelector('#reject-reason').value.trim();
      var textarea = main.querySelector('#reject-reason');
      if (!reason) { textarea.setAttribute('aria-invalid', 'true'); textarea.focus(); showToast('Please enter a rejection reason.', 'error'); return; }
      textarea.removeAttribute('aria-invalid');
      var btn = main.querySelector('#reject-btn');
      btn.disabled = true; btn.textContent = 'Rejecting…';
      var res = await rejectTimesheet(id, reason);
      if (res.error) { showToast(res.error.message, 'error'); btn.disabled = false; btn.textContent = '✕ Reject'; return; }
      showToast('Timesheet rejected.', 'info');
      tsDecisionDone('✕ Returned for changes',
        user ? user.email : '', user ? user.name : 'employee',
        'Timesheet returned — ' + formatWeekShort(ts.weekStart),
        'Hi ' + (user ? user.name : '') + ',\n\nYour timesheet for ' + formatWeekShort(ts.weekStart) + ' needs changes.\n\nReason: ' + reason + '\n\nPlease update and resubmit. Thanks!');
    });
  }

  // ─── Admin Charge Codes ────────────────────────────────────────────────────
  var _ccList = [], _ccEditingId = null, _ccMain = null;

  async function adminChargeCodesRender(root) {
    _ccMain      = renderAdminShell(root, '#/admin/charge-codes', 'Charge Codes');
    _ccEditingId = null;

    var result = await getChargeCodes();
    if (result.error) {
      _ccMain.insertAdjacentHTML('beforeend', '<p style="color:var(--color-danger)">Failed to load.</p>');
      return;
    }
    _ccList = result.data || [];

    _ccMain.insertAdjacentHTML('beforeend',
      '<div class="table-wrapper" id="cc-table-wrapper">' +
        '<table class="data-table" aria-label="Charge codes">' +
          '<thead><tr><th scope="col">Code</th><th scope="col">Description</th><th scope="col">Status</th><th scope="col"><span class="sr-only">Actions</span></th></tr></thead>' +
          '<tbody id="cc-tbody"></tbody>' +
        '</table>' +
      '</div>' +
      '<div class="section-card" style="margin-top:var(--space-6)"><h2>Add Charge Code</h2>' +
        '<form id="add-cc-form"><div class="add-form">' +
          '<div class="form-group"><label for="new-code">Code</label><input id="new-code" class="input" type="text" required maxlength="20" placeholder="e.g. PROJ-C"></div>' +
          '<div class="form-group" style="flex:2"><label for="new-desc">Description</label><input id="new-desc" class="input" type="text" required placeholder="e.g. Project Gamma"></div>' +
          '<div style="align-self:flex-end;padding-bottom:1px"><button type="submit" class="btn btn--primary">Add</button></div>' +
        '</div></form>' +
      '</div>'
    );

    ccRenderTable();

    _ccMain.querySelector('#cc-table-wrapper').addEventListener('click', async function (e) {
      var editBtn   = e.target.closest('.edit-btn');
      var saveBtn   = e.target.closest('.save-edit-btn');
      var cancelBtn = e.target.closest('.cancel-edit-btn');
      var toggleBtn = e.target.closest('.toggle-btn');

      if (editBtn)   { _ccEditingId = editBtn.dataset.id; ccRenderTable(); _ccMain.querySelector('#edit-code') && _ccMain.querySelector('#edit-code').focus(); return; }
      if (cancelBtn) { _ccEditingId = null; ccRenderTable(); return; }
      if (saveBtn) {
        var codeVal = (_ccMain.querySelector('#edit-code') || {}).value;
        var descVal = (_ccMain.querySelector('#edit-desc') || {}).value;
        if (!codeVal || !descVal) { showToast('Code and description are required.', 'error'); return; }
        var upd = await updateChargeCode(saveBtn.dataset.id, { code: codeVal.trim(), description: descVal.trim() });
        if (upd.error) { showToast('Update failed: ' + upd.error.message, 'error'); return; }
        var idx = _ccList.findIndex(function(c){ return c.id === saveBtn.dataset.id; });
        if (idx !== -1) _ccList[idx] = upd.data;
        _ccEditingId = null; ccRenderTable(); showToast('Charge code updated.', 'success');
        return;
      }
      if (toggleBtn) {
        var isActive = toggleBtn.dataset.active === 'true';
        var tog = isActive ? await deactivateChargeCode(toggleBtn.dataset.id) : await reactivateChargeCode(toggleBtn.dataset.id);
        if (tog.error) { showToast('Update failed.', 'error'); return; }
        var tidx = _ccList.findIndex(function(c){ return c.id === toggleBtn.dataset.id; });
        if (tidx !== -1) _ccList[tidx] = tog.data;
        ccRenderTable(); showToast(isActive ? 'Deactivated.' : 'Reactivated.', 'info');
      }
    });

    _ccMain.querySelector('#add-cc-form').addEventListener('submit', async function (e) {
      e.preventDefault();
      var code = _ccMain.querySelector('#new-code').value.trim();
      var desc = _ccMain.querySelector('#new-desc').value.trim();
      if (!code || !desc) { showToast('Code and description are required.', 'error'); return; }
      var addBtn = _ccMain.querySelector('#add-cc-form button[type="submit"]');
      addBtn.disabled = true; addBtn.textContent = 'Adding…';
      var res = await createChargeCode({ code: code, description: desc });
      addBtn.disabled = false; addBtn.textContent = 'Add';
      if (res.error) { showToast('Failed: ' + res.error.message, 'error'); return; }
      _ccList.push(res.data);
      _ccMain.querySelector('#new-code').value = '';
      _ccMain.querySelector('#new-desc').value = '';
      ccRenderTable(); showToast('Charge code added.', 'success');
      _ccMain.querySelector('#new-code').focus();
    });
  }

  function ccRenderTable() {
    var tbody = _ccMain.querySelector('#cc-tbody');
    if (!tbody) return;
    if (_ccList.length === 0) {
      tbody.innerHTML = '<tr><td colspan="4" style="text-align:center;color:var(--color-neutral-400);font-style:italic;padding:var(--space-6)">No charge codes yet.</td></tr>';
      return;
    }
    tbody.innerHTML = _ccList.map(function(cc) {
      if (_ccEditingId === cc.id) {
        return '<tr data-cc-id="' + esc(cc.id) + '">' +
          '<td data-label="Code"><input id="edit-code" class="input" type="text" value="' + esc(cc.code) + '" maxlength="20" style="width:8ch"></td>' +
          '<td data-label="Description"><input id="edit-desc" class="input" type="text" value="' + esc(cc.description) + '" style="width:100%"></td>' +
          '<td data-label="Status"><span class="badge badge--' + (cc.active ? 'active' : 'inactive') + '">' + (cc.active ? 'Active' : 'Inactive') + '</span></td>' +
          '<td><div class="data-table__actions"><button class="btn btn--primary btn--sm save-edit-btn" data-id="' + esc(cc.id) + '">Save</button><button class="btn btn--secondary btn--sm cancel-edit-btn">Cancel</button></div></td>' +
        '</tr>';
      }
      return '<tr data-cc-id="' + esc(cc.id) + '">' +
        '<td data-label="Code"><strong>' + esc(cc.code) + '</strong></td>' +
        '<td data-label="Description">' + esc(cc.description) + '</td>' +
        '<td data-label="Status"><span class="badge badge--' + (cc.active ? 'active' : 'inactive') + '">' + (cc.active ? 'Active' : 'Inactive') + '</span></td>' +
        '<td data-label=" "><div class="data-table__actions">' +
          '<button class="btn btn--secondary btn--sm edit-btn" data-id="' + esc(cc.id) + '">Edit</button>' +
          '<button class="btn btn--sm ' + (cc.active ? 'btn--danger' : 'btn--ghost') + ' toggle-btn" data-id="' + esc(cc.id) + '" data-active="' + cc.active + '">' + (cc.active ? 'Deactivate' : 'Reactivate') + '</button>' +
        '</div></td>' +
      '</tr>';
    }).join('');
  }

  // ─── Admin Users ───────────────────────────────────────────────────────────
  async function adminUsersRender(root) {
    var main       = renderAdminShell(root, '#/admin/users', 'Users & Roles');
    var _editingId = null;
    var _users     = [];
    var fmtM       = function(n) { return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n || 0); };

    function renderTable() {
      var rows = _users.map(function(u) {
        if (u.id === _editingId) {
          return '<tr>' +
            '<td data-label="Name"><input id="edit-name" class="input input--sm" value="' + esc(u.name) + '" style="width:100%;min-width:7rem"></td>' +
            '<td data-label="Email"><input id="edit-email" class="input input--sm" type="email" value="' + esc(u.email || '') + '" style="width:100%;min-width:10rem"></td>' +
            '<td data-label="Role">' +
              '<select id="edit-role" class="input input--select input--sm">' +
                '<option value="employee"' + (u.role === 'employee' ? ' selected' : '') + '>Employee</option>' +
                '<option value="admin"'    + (u.role === 'admin'    ? ' selected' : '') + '>Admin</option>' +
              '</select>' +
            '</td>' +
            '<td data-label="Hourly Rate" style="text-align:right">' +
              '<input id="edit-rate" class="input input--sm" type="number" min="0" step="0.01" value="' + (u.hourlyRate || 0) + '" style="width:6rem;text-align:right">' +
            '</td>' +
            '<td data-label="Banked Hours" style="text-align:right">' +
              '<input id="edit-banked" class="input input--sm" type="number" step="0.5" value="' + (u.bankedHours || 0) + '" style="width:6rem;text-align:right">' +
            '</td>' +
            '<td style="white-space:nowrap">' +
              '<button class="btn btn--sm btn--primary save-edit-btn" data-id="' + esc(u.id) + '">Save</button>' +
              '<button class="btn btn--sm btn--ghost cancel-edit-btn" style="margin-left:var(--space-1)">Cancel</button>' +
            '</td>' +
          '</tr>';
        }
        return '<tr>' +
          '<td data-label="Name"><strong>' + esc(u.name) + '</strong></td>' +
          '<td data-label="Email" style="color:var(--color-neutral-400)">' + esc(u.email || '—') + '</td>' +
          '<td data-label="Role"><span class="badge badge--' + (u.role === 'admin' ? 'submitted' : 'draft') + '">' + (u.role === 'admin' ? 'Admin' : 'Employee') + '</span></td>' +
          '<td data-label="Hourly Rate" style="text-align:right">' + (u.hourlyRate > 0 ? fmtM(u.hourlyRate) + '/h' : '<span style="color:var(--color-neutral-400)">—</span>') + '</td>' +
          '<td data-label="Banked Hours" style="text-align:right">' + (u.bankedHours != null ? (u.bankedHours > 0 ? '+' : '') + Number(u.bankedHours).toFixed(1) + ' h' : '—') + '</td>' +
          '<td><button class="btn btn--sm btn--secondary edit-btn" data-id="' + esc(u.id) + '">Edit</button></td>' +
        '</tr>';
      }).join('');
      main.querySelector('#users-tbody').innerHTML = rows;
      if (_editingId) { var el = main.querySelector('#edit-name'); if (el) el.focus(); }
    }

    main.insertAdjacentHTML('beforeend',
      '<div class="table-wrapper"><table class="data-table" aria-label="Users and roles">' +
        '<thead><tr>' +
          '<th scope="col">Name</th>' +
          '<th scope="col">Email</th>' +
          '<th scope="col">Role</th>' +
          '<th scope="col" style="text-align:right">Hourly Rate</th>' +
          '<th scope="col" style="text-align:right">Banked Hours</th>' +
          '<th scope="col"><span class="sr-only">Actions</span></th>' +
        '</tr></thead>' +
        '<tbody id="users-tbody"><tr><td colspan="6" style="text-align:center;color:var(--color-neutral-400);padding:var(--space-8)">Loading…</td></tr></tbody>' +
      '</table></div>'
    );

    main.querySelector('#users-tbody').addEventListener('click', async function(e) {
      var editBtn   = e.target.closest('.edit-btn');
      var cancelBtn = e.target.closest('.cancel-edit-btn');
      var saveBtn   = e.target.closest('.save-edit-btn');
      if (editBtn)   { _editingId = editBtn.dataset.id; renderTable(); return; }
      if (cancelBtn) { _editingId = null; renderTable(); return; }
      if (saveBtn) {
        var nameVal   = (main.querySelector('#edit-name')   || {}).value || '';
        var emailVal  = (main.querySelector('#edit-email')  || {}).value || '';
        var roleVal   = (main.querySelector('#edit-role')   || {}).value || 'employee';
        var rateVal   = parseFloat((main.querySelector('#edit-rate')   || {}).value) || 0;
        var bankedVal = parseFloat((main.querySelector('#edit-banked') || {}).value) || 0;
        if (!nameVal.trim()) { showToast('Name is required.', 'error'); return; }
        var upd = await updateProfile(saveBtn.dataset.id, { name: nameVal.trim(), email: emailVal.trim(), role: roleVal, hourlyRate: rateVal, bankedHours: bankedVal });
        if (upd.error) { showToast('Update failed: ' + upd.error.message, 'error'); return; }
        var idx = _users.findIndex(function(u){ return u.id === saveBtn.dataset.id; });
        if (idx !== -1) _users[idx] = Object.assign(_users[idx], upd.data);
        _editingId = null;
        renderTable();
        showToast('Profile updated.', 'success');
      }
    });

    var result = await getUsers();
    if (result.error) { main.querySelector('#users-tbody').innerHTML = '<tr><td colspan="6" style="color:var(--color-danger);padding:var(--space-4)">Failed to load users.</td></tr>'; return; }
    _users = result.data || [];
    renderTable();
  }

  // ─── Employee Summary ─────────────────────────────────────────────────────
  async function employeeSummaryRender(root) {
    var user   = currentUser();
    var fmtM   = function(n) { return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n || 0); };
    var rate   = user ? (user.hourlyRate || 0) : 0;
    var otRate = rate * _otMultiplier;

    root.innerHTML =
      '<div style="max-width:var(--content-max-width);margin:0 auto;padding:var(--space-8) var(--space-4)">' +
        '<a class="back-link" href="#/employee">&#8592; Back to Timesheet</a>' +
        '<div style="display:flex;align-items:center;gap:var(--space-4);margin-bottom:var(--space-2);flex-wrap:wrap;justify-content:space-between">' +
          '<h1 style="font-size:var(--font-size-2xl);margin:0">My Summary</h1>' +
          '<button class="btn btn--ghost btn--sm" id="sum-logout">Sign Out</button>' +
        '</div>' +
        '<p style="color:var(--color-neutral-500);font-size:var(--font-size-sm);margin-bottom:var(--space-6)">' +
          esc(user ? user.name : '') +
          (rate > 0
            ? ' &nbsp;&middot;&nbsp; Rate: <strong style="color:var(--color-neutral-700)">' + fmtM(rate) + '/h</strong>' +
              ' &nbsp;&middot;&nbsp; OT rate: <strong style="color:var(--color-neutral-700)">' + fmtM(otRate) + '/h</strong> (' + _otMultiplier + '&times;)'
            : '') +
        '</p>' +
        '<div id="sum-controls" style="margin-bottom:var(--space-5)"></div>' +
        '<div id="sum-table"></div>' +
      '</div>';

    root.querySelector('#sum-logout').addEventListener('click', function () { logout(); navigate('#/login'); });

    // Collect all non-draft timesheets for this user
    var sheetsRes = await getTimesheetsByUser(user.id);
    var sheetsData = sheetsRes.data || [];
    var allSheets = sheetsData.map(function(item){ return item.timesheet; });
    var entriesMap = {};
    sheetsData.forEach(function(item){ entriesMap[item.timesheet.id] = item.entries; });
    var expRes2 = await getExpensesByUser(user.id);
    var allExpenses = expRes2.data || [];

    // Derive available years
    var yearSet = {};
    allSheets.forEach(function(ts) { yearSet[ts.weekStart.substring(0, 4)] = true; });
    var years = Object.keys(yearSet).sort().reverse();
    if (!years.length) years = [String(new Date().getFullYear())];
    var currentYear = years[0];
    var currentRange = 'short';

    function renderControls() {
      var ctrl = root.querySelector('#sum-controls');
      ctrl.innerHTML =
        '<div style="display:flex;align-items:center;gap:var(--space-3);flex-wrap:wrap">' +
          '<label for="sum-year" style="font-size:var(--font-size-sm);font-weight:500;color:var(--color-neutral-700)">Year:</label>' +
          '<select id="sum-year" class="input input--select" style="width:auto">' +
            years.map(function(y) {
              return '<option value="' + y + '"' + (y === currentYear ? ' selected' : '') + '>' + y + '</option>';
            }).join('') +
          '</select>' +
          '<div style="border-left:1px solid var(--color-neutral-200);padding-left:var(--space-3);display:flex;gap:var(--space-1)">' +
            '<button id="sum-range-short" class="btn btn--sm ' + (currentRange === 'short' ? 'btn--primary' : 'btn--secondary') + '">Last 3 months</button>' +
            '<button id="sum-range-full" class="btn btn--sm ' + (currentRange === 'full' ? 'btn--primary' : 'btn--secondary') + '">Full year</button>' +
          '</div>' +
        '</div>';
      ctrl.querySelector('#sum-year').addEventListener('change', function () {
        currentYear = this.value; renderTable();
      });
      ctrl.querySelector('#sum-range-short').addEventListener('click', function () {
        currentRange = 'short'; renderControls(); renderTable();
      });
      ctrl.querySelector('#sum-range-full').addEventListener('click', function () {
        currentRange = 'full'; renderControls(); renderTable();
      });
    }

    function renderTable() {
      var tblEl      = root.querySelector('#sum-table');
      var yearSheets = allSheets.filter(function(ts) { return ts.weekStart.startsWith(currentYear); });

      if (!yearSheets.length) {
        tblEl.innerHTML = '<div class="empty-state" style="padding:var(--space-12)"><p>No submitted timesheets in ' + esc(currentYear) + '.</p><small>Timesheets must be submitted before they appear here.</small></div>';
        return;
      }

      // Group by "YYYY-MM"
      var byMonth = {};
      yearSheets.forEach(function(ts) {
        var ym = ts.weekStart.substring(0, 7);
        if (!byMonth[ym]) byMonth[ym] = [];
        byMonth[ym].push(ts);
      });
      var months = Object.keys(byMonth).sort().reverse();
      var visibleMonths = currentRange === 'short' ? months.slice(0, 3) : months;

      var yrRegHrs = 0, yrOtHrs = 0, yrAmt = 0, yrExpAmt = 0;
      var colCount = rate > 0 ? 7 : 6;

      var tbodySections = visibleMonths.map(function(ym) {
        var monthLabel = new Date(ym + '-15T00:00:00').toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
        var mRegHrs = 0, mOtHrs = 0, mAmt = 0, mExpAmt = 0;

        var weekRows = byMonth[ym].map(function(ts) {
          var entries = entriesMap[ts.id] || [];
          var tots    = weeklyTotals(entries);
          var lineAmt = tots.regular * rate + tots.overtime * otRate;
          mRegHrs += tots.regular; mOtHrs += tots.overtime; mAmt += lineAmt;
          var wkEnd = new Date(ts.weekStart + 'T00:00:00');
          wkEnd.setDate(wkEnd.getDate() + 6);
          var wkEndIso = wkEnd.getFullYear() + '-' + String(wkEnd.getMonth() + 1).padStart(2, '0') + '-' + String(wkEnd.getDate()).padStart(2, '0');
          var wkExpAmt = allExpenses
            .filter(function(ex) {
              return (ex.status === 'approved' || ex.status === 'submitted') && ex.date >= ts.weekStart && ex.date <= wkEndIso;
            })
            .reduce(function(s, ex) { return s + (ex.amount || 0); }, 0);
          mExpAmt += wkExpAmt;
          return '<tr>' +
            '<td data-label="Week"><a href="#/employee" class="ts-week-link" data-week="' + esc(ts.weekStart) + '" style="color:var(--color-primary);font-weight:500">' + formatWeekShort(ts.weekStart) + '</a></td>' +
            '<td data-label="Status"><span class="badge badge--' + ts.status + '">' + statusLabel(ts.status) + '</span></td>' +
            '<td data-label="Reg. Hrs" style="text-align:right">' + fmtHours(tots.regular) + '</td>' +
            '<td data-label="OT Hrs" style="text-align:right">' + fmtHours(tots.overtime) + '</td>' +
            '<td data-label="Total Hrs" style="text-align:right">' + fmtHours(tots.total) + '</td>' +
            (rate > 0 ? '<td data-label="Earnings" style="text-align:right;font-weight:600">' + fmtM(lineAmt) + '</td>' : '') +
            '<td data-label="Expenses" style="text-align:right">' + (wkExpAmt > 0 ? fmtM(wkExpAmt) : '<span style="color:var(--color-neutral-300)">—</span>') + '</td>' +
          '</tr>';
        }).join('');

        yrRegHrs += mRegHrs; yrOtHrs += mOtHrs; yrAmt += mAmt; yrExpAmt += mExpAmt;

        return '<tbody>' +
          '<tr style="background:var(--color-neutral-100)">' +
            '<th colspan="' + colCount + '" scope="colgroup" style="padding:var(--space-2) var(--space-4);font-weight:700;color:var(--color-neutral-700);font-size:var(--font-size-sm);letter-spacing:0.03em;text-transform:uppercase">' + esc(monthLabel) + '</th>' +
          '</tr>' +
          weekRows +
          '<tr style="background:var(--color-primary-light);font-weight:600">' +
            '<td colspan="2">Month total</td>' +
            '<td style="text-align:right">' + fmtHours(mRegHrs) + '</td>' +
            '<td style="text-align:right">' + fmtHours(mOtHrs) + '</td>' +
            '<td style="text-align:right">' + fmtHours(mRegHrs + mOtHrs) + '</td>' +
            (rate > 0 ? '<td style="text-align:right;color:var(--color-primary)">' + fmtM(mAmt) + '</td>' : '') +
            '<td style="text-align:right">' + (mExpAmt > 0 ? fmtM(mExpAmt) : '—') + '</td>' +
          '</tr>' +
        '</tbody>';
      }).join('');

      tblEl.innerHTML =
        '<div class="table-wrapper">' +
          '<table class="data-table" aria-label="Time and earnings summary for ' + esc(currentYear) + '">' +
            '<thead><tr>' +
              '<th scope="col">Week</th>' +
              '<th scope="col">Status</th>' +
              '<th scope="col" style="text-align:right">Reg. Hrs</th>' +
              '<th scope="col" style="text-align:right">OT Hrs</th>' +
              '<th scope="col" style="text-align:right">Total Hrs</th>' +
              (rate > 0 ? '<th scope="col" style="text-align:right">Earnings</th>' : '') +
              '<th scope="col" style="text-align:right">Expenses</th>' +
            '</tr></thead>' +
            tbodySections +
            '<tfoot><tr style="background:var(--color-neutral-900);color:white">' +
              '<td colspan="2" style="font-weight:700">' + (currentRange === 'short' && visibleMonths.length < months.length ? 'Period total' : 'Year total') + '</td>' +
              '<td style="text-align:right;font-weight:600">' + fmtHours(yrRegHrs) + '</td>' +
              '<td style="text-align:right;font-weight:600">' + fmtHours(yrOtHrs) + '</td>' +
              '<td style="text-align:right;font-weight:600">' + fmtHours(yrRegHrs + yrOtHrs) + '</td>' +
              (rate > 0 ? '<td style="text-align:right;font-weight:700;font-size:var(--font-size-lg)">' + fmtM(yrAmt) + '</td>' : '') +
              '<td style="text-align:right;font-weight:600">' + (yrExpAmt > 0 ? fmtM(yrExpAmt) : '—') + '</td>' +
            '</tr></tfoot>' +
          '</table>' +
        '</div>' +
        (rate === 0 ? '<p style="color:var(--color-neutral-400);font-size:var(--font-size-sm);margin-top:var(--space-3)">Dollar amounts are hidden — ask your admin to set your hourly rate.</p>' : '') +
        '<p style="color:var(--color-neutral-400);font-size:var(--font-size-xs);margin-top:var(--space-2)">Expenses column includes approved and submitted expenses by the week they fall in.</p>' +
        '<div style="text-align:right;margin-top:var(--space-4);padding-bottom:var(--space-8)">' +
          '<button class="btn btn--secondary sum-print-btn">Print / Save as PDF</button>' +
        '</div>';

      tblEl.querySelector('.sum-print-btn').addEventListener('click', function () { window.print(); });
    }

    renderControls();
    renderTable();

    root.querySelector('#sum-table').addEventListener('click', function(e) {
      var link = e.target.closest('.ts-week-link');
      if (!link) return;
      e.preventDefault();
      _empPendingWeek = link.dataset.week;
      navigate('#/employee');
    });
  }

  // ─── Employee Expenses View ───────────────────────────────────────────────
  var _expRoot, _expList, _expCats, _expFilter, _expEditingId, _expPage;

  async function employeeExpensesRender(root) {
    _expRoot      = root;
    _expFilter    = 'all';
    _expEditingId = null;
    _expPage      = 0;
    var user = currentUser();

    var todayIso = (function() {
      var d = new Date();
      return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
    })();

    root.innerHTML =
      '<div style="max-width:var(--content-max-width);margin:0 auto;padding:var(--space-8) var(--space-4)">' +
        '<a class="back-link" href="#/employee">&#8592; Back to Timesheet</a>' +
        '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:var(--space-6);flex-wrap:wrap;gap:var(--space-3)">' +
          '<h1 style="font-size:var(--font-size-2xl);margin:0">My Expenses</h1>' +
          '<div style="display:flex;gap:var(--space-2)">' +
            '<button class="btn btn--primary" id="exp-add-btn">+ Add Expense</button>' +
            '<button class="btn btn--ghost btn--sm" id="exp-logout">Sign Out</button>' +
          '</div>' +
        '</div>' +
        '<div id="exp-form-container"></div>' +
        '<div id="exp-filter-tabs" style="display:flex;gap:0;margin-bottom:var(--space-4);border-bottom:1px solid var(--color-neutral-200)">' +
          expTabHtml('all', 'All') + expTabHtml('draft', 'Draft') + expTabHtml('submitted', 'Submitted') +
          expTabHtml('approved', 'Approved') + expTabHtml('rejected', 'Rejected') +
        '</div>' +
        '<div id="exp-list-container"></div>' +
      '</div>';

    root.querySelector('#exp-logout').addEventListener('click', function() { logout(); navigate('#/login'); });

    root.querySelector('#exp-add-btn').addEventListener('click', function() {
      _expEditingId = null;
      expShowForm(null, todayIso);
    });

    root.querySelector('#exp-filter-tabs').addEventListener('click', function(e) {
      var tab = e.target.closest('[data-filter]');
      if (!tab) return;
      _expFilter = tab.dataset.filter;
      _expPage = 0;
      expRenderFilterTabs();
      expRenderList();
    });

    var results = await Promise.all([getExpenseCategories(), getExpensesByUser(user.id)]);
    _expCats = (results[0].data || []).filter(function(c){ return c.active; });
    _expList = results[1].data || [];

    // Single click delegate on stable container — survives innerHTML swaps in expRenderList
    root.querySelector('#exp-list-container').addEventListener('click', async function(e) {
      if (e.target.closest('#exp-prev') && _expPage > 0) { _expPage--; expRenderList(); return; }
      var nextBtn = e.target.closest('#exp-next');
      if (nextBtn && _expPage < Number(nextBtn.dataset.last) - 1) { _expPage++; expRenderList(); return; }
      var editBtn   = e.target.closest('.exp-edit-btn');
      var submitBtn = e.target.closest('.exp-submit-btn');
      var deleteBtn = e.target.closest('.exp-delete-btn');
      if (editBtn) {
        var exp = _expList.find(function(x){ return x.id === editBtn.dataset.id; });
        if (exp) { _expEditingId = exp.id; expShowForm(exp, null); }
        return;
      }
      if (submitBtn) {
        var r = await submitExpense(submitBtn.dataset.id);
        if (r.error) { showToast(r.error.message, 'error'); return; }
        var idx = _expList.findIndex(function(x){ return x.id === submitBtn.dataset.id; });
        if (idx !== -1) _expList[idx] = Object.assign(_expList[idx], r.data);
        expRenderList();
        showToast('Expense submitted.', 'success');
        if (_adminEmail) {
          var _eu = currentUser();
          var _ehref = mailtoLink(_adminEmail,
            'Expense submitted for review — ' + (_eu ? _eu.name : ''),
            'Hi,\n\nI\'ve submitted an expense for your review.\n\n— ' + (_eu ? _eu.name : ''));
          var _nudge = document.createElement('div');
          _nudge.style.cssText = 'padding:var(--space-3) var(--space-4);background:var(--color-primary-light);border-radius:var(--radius-md);margin-bottom:var(--space-4);display:flex;align-items:center;gap:var(--space-3)';
          _nudge.innerHTML = '<span style="flex:1;font-size:var(--font-size-sm)">Submitted ✓</span><a href="' + esc(_ehref) + '" class="btn btn--secondary btn--sm">✉ Notify admin</a>';
          var _lc = _expRoot.querySelector('#exp-list-container');
          if (_lc) _lc.insertAdjacentElement('beforebegin', _nudge);
          setTimeout(function(){ _nudge.remove(); }, 10000);
        }
        return;
      }
      if (deleteBtn) {
        var r = await deleteExpense(deleteBtn.dataset.id);
        if (r.error) { showToast(r.error.message, 'error'); return; }
        _expList = _expList.filter(function(x){ return x.id !== deleteBtn.dataset.id; });
        expRenderList();
        showToast('Expense deleted.', 'info');
      }
    });

    expRenderList();
  }

  function expTabHtml(value, label) {
    var active = _expFilter === value;
    return '<button class="exp-filter-tab" data-filter="' + value + '" ' +
      'style="padding:var(--space-2) var(--space-4);border:none;background:none;cursor:pointer;' +
      'font-size:var(--font-size-sm);font-weight:500;font-family:inherit;' +
      'color:' + (active ? 'var(--color-primary)' : 'var(--color-neutral-500)') + ';' +
      'border-bottom:2px solid ' + (active ? 'var(--color-primary)' : 'transparent') + ';' +
      'margin-bottom:-1px">' + esc(label) + '</button>';
  }

  function expRenderFilterTabs() {
    var container = _expRoot && _expRoot.querySelector('#exp-filter-tabs');
    if (!container) return;
    container.innerHTML =
      expTabHtml('all', 'All') + expTabHtml('draft', 'Draft') + expTabHtml('submitted', 'Submitted') +
      expTabHtml('approved', 'Approved') + expTabHtml('rejected', 'Rejected');
  }

  function expRenderList() {
    var container = _expRoot && _expRoot.querySelector('#exp-list-container');
    if (!container) return;

    var filtered = _expFilter === 'all' ? _expList : _expList.filter(function(e){ return e.status === _expFilter; });

    if (!filtered.length) {
      container.innerHTML = '<div class="empty-state" style="padding:var(--space-8)"><p>No expenses' +
        (_expFilter !== 'all' ? ' with status "' + esc(_expFilter) + '"' : '') + '.</p></div>';
      return;
    }

    var PAGE = 20;
    var totalPages = Math.max(1, Math.ceil(filtered.length / PAGE));
    if (_expPage >= totalPages) _expPage = totalPages - 1;
    var pageItems = filtered.slice(_expPage * PAGE, (_expPage + 1) * PAGE);
    var firstItem = _expPage * PAGE + 1;
    var lastItem  = Math.min((_expPage + 1) * PAGE, filtered.length);

    var rows = pageItems.map(function(exp) {
      var actions = '';
      if (exp.status === 'draft' || exp.status === 'rejected') {
        actions =
          '<button class="btn btn--secondary btn--sm exp-edit-btn" data-id="' + esc(exp.id) + '">Edit</button>' +
          '<button class="btn btn--primary btn--sm exp-submit-btn" data-id="' + esc(exp.id) + '">Submit</button>' +
          '<button class="btn btn--danger btn--sm exp-delete-btn" data-id="' + esc(exp.id) + '">Delete</button>';
      }
      var rejNote = (exp.status === 'rejected' && exp.rejectionReason)
        ? '<br><small style="color:var(--color-danger-text)">Rejected: ' + esc(exp.rejectionReason) + '</small>'
        : '';
      return '<tr>' +
        '<td data-label="Date">'        + esc(exp.date) + '</td>' +
        '<td data-label="Category">'    + esc(exp.categoryName) + '</td>' +
        '<td data-label="Description">' + esc(exp.description) + rejNote + '</td>' +
        '<td data-label="Amount" style="text-align:right;font-weight:600">' + fmtMoney(exp.amount) + '</td>' +
        '<td data-label="Status"><span class="badge badge--' + exp.status + '">' + statusLabel(exp.status) + '</span></td>' +
        '<td data-label=" "><div class="data-table__actions">' + actions + '</div></td>' +
      '</tr>';
    }).join('');

    var pager = totalPages > 1
      ? '<div style="display:flex;justify-content:space-between;align-items:center;margin-top:var(--space-3);padding:0 var(--space-1)">' +
          '<span style="font-size:var(--font-size-xs);color:var(--color-neutral-500)">Showing ' + firstItem + '–' + lastItem + ' of ' + filtered.length + '</span>' +
          '<div style="display:flex;align-items:center;gap:var(--space-2)">' +
            '<button id="exp-prev" class="btn btn--secondary btn--sm"' + (_expPage === 0 ? ' disabled' : '') + '>&#8592; Prev</button>' +
            '<span style="font-size:var(--font-size-sm);color:var(--color-neutral-600)">Page ' + (_expPage + 1) + ' of ' + totalPages + '</span>' +
            '<button id="exp-next" class="btn btn--secondary btn--sm" data-last="' + totalPages + '"' + (_expPage >= totalPages - 1 ? ' disabled' : '') + '>Next &#8594;</button>' +
          '</div>' +
        '</div>'
      : '';

    container.innerHTML =
      '<div class="table-wrapper"><table class="data-table" aria-label="My expenses">' +
        '<thead><tr>' +
          '<th scope="col">Date</th><th scope="col">Category</th><th scope="col">Description</th>' +
          '<th scope="col" style="text-align:right">Amount</th><th scope="col">Status</th>' +
          '<th scope="col"><span class="sr-only">Actions</span></th>' +
        '</tr></thead>' +
        '<tbody>' + rows + '</tbody>' +
      '</table></div>' +
      pager;
  }

  function expShowForm(expense, defaultDate) {
    var container = _expRoot && _expRoot.querySelector('#exp-form-container');
    if (!container) return;

    var isEdit = !!expense;
    var catOptions = _expCats.map(function(c) {
      return '<option value="' + esc(c.id) + '"' + (expense && expense.categoryId === c.id ? ' selected' : '') + '>' + esc(c.name) + '</option>';
    }).join('');

    container.innerHTML =
      '<div class="section-card" style="margin-bottom:var(--space-5)">' +
        '<h2 style="font-size:var(--font-size-lg);margin-bottom:var(--space-4)">' + (isEdit ? 'Edit Expense' : 'New Expense') + '</h2>' +
        '<form id="exp-form">' +
          '<div class="form-row">' +
            '<div class="form-group"><label for="exp-date">Date</label>' +
              '<input id="exp-date" class="input" type="date" value="' + esc(expense ? expense.date : defaultDate) + '" required></div>' +
            '<div class="form-group"><label for="exp-cat">Category</label>' +
              '<select id="exp-cat" class="input input--select" required>' +
                '<option value="">— select —</option>' + catOptions +
              '</select></div>' +
            '<div class="form-group"><label for="exp-amount">Amount ($)</label>' +
              '<input id="exp-amount" class="input" type="number" min="0.01" step="0.01" placeholder="0.00" value="' + esc(expense ? expense.amount : '') + '" required></div>' +
          '</div>' +
          '<div class="form-row" style="margin-top:var(--space-3)">' +
            '<div class="form-group" style="flex:2"><label for="exp-desc">Description</label>' +
              '<input id="exp-desc" class="input" type="text" placeholder="Brief description" value="' + esc(expense ? expense.description : '') + '" required></div>' +
            '<div class="form-group" style="flex:2"><label for="exp-receipt">Receipt reference</label>' +
              '<input id="exp-receipt" class="input" type="text" placeholder="Paste URL or note — file upload in Phase 2" value="' + esc(expense ? expense.receiptRef : '') + '"></div>' +
          '</div>' +
          '<div style="display:flex;gap:var(--space-2);margin-top:var(--space-4)">' +
            '<button type="submit" class="btn btn--primary">Save</button>' +
            '<button type="button" class="btn btn--secondary" id="exp-form-cancel">Cancel</button>' +
          '</div>' +
        '</form>' +
      '</div>';

    container.querySelector('#exp-form-cancel').addEventListener('click', function() {
      container.innerHTML = '';
      _expEditingId = null;
    });

    container.querySelector('#exp-form').addEventListener('submit', async function(e) {
      e.preventDefault();
      var user = currentUser();
      var data = {
        date:        container.querySelector('#exp-date').value,
        categoryId:  container.querySelector('#exp-cat').value,
        amount:      parseFloat(container.querySelector('#exp-amount').value) || 0,
        description: container.querySelector('#exp-desc').value.trim(),
        receiptRef:  container.querySelector('#exp-receipt').value.trim(),
      };

      if (!data.date || !data.categoryId || data.amount <= 0 || !data.description) {
        showToast('Please fill in date, category, amount, and description.', 'error');
        return;
      }
      if (_expEditingId) data.id = _expEditingId;

      var btn = container.querySelector('button[type="submit"]');
      btn.disabled = true; btn.textContent = 'Saving…';
      var res = await saveExpense(user.id, data);
      btn.disabled = false; btn.textContent = 'Save';
      if (res.error) { showToast('Save failed: ' + res.error.message, 'error'); return; }

      var cat  = _expCats.find(function(c){ return c.id === data.categoryId; });
      var saved = Object.assign({}, res.data, { categoryName: cat ? cat.name : '—' });
      if (_expEditingId) {
        var idx = _expList.findIndex(function(x){ return x.id === _expEditingId; });
        if (idx !== -1) _expList[idx] = saved; else _expList.unshift(saved);
      } else {
        _expList.unshift(saved);
      }

      container.innerHTML = '';
      _expEditingId = null;
      _expPage = 0;
      expRenderList();
      showToast('Expense saved.', 'success');
    });
  }

  // ─── Admin Expense Approvals ──────────────────────────────────────────────
  async function adminExpenseApprovalsRender(root) {
    var main = renderAdminShell(root, '#/admin/expenses', 'Pending Expenses');
    var res  = await getPendingExpenses();
    if (res.error) {
      main.insertAdjacentHTML('beforeend', '<p style="color:var(--color-danger)">Failed to load: ' + esc(res.error.message) + '</p>');
      return;
    }
    var items = res.data || [];
    if (!items.length) {
      main.insertAdjacentHTML('beforeend', '<div class="empty-state"><p>&#10003; All caught up!</p><small>No expenses are waiting for review.</small></div>');
      return;
    }
    var rows = items.map(function(exp) {
      return '<tr>' +
        '<td data-label="Employee">'  + esc(exp.userName) + '</td>' +
        '<td data-label="Date">'      + esc(exp.date) + '</td>' +
        '<td data-label="Category">'  + esc(exp.categoryName) + '</td>' +
        '<td data-label="Description">' + esc(exp.description) + '</td>' +
        '<td data-label="Amount" style="text-align:right;font-weight:600">' + fmtMoney(exp.amount) + '</td>' +
        '<td data-label="Submitted">' + (exp.submittedAt ? formatDateTime(exp.submittedAt) : '—') + '</td>' +
        '<td data-label=" "><div class="data-table__actions">' +
          '<button class="btn btn--primary btn--sm exp-review-btn" data-id="' + esc(exp.id) + '">Review</button>' +
        '</div></td>' +
      '</tr>';
    }).join('');
    main.insertAdjacentHTML('beforeend',
      '<div class="table-wrapper"><table class="data-table" aria-label="Pending expense approvals">' +
        '<thead><tr>' +
          '<th scope="col">Employee</th><th scope="col">Date</th><th scope="col">Category</th>' +
          '<th scope="col">Description</th><th scope="col" style="text-align:right">Amount</th>' +
          '<th scope="col">Submitted</th><th scope="col"><span class="sr-only">Actions</span></th>' +
        '</tr></thead>' +
        '<tbody>' + rows + '</tbody>' +
      '</table></div>'
    );
    main.addEventListener('click', function(e) {
      var btn = e.target.closest('.exp-review-btn');
      if (btn) navigate('#/admin/expense-review/' + btn.dataset.id);
    });
  }

  // ─── Admin Expense Review ─────────────────────────────────────────────────
  async function adminExpenseReviewRender(root, params) {
    var id   = params.id;
    var main = renderAdminShell(root, '#/admin/expense-review/' + id, '');
    var res  = await getExpenseById(id);
    if (res.error || !res.data) {
      main.innerHTML = '<a class="back-link" href="#/admin/expenses">&#8592; Back to Pending Expenses</a><p style="color:var(--color-danger)">Expense not found.</p>';
      return;
    }
    var exp = res.data;

    main.innerHTML =
      '<a class="back-link" href="#/admin/expenses">&#8592; Back to Pending Expenses</a>' +
      '<div style="display:flex;align-items:center;gap:var(--space-4);margin-bottom:var(--space-6);flex-wrap:wrap">' +
        '<h1 style="margin:0">' + esc(exp.user ? exp.user.name : 'Employee') + ' — Expense</h1>' +
        '<span class="badge badge--' + exp.status + '">' + statusLabel(exp.status) + '</span>' +
      '</div>' +
      '<div style="display:grid;grid-template-columns:1fr 300px;gap:var(--space-6);align-items:start">' +
        '<div class="section-card" style="margin-top:0"><h2>Expense Detail</h2>' +
          '<table class="totals-table" style="margin-top:var(--space-3)"><tbody>' +
            '<tr><th scope="row" style="font-weight:500;color:var(--color-neutral-600)">Date</th><td>' + esc(exp.date) + '</td></tr>' +
            '<tr><th scope="row" style="font-weight:500;color:var(--color-neutral-600)">Category</th><td>' + esc(exp.categoryName || '—') + '</td></tr>' +
            '<tr><th scope="row" style="font-weight:500;color:var(--color-neutral-600)">Amount</th><td style="font-weight:700;color:var(--color-primary)">' + fmtMoney(exp.amount) + '</td></tr>' +
            '<tr><th scope="row" style="font-weight:500;color:var(--color-neutral-600)">Description</th><td>' + esc(exp.description) + '</td></tr>' +
            '<tr><th scope="row" style="font-weight:500;color:var(--color-neutral-600)">Receipt ref.</th><td>' +
              (exp.receiptRef ? esc(exp.receiptRef) : '<span style="color:var(--color-neutral-400)">None provided</span>') + '</td></tr>' +
            (exp.submittedAt ? '<tr><th scope="row" style="font-weight:500;color:var(--color-neutral-600)">Submitted</th><td>' + formatDateTime(exp.submittedAt) + '</td></tr>' : '') +
          '</tbody></table>' +
        '</div>' +
        '<aside>' +
          (exp.status === 'submitted'
            ? '<div class="section-card" style="margin-top:0"><h2>Decision</h2>' +
                '<div style="display:flex;flex-direction:column;gap:var(--space-4)">' +
                  '<button class="btn btn--success btn--block" id="exp-approve-btn">&#10003; Approve</button>' +
                  '<div>' +
                    '<label for="exp-reject-reason" style="display:block;margin-bottom:var(--space-2)">Rejection reason <span style="color:var(--color-danger)">*</span></label>' +
                    '<textarea id="exp-reject-reason" class="input input--textarea" rows="3" placeholder="Required — employee will see this"></textarea>' +
                    '<button class="btn btn--danger btn--block" id="exp-reject-btn" style="margin-top:var(--space-2)">&#10005; Reject</button>' +
                  '</div>' +
                '</div>' +
              '</div>'
            : '') +
        '</aside>' +
      '</div>';

    if (exp.status !== 'submitted') return;
    var adminId = currentUser() ? currentUser().id : null;

    function expDecisionDone(label, empEmail, empName, subject, body) {
      var aside = main.querySelector('aside');
      if (!aside) { navigate('#/admin/expenses'); return; }
      var emailBtn = (empEmail)
        ? '<a href="' + esc(mailtoLink(empEmail, subject, body)) + '" class="btn btn--secondary btn--block" style="margin-top:var(--space-3)">✉ Email ' + esc(empName) + '</a>'
        : '';
      aside.innerHTML =
        '<div class="section-card" style="margin-top:0">' +
          '<p style="font-weight:600;margin-bottom:var(--space-3)">' + label + '</p>' +
          emailBtn +
          '<a href="#/admin/expenses" class="btn btn--ghost btn--block" style="margin-top:var(--space-2)">← Back to list</a>' +
        '</div>';
    }

    main.querySelector('#exp-approve-btn').addEventListener('click', async function() {
      var btn = main.querySelector('#exp-approve-btn');
      btn.disabled = true; btn.textContent = 'Approving…';
      var r = await approveExpense(id, adminId);
      if (r.error) { showToast(r.error.message, 'error'); btn.disabled = false; btn.textContent = '&#10003; Approve'; return; }
      showToast('Expense approved.', 'success');
      expDecisionDone('✓ Approved',
        exp.user ? exp.user.email : '', exp.user ? exp.user.name : 'employee',
        'Expense approved — ' + exp.date,
        'Hi ' + (exp.user ? exp.user.name : '') + ',\n\nYour expense of $' + (exp.amount || 0).toFixed(2) + ' on ' + exp.date + ' has been approved.\n\nThanks!');
    });

    main.querySelector('#exp-reject-btn').addEventListener('click', async function() {
      var reason   = main.querySelector('#exp-reject-reason').value.trim();
      var textarea = main.querySelector('#exp-reject-reason');
      if (!reason) { textarea.setAttribute('aria-invalid', 'true'); textarea.focus(); showToast('Please enter a rejection reason.', 'error'); return; }
      textarea.removeAttribute('aria-invalid');
      var btn = main.querySelector('#exp-reject-btn');
      btn.disabled = true; btn.textContent = 'Rejecting…';
      var r = await rejectExpense(id, reason);
      if (r.error) { showToast(r.error.message, 'error'); btn.disabled = false; btn.textContent = '&#10005; Reject'; return; }
      showToast('Expense rejected.', 'info');
      expDecisionDone('✕ Returned',
        exp.user ? exp.user.email : '', exp.user ? exp.user.name : 'employee',
        'Expense returned — ' + exp.date,
        'Hi ' + (exp.user ? exp.user.name : '') + ',\n\nYour expense of $' + (exp.amount || 0).toFixed(2) + ' on ' + exp.date + ' was not approved.\n\nReason: ' + reason + '\n\nPlease update and resubmit. Thanks!');
    });
  }

  // ─── Admin Expense Categories ─────────────────────────────────────────────
  var _ecList = [], _ecEditingId = null, _ecMain = null;

  async function adminExpenseCategoriesRender(root) {
    _ecMain      = renderAdminShell(root, '#/admin/expense-categories', 'Expense Categories');
    _ecEditingId = null;

    var res = await getExpenseCategories();
    if (res.error) { _ecMain.insertAdjacentHTML('beforeend', '<p style="color:var(--color-danger)">Failed to load.</p>'); return; }
    _ecList = res.data || [];

    _ecMain.insertAdjacentHTML('beforeend',
      '<div class="table-wrapper" id="ec-table-wrapper">' +
        '<table class="data-table" aria-label="Expense categories">' +
          '<thead><tr><th scope="col">Name</th><th scope="col">Description</th><th scope="col">Status</th><th scope="col"><span class="sr-only">Actions</span></th></tr></thead>' +
          '<tbody id="ec-tbody"></tbody>' +
        '</table>' +
      '</div>' +
      '<div class="section-card" style="margin-top:var(--space-6)"><h2>Add Category</h2>' +
        '<form id="add-ec-form"><div class="add-form">' +
          '<div class="form-group"><label for="new-ec-name">Name</label><input id="new-ec-name" class="input" type="text" required maxlength="40" placeholder="e.g. Tools &amp; Equipment"></div>' +
          '<div class="form-group" style="flex:2"><label for="new-ec-desc">Description</label><input id="new-ec-desc" class="input" type="text" required placeholder="Brief description"></div>' +
          '<div style="align-self:flex-end;padding-bottom:1px"><button type="submit" class="btn btn--primary">Add</button></div>' +
        '</div></form>' +
      '</div>'
    );

    ecRenderTable();

    _ecMain.querySelector('#ec-table-wrapper').addEventListener('click', async function(e) {
      var editBtn   = e.target.closest('.ec-edit-btn');
      var saveBtn   = e.target.closest('.ec-save-btn');
      var cancelBtn = e.target.closest('.ec-cancel-btn');
      var toggleBtn = e.target.closest('.ec-toggle-btn');

      if (editBtn)   { _ecEditingId = editBtn.dataset.id; ecRenderTable(); var el = _ecMain.querySelector('#ec-edit-name'); if (el) el.focus(); return; }
      if (cancelBtn) { _ecEditingId = null; ecRenderTable(); return; }
      if (saveBtn) {
        var nameEl = _ecMain.querySelector('#ec-edit-name');
        var descEl = _ecMain.querySelector('#ec-edit-desc');
        if (!nameEl || !descEl || !nameEl.value || !descEl.value) { showToast('Name and description are required.', 'error'); return; }
        var upd = await updateExpenseCategory(saveBtn.dataset.id, { name: nameEl.value.trim(), description: descEl.value.trim() });
        if (upd.error) { showToast('Update failed: ' + upd.error.message, 'error'); return; }
        var idx = _ecList.findIndex(function(c){ return c.id === saveBtn.dataset.id; });
        if (idx !== -1) _ecList[idx] = upd.data;
        _ecEditingId = null; ecRenderTable(); showToast('Category updated.', 'success');
        return;
      }
      if (toggleBtn) {
        var isActive = toggleBtn.dataset.active === 'true';
        var tog = isActive ? await deactivateExpenseCategory(toggleBtn.dataset.id) : await reactivateExpenseCategory(toggleBtn.dataset.id);
        if (tog.error) { showToast('Update failed.', 'error'); return; }
        var tidx = _ecList.findIndex(function(c){ return c.id === toggleBtn.dataset.id; });
        if (tidx !== -1) _ecList[tidx] = tog.data;
        ecRenderTable(); showToast(isActive ? 'Deactivated.' : 'Reactivated.', 'info');
      }
    });

    _ecMain.querySelector('#add-ec-form').addEventListener('submit', async function(e) {
      e.preventDefault();
      var name = _ecMain.querySelector('#new-ec-name').value.trim();
      var desc = _ecMain.querySelector('#new-ec-desc').value.trim();
      if (!name || !desc) { showToast('Name and description are required.', 'error'); return; }
      var btn = _ecMain.querySelector('#add-ec-form button[type="submit"]');
      btn.disabled = true; btn.textContent = 'Adding…';
      var r = await createExpenseCategory({ name: name, description: desc });
      btn.disabled = false; btn.textContent = 'Add';
      if (r.error) { showToast('Failed: ' + r.error.message, 'error'); return; }
      _ecList.push(r.data);
      _ecMain.querySelector('#new-ec-name').value = '';
      _ecMain.querySelector('#new-ec-desc').value = '';
      ecRenderTable(); showToast('Category added.', 'success');
      _ecMain.querySelector('#new-ec-name').focus();
    });
  }

  function ecRenderTable() {
    var tbody = _ecMain && _ecMain.querySelector('#ec-tbody');
    if (!tbody) return;
    if (!_ecList.length) {
      tbody.innerHTML = '<tr><td colspan="4" style="text-align:center;color:var(--color-neutral-400);font-style:italic;padding:var(--space-6)">No categories yet.</td></tr>';
      return;
    }
    tbody.innerHTML = _ecList.map(function(c) {
      if (_ecEditingId === c.id) {
        return '<tr>' +
          '<td data-label="Name"><input id="ec-edit-name" class="input" type="text" value="' + esc(c.name) + '" maxlength="40" style="min-width:130px"></td>' +
          '<td data-label="Description"><input id="ec-edit-desc" class="input" type="text" value="' + esc(c.description) + '" style="width:100%"></td>' +
          '<td><span class="badge badge--' + (c.active ? 'active' : 'inactive') + '">' + (c.active ? 'Active' : 'Inactive') + '</span></td>' +
          '<td><div class="data-table__actions">' +
            '<button class="btn btn--primary btn--sm ec-save-btn" data-id="' + esc(c.id) + '">Save</button>' +
            '<button class="btn btn--secondary btn--sm ec-cancel-btn">Cancel</button>' +
          '</div></td>' +
        '</tr>';
      }
      return '<tr>' +
        '<td data-label="Name"><strong>' + esc(c.name) + '</strong></td>' +
        '<td data-label="Description">' + esc(c.description) + '</td>' +
        '<td data-label="Status"><span class="badge badge--' + (c.active ? 'active' : 'inactive') + '">' + (c.active ? 'Active' : 'Inactive') + '</span></td>' +
        '<td data-label=" "><div class="data-table__actions">' +
          '<button class="btn btn--secondary btn--sm ec-edit-btn" data-id="' + esc(c.id) + '">Edit</button>' +
          '<button class="btn btn--sm ' + (c.active ? 'btn--danger' : 'btn--ghost') + ' ec-toggle-btn" data-id="' + esc(c.id) + '" data-active="' + c.active + '">' + (c.active ? 'Deactivate' : 'Reactivate') + '</button>' +
        '</div></td>' +
      '</tr>';
    }).join('');
  }

  // ─── Billing Report ───────────────────────────────────────────────────────
  async function adminBillingRender(root) {
    var main = renderAdminShell(root, '#/admin/billing', 'Billing Report');

    function toIso(d) {
      return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
    }

    function fmtMoney(n) {
      return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n || 0);
    }

    var today        = new Date();
    var defaultFrom  = toIso(new Date(today.getFullYear(), today.getMonth(), 1));
    var defaultTo    = toIso(new Date(today.getFullYear(), today.getMonth() + 1, 0));

    main.insertAdjacentHTML('beforeend',
      '<div class="section-card" style="margin-top:0">' +
        '<p style="font-size:var(--font-size-sm);color:var(--color-neutral-500);margin-bottom:var(--space-4)">' +
          'Only <strong>approved</strong> timesheets are included. Weeks are matched by their Saturday start date.' +
        '</p>' +
        '<div class="form-row" style="align-items:flex-end">' +
          '<div class="form-group"><label for="rpt-from">From</label>' +
            '<input id="rpt-from" class="input" type="date" value="' + defaultFrom + '"></div>' +
          '<div class="form-group"><label for="rpt-to">To</label>' +
            '<input id="rpt-to" class="input" type="date" value="' + defaultTo + '"></div>' +
          '<div class="form-group"><label for="rpt-mult">OT multiplier</label>' +
            '<input id="rpt-mult" class="input" type="number" min="1" max="4" step="0.25" value="' + _otMultiplier + '" style="width:5.5rem"></div>' +
          '<div><button class="btn btn--primary" id="gen-btn">Generate</button></div>' +
        '</div>' +
      '</div>' +
      '<div id="rpt-output"></div>'
    );

    async function generate() {
      var from = main.querySelector('#rpt-from').value;
      var to   = main.querySelector('#rpt-to').value;
      var mult = parseFloat(main.querySelector('#rpt-mult').value);
      if (!isFinite(mult) || mult < 1) mult = 1;
      var out  = main.querySelector('#rpt-output');

      if (!from || !to || from > to) {
        out.innerHTML = '<p style="color:var(--color-danger);padding:var(--space-4)">Please select a valid date range.</p>';
        return;
      }

      var usersRes  = await getUsers();
      var employees = (usersRes.data || []).filter(function(u) { return u.role === 'employee'; });

      var _billTsRaw = [], _billExpRaw = [];
      if (_supabase) {
        var _billResults = await Promise.all([
          _supabase.from('timesheets').select('*, timesheet_entries(*)').eq('status', 'approved').gte('week_start', from).lte('week_start', to).order('week_start'),
          _supabase.from('expenses').select('*, expense_categories(name)').eq('status', 'approved').gte('date', from).lte('date', to)
        ]);
        if (_billResults[0].error) { out.innerHTML = '<p style="color:var(--color-danger);padding:var(--space-4)">Error: ' + esc(_billResults[0].error.message) + '</p>'; return; }
        if (_billResults[1].error) { out.innerHTML = '<p style="color:var(--color-danger);padding:var(--space-4)">Error: ' + esc(_billResults[1].error.message) + '</p>'; return; }
        _billTsRaw  = _billResults[0].data || [];
        _billExpRaw = _billResults[1].data || [];
      }

      var inRange = _supabase
        ? _billTsRaw.map(function(row){ return Object.assign(mapTimesheet(row), { _entries: (row.timesheet_entries || []).map(mapEntry) }); })
        : _dbTimesheets.filter(function(ts){ return ts.status === 'approved' && ts.weekStart >= from && ts.weekStart <= to; }).sort(function(a, b){ return a.weekStart.localeCompare(b.weekStart); });

      var inRangeExpenses = _supabase
        ? _billExpRaw.map(function(row){ return Object.assign(mapExpense(row), { categoryName: (row.expense_categories && row.expense_categories.name) || '—' }); })
        : _dbExpenses.filter(function(ex){ return ex.status === 'approved' && ex.date >= from && ex.date <= to; }).map(function(ex){
            var cat = _dbExpenseCategories.find(function(c){ return c.id === ex.categoryId; });
            return Object.assign({}, ex, { categoryName: cat ? cat.name : '—' });
          });

      if (inRange.length === 0 && inRangeExpenses.length === 0) {
        out.innerHTML = '<div class="empty-state" style="padding:var(--space-12)"><p>No approved timesheets or expenses in this period.</p><small>Approve timesheets or expenses first, then generate the report.</small></div>';
        return;
      }

      var grandTotal   = 0;
      var grandRegHrs  = 0;
      var grandOtHrs   = 0;
      var grandExpAmt  = 0;
      var html = '<div id="rpt-table">';

      employees.forEach(function(emp) {
        var empSheets   = inRange.filter(function(ts) { return ts.userId === emp.id; });
        var empExpenses = inRangeExpenses.filter(function(ex) {
          return ex.userId === emp.id;
        }).sort(function(a, b){ return a.date.localeCompare(b.date); });

        if (empSheets.length === 0 && empExpenses.length === 0) return;

        var rate   = emp.hourlyRate || 0;
        var otRate = rate * mult;
        var empRegTotal = 0, empOtTotal = 0, empLaborAmt = 0;

        var weekRows = empSheets.map(function(ts) {
          var entries = ts._entries || _dbEntries.filter(function(e) { return e.timesheetId === ts.id; });
          var tots    = weeklyTotals(entries);
          var regAmt  = tots.regular  * rate;
          var otAmt   = tots.overtime * otRate;
          var lineAmt = regAmt + otAmt;
          empRegTotal  += tots.regular;
          empOtTotal   += tots.overtime;
          empLaborAmt  += lineAmt;
          return '<tr>' +
            '<td data-label="Week">'       + formatWeekShort(ts.weekStart) + '</td>' +
            '<td data-label="Reg. Hrs" style="text-align:right">'    + fmtHours(tots.regular)  + '</td>' +
            '<td data-label="OT Hrs" style="text-align:right">'      + fmtHours(tots.overtime) + '</td>' +
            '<td data-label="Total Hrs" style="text-align:right">'   + fmtHours(tots.total)    + '</td>' +
            '<td data-label="Reg. Amount" style="text-align:right">' + fmtMoney(regAmt)  + '</td>' +
            '<td data-label="OT Amount" style="text-align:right">'   + fmtMoney(otAmt)   + '</td>' +
            '<td data-label="Line Total" style="text-align:right;font-weight:600">' + fmtMoney(lineAmt) + '</td>' +
          '</tr>';
        }).join('');

        var empExpAmt  = empExpenses.reduce(function(s, ex){ return s + (ex.amount || 0); }, 0);
        var empAmtTotal = empLaborAmt + empExpAmt;

        grandTotal  += empAmtTotal;
        grandRegHrs += empRegTotal;
        grandOtHrs  += empOtTotal;
        grandExpAmt += empExpAmt;

        var rateNote = rate > 0
          ? fmtMoney(rate) + '/h' + (mult > 1 ? '&nbsp;&nbsp;·&nbsp;&nbsp;OT: ' + fmtMoney(otRate) + '/h (' + mult + '&times;)' : '')
          : '<span style="color:var(--color-warning)">Hourly rate not set</span>';

        var expSection = '';
        if (empExpenses.length > 0) {
          var expRows = empExpenses.map(function(ex) {
            return '<tr>' +
              '<td data-label="Date">'        + esc(ex.date) + '</td>' +
              '<td data-label="Category">'    + esc(ex.categoryName || '—') + '</td>' +
              '<td data-label="Description" colspan="2">' + esc(ex.description) + '</td>' +
              '<td data-label="Amount" style="text-align:right;font-weight:600">' + fmtMoney(ex.amount) + '</td>' +
            '</tr>';
          }).join('');
          expSection =
            '<div style="margin-top:var(--space-4)">' +
              '<h3 style="font-size:var(--font-size-sm);text-transform:uppercase;letter-spacing:0.05em;color:var(--color-neutral-500);margin-bottom:var(--space-2)">Expenses (approved)</h3>' +
              '<div class="table-wrapper">' +
                '<table class="data-table" aria-label="Expenses for ' + esc(emp.name) + '">' +
                  '<thead><tr>' +
                    '<th scope="col">Date</th><th scope="col">Category</th><th scope="col" colspan="2">Description</th>' +
                    '<th scope="col" style="text-align:right">Amount</th>' +
                  '</tr></thead>' +
                  '<tbody>' + expRows + '</tbody>' +
                  '<tfoot><tr style="background:var(--color-neutral-50)">' +
                    '<td colspan="4" style="font-weight:600">Expense Subtotal</td>' +
                    '<td style="text-align:right;font-weight:700;color:var(--color-primary)">' + fmtMoney(empExpAmt) + '</td>' +
                  '</tr></tfoot>' +
                '</table>' +
              '</div>' +
            '</div>';
        }

        var totalLine = empExpAmt > 0
          ? '<div style="text-align:right;margin-top:var(--space-3);padding-top:var(--space-3);border-top:2px solid var(--color-neutral-200);font-size:var(--font-size-sm);color:var(--color-neutral-600)">' +
              'Labor: <strong>' + fmtMoney(empLaborAmt) + '</strong>' +
              '&nbsp;&nbsp;+&nbsp;&nbsp;Expenses: <strong>' + fmtMoney(empExpAmt) + '</strong>' +
              '&nbsp;&nbsp;=&nbsp;&nbsp;<span style="font-size:var(--font-size-lg);font-weight:700;color:var(--color-primary)">' + fmtMoney(empAmtTotal) + '</span>' +
            '</div>'
          : '';

        html +=
          '<div class="section-card" style="margin-top:var(--space-4);page-break-inside:avoid">' +
            '<div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:var(--space-4);flex-wrap:wrap;gap:var(--space-2)">' +
              '<h2 style="margin:0;font-size:var(--font-size-lg)">' + esc(emp.name) + '</h2>' +
              '<span style="font-size:var(--font-size-sm);color:var(--color-neutral-500)">' + rateNote + '</span>' +
            '</div>' +
            (empSheets.length > 0
              ? '<div class="table-wrapper">' +
                  '<table class="data-table" aria-label="Labor billing for ' + esc(emp.name) + '">' +
                    '<thead><tr>' +
                      '<th scope="col">Week</th>' +
                      '<th scope="col" style="text-align:right">Reg. Hrs</th>' +
                      '<th scope="col" style="text-align:right">OT Hrs</th>' +
                      '<th scope="col" style="text-align:right">Total Hrs</th>' +
                      '<th scope="col" style="text-align:right">Reg. Amount</th>' +
                      '<th scope="col" style="text-align:right">OT Amount</th>' +
                      '<th scope="col" style="text-align:right">Line Total</th>' +
                    '</tr></thead>' +
                    '<tbody>' + weekRows + '</tbody>' +
                    '<tfoot><tr style="background:var(--color-neutral-50)">' +
                      '<td style="font-weight:600">Labor Subtotal</td>' +
                      '<td style="text-align:right;font-weight:600">' + fmtHours(empRegTotal) + '</td>' +
                      '<td style="text-align:right;font-weight:600">' + fmtHours(empOtTotal)  + '</td>' +
                      '<td style="text-align:right;font-weight:600">' + fmtHours(empRegTotal + empOtTotal) + '</td>' +
                      '<td></td><td></td>' +
                      '<td style="text-align:right;font-weight:700;color:var(--color-primary)">' + fmtMoney(empLaborAmt) + '</td>' +
                    '</tr></tfoot>' +
                  '</table>' +
                '</div>'
              : '') +
            expSection +
            totalLine +
          '</div>';
      });

      // Grand total bar
      var grandLaborAmt = grandTotal - grandExpAmt;
      html +=
        '<div style="background:var(--color-neutral-900);color:white;border-radius:var(--radius-md);padding:var(--space-4) var(--space-6);margin-top:var(--space-6);display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:var(--space-3)">' +
          '<div>' +
            '<div style="font-size:var(--font-size-lg);font-weight:700">Grand Total</div>' +
            '<div style="font-size:var(--font-size-sm);color:var(--color-neutral-400);margin-top:2px">' +
              fmtHours(grandRegHrs) + ' reg + ' + fmtHours(grandOtHrs) + ' OT = ' + fmtHours(grandRegHrs + grandOtHrs) + ' h labor' +
              (grandExpAmt > 0 ? '&nbsp;&nbsp;·&nbsp;&nbsp;Expenses: ' + fmtMoney(grandExpAmt) : '') +
            '</div>' +
          '</div>' +
          '<span style="font-size:var(--font-size-3xl);font-weight:700">' + fmtMoney(grandTotal) + '</span>' +
        '</div>' +
        '<div style="text-align:right;margin-top:var(--space-4);padding-bottom:var(--space-8)">' +
          '<button class="btn btn--secondary billing-print-btn">Print / Save as PDF</button>' +
        '</div>';

      html += '</div>';
      out.innerHTML = html;
      out.querySelector('.billing-print-btn').addEventListener('click', function() { window.print(); });
    }

    main.querySelector('#gen-btn').addEventListener('click', generate);

    // Also re-generate when Enter is pressed in any input
    main.querySelectorAll('#rpt-from, #rpt-to, #rpt-mult').forEach(function(el) {
      el.addEventListener('keydown', function(e) { if (e.key === 'Enter') generate(); });
    });

    generate(); // auto-generate on load
  }

  // ─── Admin Settings ───────────────────────────────────────────────────────
  async function adminSettingsRender(root) {
    var main = renderAdminShell(root, '#/admin/settings', 'Settings');

    main.insertAdjacentHTML('beforeend',
      '<div class="section-card" style="margin-top:0;max-width:28rem">' +
        '<h2>Notifications</h2>' +
        '<div class="form-group" style="margin-bottom:var(--space-6)">' +
          '<label for="set-admin-email">Admin notification email</label>' +
          '<input id="set-admin-email" class="input" type="email" value="' + esc(_adminEmail) + '" placeholder="admin@example.com">' +
          '<small style="color:var(--color-neutral-400);display:block;margin-top:var(--space-1)">Employees are shown a mailto link to this address after submitting a timesheet or expense.</small>' +
        '</div>' +
        '<h2>Overtime Rules</h2>' +
        '<p style="font-size:var(--font-size-sm);color:var(--color-neutral-500);margin-bottom:var(--space-5)">Applied globally to My Summary and used as the default in Billing Reports.</p>' +
        '<div class="form-group">' +
          '<label for="set-threshold">Weekly OT threshold (hours)</label>' +
          '<input id="set-threshold" class="input" type="number" min="1" max="80" step="1" value="' + _otThreshold + '" style="max-width:8rem">' +
        '</div>' +
        '<div class="form-group">' +
          '<label for="set-multiplier">OT pay multiplier</label>' +
          '<input id="set-multiplier" class="input" type="number" min="1" max="4" step="0.25" value="' + _otMultiplier + '" style="max-width:8rem">' +
          '<small style="color:var(--color-neutral-400);display:block;margin-top:var(--space-1)">e.g. 1.5 = time-and-a-half</small>' +
        '</div>' +
        '<button class="btn btn--primary" id="save-settings-btn">Save</button>' +
        '<p id="settings-msg" style="margin-top:var(--space-3);font-size:var(--font-size-sm)"></p>' +
      '</div>'
    );

    main.querySelector('#save-settings-btn').addEventListener('click', async function() {
      var btn       = main.querySelector('#save-settings-btn');
      var adminEmailVal = (main.querySelector('#set-admin-email') || {}).value || '';
      var threshold     = parseFloat(main.querySelector('#set-threshold').value);
      var mult          = parseFloat(main.querySelector('#set-multiplier').value);
      var msg           = main.querySelector('#settings-msg');
      if (!isFinite(threshold) || threshold < 1) { msg.style.color = 'var(--color-danger)'; msg.textContent = 'Threshold must be at least 1 hour.'; return; }
      if (!isFinite(mult) || mult < 1)           { msg.style.color = 'var(--color-danger)'; msg.textContent = 'Multiplier must be at least 1.'; return; }
      btn.disabled = true; btn.textContent = 'Saving…';
      var r1 = await saveAppSetting('ot_threshold_hours', threshold);
      var r2 = await saveAppSetting('ot_multiplier',      mult);
      var r3 = await saveAppSetting('admin_email',        adminEmailVal.trim());
      btn.disabled = false; btn.textContent = 'Save';
      if (r1.error || r2.error || r3.error) {
        msg.style.color = 'var(--color-danger)';
        msg.textContent = 'Save failed: ' + ((r1.error || r2.error || r3.error).message);
      } else {
        msg.style.color = 'var(--color-success, #15803d)';
        msg.textContent = 'Saved — new values apply immediately.';
      }
    });
  }

  // ─── Router ────────────────────────────────────────────────────────────────
  var routes = [
    { pattern: '#/login',                         role: null,                  render: loginRender                    },
    { pattern: '#/employee',                      role: ['employee', 'admin'], render: employeeRender                 },
    { pattern: '#/employee/expenses',             role: ['employee', 'admin'], render: employeeExpensesRender         },
    { pattern: '#/employee/summary',              role: ['employee', 'admin'], render: employeeSummaryRender          },
    { pattern: '#/admin/approvals',               role: ['admin'],             render: adminApprovalsRender           },
    { pattern: '#/admin/review/:id',              role: ['admin'],             render: adminReviewRender              },
    { pattern: '#/admin/expenses',                role: ['admin'],             render: adminExpenseApprovalsRender    },
    { pattern: '#/admin/expense-review/:id',      role: ['admin'],             render: adminExpenseReviewRender       },
    { pattern: '#/admin/charge-codes',            role: ['admin'],             render: adminChargeCodesRender         },
    { pattern: '#/admin/expense-categories',      role: ['admin'],             render: adminExpenseCategoriesRender   },
    { pattern: '#/admin/users',                   role: ['admin'],             render: adminUsersRender               },
    { pattern: '#/admin/billing',                 role: ['admin'],             render: adminBillingRender             },
    { pattern: '#/admin/settings',               role: ['admin'],             render: adminSettingsRender            },
  ];

  function matchRoute(hash, pattern) {
    var hashSegs    = (hash    || '#/').replace(/^#\//, '').split('/');
    var patternSegs = (pattern || '#/').replace(/^#\//, '').split('/');
    if (hashSegs.length !== patternSegs.length) return null;
    var params = {};
    for (var i = 0; i < patternSegs.length; i++) {
      if (patternSegs[i].charAt(0) === ':') {
        params[patternSegs[i].slice(1)] = decodeURIComponent(hashSegs[i]);
      } else if (patternSegs[i] !== hashSegs[i]) {
        return null;
      }
    }
    return params;
  }

  async function dispatch(hash) {
    if (!hash || hash === '#' || hash === '#/') hash = '#/login';

    var matchedRoute = null, params = {};
    for (var i = 0; i < routes.length; i++) {
      var p = matchRoute(hash, routes[i].pattern);
      if (p !== null) { matchedRoute = routes[i]; params = p; break; }
    }
    if (!matchedRoute) { navigate('#/login'); return; }

    var user = currentUser();
    if (matchedRoute.role !== null) {
      if (!user) { navigate('#/login'); return; }
      if (matchedRoute.role.indexOf(user.role) === -1) {
        navigate(user.role === 'admin' ? '#/admin/approvals' : '#/employee');
        return;
      }
    }

    var root = document.getElementById('app-root');
    root.innerHTML = '<div class="loading-spinner" aria-label="Loading…"></div>';

    try {
      await matchedRoute.render(root, params);
    } catch (err) {
      console.error('View render error:', err);
      root.innerHTML = '<div style="padding:2rem;color:#DC2626"><h2>Something went wrong</h2><pre>' + esc(err.message) + '</pre></div>';
    }
  }

  window.addEventListener('hashchange', function (e) {
    var hash = new URL(e.newURL).hash || '#/login';
    dispatch(hash);
  });

  document.addEventListener('DOMContentLoaded', async function () {
    if (_supabase) {
      await loadAppSettings();
      var sess = await _supabase.auth.getSession();
      if (sess.data && sess.data.session) {
        var profile = await loadProfile(sess.data.session.user);
        if (profile) _currentUser = profile;
      }
    }
    dispatch(window.location.hash || '#/login');
  });

})();
