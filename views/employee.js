import { currentUser, logout } from '../auth.js';
import * as db from '../db.js';
import { roundedHours, weeklyTotals, remarksRollup, fmtHours } from '../calc.js';
import { navigate, showToast } from '../app.js';
import { timesheetGridReadonlyHtml } from './timesheet-rows.js';
import { OT_THRESHOLD_HOURS, WEEK_START_DAY } from '../config.js';

const DAY_LABELS  = ['SAT', 'SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI'];

// Module-level state (reset on each render call)
let _root;
let _weekStart;      // Date (Saturday 00:00 local)
let _timesheet;      // current timesheet object or null
let _entries;        // mutable working copy of entries
let _chargeCodes;
let _isDirty;
let _nextLocalId = 0;

// ─── Entry ID helper ──────────────────────────────────────────────────────────
function localId() { return 'new-' + (_nextLocalId++); }

// ─── Week helpers ─────────────────────────────────────────────────────────────
function getWeekStart(date) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  while (d.getDay() !== WEEK_START_DAY) d.setDate(d.getDate() - 1);
  return d;
}

function isoDate(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function formatWeekLabel(satDate) {
  const fri = new Date(satDate);
  fri.setDate(fri.getDate() + 6);
  const fmt = d => d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  return `${fmt(satDate)} – ${fmt(fri)}`;
}

// ─── Entry helpers ────────────────────────────────────────────────────────────
function makeEmptyEntry(dayOffset) {
  return { id: localId(), timesheetId: null, dayOffset, timeIn: '', timeOut: '', chargeCodeId: _chargeCodes[0]?.id ?? '', remark: '' };
}

// ─── Status helpers ───────────────────────────────────────────────────────────
function isEditable() {
  const s = _timesheet?.status;
  return !s || s === 'draft' || s === 'rejected' || s === 'returned';
}

// ─── Main render ─────────────────────────────────────────────────────────────
export async function render(root, _params) {
  _root = root;
  _weekStart = getWeekStart(new Date());
  _entries   = [];
  _isDirty   = false;

  const { data: ccData } = await db.getChargeCodes();
  _chargeCodes = (ccData ?? []).filter(c => c.active);

  await loadWeek();
}

async function loadWeek() {
  const user = currentUser();
  const { data, error } = await db.getTimesheetForWeek(user.id, isoDate(_weekStart));
  if (error) { showToast('Failed to load timesheet', 'error'); return; }

  _timesheet = data.timesheet;
  _entries   = data.entries.map(e => ({ ...e }));
  _isDirty   = false;

  renderShell();
  renderDayRows();
  renderTotals();
}

// ─── Shell (header + containers) ─────────────────────────────────────────────
function renderShell() {
  const user   = currentUser();
  const status = _timesheet?.status ?? 'draft';
  const rejReason = _timesheet?.rejectionReason;

  _root.innerHTML = `
    <div class="employee-view">
      <header class="view-header">
        <button class="btn btn--icon btn--secondary" id="prev-week" aria-label="Previous week">&#8592;</button>
        <span class="view-header__week" id="week-label">${formatWeekLabel(_weekStart)}</span>
        <button class="btn btn--icon btn--secondary" id="next-week" aria-label="Next week">&#8594;</button>
        <div class="view-header__right">
          <span class="badge badge--${status}" id="status-badge">${statusLabel(status)}</span>
          <span class="view-header__user">${esc(user.name)}</span>
          <button class="btn btn--ghost btn--sm" id="logout-btn">Sign Out</button>
        </div>
      </header>

      ${rejReason && status === 'rejected' ? `<div class="status-banner" style="background:var(--color-danger-light);border:1px solid var(--color-danger);color:var(--color-danger-text);border-radius:var(--radius-md);padding:var(--space-3) var(--space-4);margin-bottom:var(--space-4);font-size:var(--font-size-sm)">
        <strong>Rejected:</strong> ${esc(rejReason)}
      </div>` : ''}
      ${rejReason && status === 'returned' ? `<div class="status-banner" style="background:#fef3c7;border:1px solid #f59e0b;color:#92400e;border-radius:var(--radius-md);padding:var(--space-3) var(--space-4);margin-bottom:var(--space-4);font-size:var(--font-size-sm)">
        <strong>Returned for revision:</strong> ${esc(rejReason)}
      </div>` : ''}

      <div class="timesheet-grid" id="timesheet-grid"></div>

      <div class="totals-section" id="totals-section">
        <h2>Weekly Summary</h2>
        <table class="totals-table" id="totals-table" aria-label="Weekly totals">
          <thead>
            <tr>
              <th scope="col">Charge Code</th>
              <th scope="col" style="text-align:right">Hours</th>
            </tr>
          </thead>
          <tbody id="totals-by-code"></tbody>
          <tfoot id="totals-footer"></tfoot>
        </table>
        <div id="remarks-container"></div>
        <div class="banked-hours">
          Bank balance: <strong id="banked-hours">${fmtHours(currentUser().bankedHours)} h</strong>
        </div>
      </div>

      <footer class="action-bar" id="action-bar"></footer>
    </div>
  `;

  // Header events
  _root.querySelector('#prev-week').addEventListener('click', () => {
    _weekStart.setDate(_weekStart.getDate() - 7);
    loadWeek();
  });
  _root.querySelector('#next-week').addEventListener('click', () => {
    _weekStart.setDate(_weekStart.getDate() + 7);
    loadWeek();
  });
  _root.querySelector('#logout-btn').addEventListener('click', () => { logout(); navigate('#/login'); });

  renderActionBar();
}

function statusLabel(s) {
  return { draft: 'Draft', submitted: 'Submitted', approved: 'Approved', rejected: 'Rejected', returned: 'Returned' }[s] ?? s;
}

// ─── Action Bar ───────────────────────────────────────────────────────────────
function renderActionBar() {
  const bar = _root.querySelector('#action-bar');
  if (!isEditable()) {
    bar.innerHTML = '';
    return;
  }
  bar.innerHTML = `
    <button class="btn btn--secondary" id="save-btn" ${_isDirty ? '' : 'disabled'}>Save Draft</button>
    <button class="btn btn--primary" id="submit-btn"
      ${(_timesheet?.status === 'submitted' || _timesheet?.status === 'approved') ? 'disabled' : ''}>

      Submit for Approval
    </button>
  `;
  bar.querySelector('#save-btn').addEventListener('click', handleSave);
  bar.querySelector('#submit-btn').addEventListener('click', handleSubmit);
}

// ─── Day Rows (editable or read-only) ────────────────────────────────────────
function renderDayRows() {
  const grid = _root.querySelector('#timesheet-grid');
  if (!grid) return;

  if (!isEditable()) {
    grid.innerHTML = timesheetGridReadonlyHtml(_entries, _chargeCodes, isoDate(_weekStart));
    return;
  }

  const satDate = new Date(_weekStart);
  let html = '';

  for (let d = 0; d < 7; d++) {
    const dayDate  = new Date(satDate);
    dayDate.setDate(satDate.getDate() + d);
    const dayLabel = DAY_LABELS[d];
    const dateStr  = dayDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    const dayEntries = _entries.filter(e => e.dayOffset === d);

    html += `
      <div class="day-row" data-day="${d}">
        <div class="day-row__header">
          <span class="day-row__label">${dayLabel} <span class="day-row__date">${dateStr}</span></span>
          <button class="btn btn--sm btn--ghost add-entry-btn" data-day="${d}" aria-label="Add entry for ${dayLabel} ${dateStr}">+ Add</button>
        </div>
        <div class="day-row__entries" id="day-entries-${d}">
          ${dayEntries.length === 0 ? '<p class="day-row__empty" id="empty-${d}">No entries</p>' : ''}
          ${dayEntries.map(e => entryRowHtml(e)).join('')}
        </div>
      </div>
    `;
  }

  grid.innerHTML = html;

  // Delegate: one listener on grid covers all interactions
  grid.addEventListener('click',  handleGridClick);
  grid.addEventListener('input',  handleEntryInput);
  grid.addEventListener('change', handleEntryInput);
}

// ─── Entry Row HTML ───────────────────────────────────────────────────────────
function entryRowHtml(entry) {
  const hrs = entry.timeIn && entry.timeOut ? fmtHours(roundedHours(entry.timeIn, entry.timeOut)) : '—';
  const ccOptions = _chargeCodes.map(cc =>
    `<option value="${esc(cc.id)}" ${cc.id === entry.chargeCodeId ? 'selected' : ''}>${esc(cc.code)} — ${esc(cc.description)}</option>`
  ).join('');

  return `
    <div class="entry-row" data-entry-id="${esc(entry.id)}">
      <div class="entry-row__times">
        <label class="sr-only" for="in-${esc(entry.id)}">Time In</label>
        <input id="in-${esc(entry.id)}" class="input input--time" type="time"
          value="${esc(entry.timeIn)}" data-field="timeIn" aria-label="Time in">
        <span class="entry-row__sep">–</span>
        <label class="sr-only" for="out-${esc(entry.id)}">Time Out</label>
        <input id="out-${esc(entry.id)}" class="input input--time" type="time"
          value="${esc(entry.timeOut)}" data-field="timeOut" aria-label="Time out">
        <span class="entry-row__hours" id="hrs-${esc(entry.id)}">${hrs} h</span>
      </div>
      <div class="entry-row__meta">
        <label class="sr-only" for="cc-${esc(entry.id)}">Charge Code</label>
        <select id="cc-${esc(entry.id)}" class="input input--select" data-field="chargeCodeId" style="min-width:160px">
          ${ccOptions}
        </select>
        <label class="sr-only" for="rem-${esc(entry.id)}">Remark</label>
        <input id="rem-${esc(entry.id)}" class="input" type="text" placeholder="Remark (optional)"
          value="${esc(entry.remark)}" data-field="remark" style="flex:1;min-width:120px">
        <span class="entry-row__remove">
          <button class="btn btn--icon btn--danger remove-entry-btn" data-entry-id="${esc(entry.id)}"
            aria-label="Remove this entry" title="Remove entry">&#x2715;</button>
        </span>
      </div>
    </div>
  `;
}

// ─── Event Handlers ───────────────────────────────────────────────────────────
function handleGridClick(e) {
  // Add entry
  const addBtn = e.target.closest('.add-entry-btn');
  if (addBtn) {
    const day = Number(addBtn.dataset.day);
    const entry = makeEmptyEntry(day);
    _entries.push(entry);
    markDirty();

    const container = _root.querySelector(`#day-entries-${day}`);
    if (container) {
      const empty = container.querySelector('.day-row__empty');
      if (empty) empty.remove();
      container.insertAdjacentHTML('beforeend', entryRowHtml(entry));
      container.querySelector(`#in-${entry.id}`)?.focus();
    }
    return;
  }

  // Remove entry
  const removeBtn = e.target.closest('.remove-entry-btn');
  if (removeBtn) {
    const entryId = removeBtn.dataset.entryId;
    _entries = _entries.filter(e => e.id !== entryId);
    markDirty();

    const row = _root.querySelector(`.entry-row[data-entry-id="${entryId}"]`);
    if (row) {
      const container = row.closest('.day-row__entries');
      row.remove();
      if (!container.querySelector('.entry-row')) {
        container.innerHTML = `<p class="day-row__empty">No entries</p>`;
      }
    }
    recalcTotals();
    return;
  }
}

function handleEntryInput(e) {
  const row = e.target.closest('[data-entry-id]');
  if (!row) return;

  const entryId = row.dataset.entryId;
  const field   = e.target.dataset.field;
  const value   = e.target.value;
  const entry   = _entries.find(en => en.id === entryId);
  if (!entry || !field) return;

  entry[field] = value;
  markDirty();

  // Update the live hours display for this entry
  if (field === 'timeIn' || field === 'timeOut') {
    const hrsEl = _root.querySelector(`#hrs-${entryId}`);
    if (hrsEl) {
      const h = entry.timeIn && entry.timeOut ? fmtHours(roundedHours(entry.timeIn, entry.timeOut)) : '—';
      hrsEl.textContent = `${h} h`;
    }
    recalcTotals();
  }
}

function markDirty() {
  _isDirty = true;
  const saveBtn = _root.querySelector('#save-btn');
  if (saveBtn) saveBtn.disabled = false;
}

// ─── Totals ───────────────────────────────────────────────────────────────────
function renderTotals() {
  recalcTotals();
}

function recalcTotals() {
  const { total, regular, overtime, byCode } = weeklyTotals(_entries, OT_THRESHOLD_HOURS);

  // By-code rows
  const tbodyEl = _root.querySelector('#totals-by-code');
  if (tbodyEl) {
    const codeRows = Object.entries(byCode)
      .filter(([, h]) => h > 0)
      .map(([ccId, h]) => {
        const cc = _chargeCodes.find(c => c.id === ccId);
        return `<tr>
          <th scope="row" style="font-weight:normal">${esc(cc?.code ?? ccId)}<br>
            <small style="color:var(--color-neutral-400)">${esc(cc?.description ?? '')}</small></th>
          <td style="text-align:right">${fmtHours(h)}</td>
        </tr>`;
      }).join('');
    tbodyEl.innerHTML = codeRows || '<tr><td colspan="2" style="color:var(--color-neutral-400);font-style:italic">No hours recorded</td></tr>';
  }

  // Footer totals
  const footerEl = _root.querySelector('#totals-footer');
  if (footerEl) {
    footerEl.innerHTML = `
      <tr class="totals-table__divider">
        <th scope="row">Regular</th>
        <td style="text-align:right">${fmtHours(regular)}</td>
      </tr>
      ${overtime > 0 ? `<tr class="totals-table__overtime">
        <th scope="row">Overtime</th>
        <td style="text-align:right">${fmtHours(overtime)}</td>
      </tr>` : ''}
      <tr class="totals-table__total">
        <th scope="row">Total</th>
        <td style="text-align:right">${fmtHours(total)}</td>
      </tr>
    `;
  }

  // Remarks rollup
  const remarksEl = _root.querySelector('#remarks-container');
  if (remarksEl) {
    const rollup = remarksRollup(_entries);
    remarksEl.innerHTML = rollup
      ? `<div style="margin-top:var(--space-4)">
           <p style="font-size:var(--font-size-sm);font-weight:600;color:var(--color-neutral-600);margin-bottom:var(--space-2)">Remarks Summary</p>
           <div class="remarks-rollup">${esc(rollup)}</div>
         </div>`
      : '';
  }
}

// ─── Save ─────────────────────────────────────────────────────────────────────
async function handleSave() {
  const user = currentUser();
  const saveBtn = _root.querySelector('#save-btn');
  if (saveBtn) { saveBtn.disabled = true; saveBtn.textContent = 'Saving…'; }

  const { data, error } = await db.saveTimesheet(user.id, isoDate(_weekStart), _entries);
  if (error) {
    showToast('Save failed: ' + error.message, 'error');
    if (saveBtn) { saveBtn.disabled = false; saveBtn.textContent = 'Save Draft'; }
    return;
  }

  _timesheet = data.timesheet;
  _entries   = data.entries;
  _isDirty   = false;

  if (saveBtn) { saveBtn.disabled = true; saveBtn.textContent = 'Save Draft'; }
  showToast('Timesheet saved.', 'success');
}

// ─── Submit ───────────────────────────────────────────────────────────────────
async function handleSubmit() {
  if (_entries.length === 0) {
    showToast('Add at least one time entry before submitting.', 'error');
    return;
  }

  // Auto-save first if dirty
  if (_isDirty) await handleSave();
  if (!_timesheet) { showToast('Save failed. Cannot submit.', 'error'); return; }

  const { data, error } = await db.submitTimesheet(_timesheet.id);
  if (error) { showToast(error.message, 'error'); return; }

  _timesheet = data;
  _isDirty   = false;

  // Update badge
  const badge = _root.querySelector('#status-badge');
  if (badge) {
    badge.className = 'badge badge--submitted';
    badge.textContent = 'Submitted';
  }

  // Remove action bar (can no longer edit)
  const bar = _root.querySelector('#action-bar');
  if (bar) bar.innerHTML = '';

  // Re-render grid as read-only
  const grid = _root.querySelector('#timesheet-grid');
  if (grid) grid.innerHTML = timesheetGridReadonlyHtml(_entries, _chargeCodes, isoDate(_weekStart));

  // Remove any status banner (rejected / returned) if present
  _root.querySelector('.status-banner')?.remove();

  showToast('Timesheet submitted for approval.', 'success');
}

function esc(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
