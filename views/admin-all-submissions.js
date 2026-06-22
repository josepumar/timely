import { renderAdminShell } from './admin-layout.js';
import * as db from '../db.js';
import { navigate } from '../app.js';
import { fmtHours } from '../calc.js';

export async function render(root) {
  const main = renderAdminShell(root, '#/admin/all', 'All Submissions');

  const [{ data: tsData, error: tsErr }, { data: exData, error: exErr }] = await Promise.all([
    db.getAllTimesheets(),
    db.getAllExpenses(),
  ]);

  if (tsErr || exErr) {
    main.insertAdjacentHTML('beforeend',
      `<p style="color:var(--color-danger)">Failed to load submissions.</p>`);
    return;
  }

  // Combine timesheets and expenses into a single list
  const allItems = [
    ...(tsData ?? []).map(({ timesheet: ts, userName, totalHours }) => ({
      id: ts.id,
      type: 'timesheet',
      employee: userName,
      period: ts.weekStart,
      amount: totalHours,
      status: ts.status,
      submittedAt: ts.submittedAt,
    })),
    ...(exData ?? []).map(({ expense: ex, userName }) => ({
      id: ex.id,
      type: 'expense',
      employee: userName,
      period: ex.date,
      amount: ex.amount,
      status: ex.status,
      submittedAt: ex.submittedAt,
    })),
  ];

  // Sort newest first
  allItems.sort((a, b) => (b.submittedAt ?? '').localeCompare(a.submittedAt ?? ''));

  // Build year options from data (plus current year)
  const currentYear = new Date().getFullYear();
  const yearsInData = [...new Set(allItems.map(i => new Date(i.period + 'T00:00:00').getFullYear()))];
  const years = [...new Set([currentYear, ...yearsInData])].sort((a, b) => b - a);

  const todayIso = isoDate(new Date());
  const yearStartIso = `${currentYear}-01-01`;

  main.insertAdjacentHTML('beforeend', `
    <div class="section-card" style="padding:var(--space-4);margin-bottom:var(--space-4)">
      <div style="display:flex;flex-wrap:wrap;gap:var(--space-3);align-items:flex-end">

        <div class="form-group" style="min-width:130px;margin:0">
          <label for="filter-status" style="font-size:var(--font-size-xs);color:var(--color-neutral-500);text-transform:uppercase;letter-spacing:.05em;font-weight:500">Status</label>
          <select id="filter-status" class="input input--select">
            <option value="">All</option>
            <option value="submitted">Submitted</option>
            <option value="approved">Approved</option>
            <option value="rejected">Rejected</option>
            <option value="returned">Returned</option>
          </select>
        </div>

        <div class="form-group" style="min-width:130px;margin:0">
          <label for="filter-type" style="font-size:var(--font-size-xs);color:var(--color-neutral-500);text-transform:uppercase;letter-spacing:.05em;font-weight:500">Type</label>
          <select id="filter-type" class="input input--select">
            <option value="">All</option>
            <option value="timesheet">Timesheet</option>
            <option value="expense">Expense</option>
          </select>
        </div>

        <div class="form-group" style="flex:1;min-width:160px;margin:0">
          <label for="filter-employee" style="font-size:var(--font-size-xs);color:var(--color-neutral-500);text-transform:uppercase;letter-spacing:.05em;font-weight:500">Employee</label>
          <input id="filter-employee" class="input" type="search" placeholder="Search by name…">
        </div>

        <div class="form-group" style="min-width:110px;margin:0">
          <label for="filter-year" style="font-size:var(--font-size-xs);color:var(--color-neutral-500);text-transform:uppercase;letter-spacing:.05em;font-weight:500">Year</label>
          <select id="filter-year" class="input input--select">
            ${years.map(y => `<option value="${y}"${y === currentYear ? ' selected' : ''}>${y}</option>`).join('')}
            <option value="custom">Custom</option>
          </select>
        </div>

        <div class="form-group" style="min-width:130px;margin:0">
          <label for="filter-from" style="font-size:var(--font-size-xs);color:var(--color-neutral-500);text-transform:uppercase;letter-spacing:.05em;font-weight:500">From</label>
          <input id="filter-from" class="input" type="date" value="${yearStartIso}">
        </div>

        <div class="form-group" style="min-width:130px;margin:0">
          <label for="filter-to" style="font-size:var(--font-size-xs);color:var(--color-neutral-500);text-transform:uppercase;letter-spacing:.05em;font-weight:500">To</label>
          <input id="filter-to" class="input" type="date" value="${todayIso}">
        </div>

      </div>
    </div>

    <div class="table-wrapper">
      <table class="data-table" aria-label="All submissions">
        <thead>
          <tr>
            <th scope="col">Employee</th>
            <th scope="col">Type</th>
            <th scope="col">Period</th>
            <th scope="col" style="text-align:right">Hrs / Amount</th>
            <th scope="col">Status</th>
            <th scope="col">Submitted</th>
            <th scope="col"><span class="sr-only">Actions</span></th>
          </tr>
        </thead>
        <tbody id="submissions-tbody"></tbody>
      </table>
      <div id="empty-state" class="empty-state" style="display:none">
        <p>No submissions match your filters.</p>
      </div>
    </div>
  `);

  // Wire up filters
  const statusEl   = main.querySelector('#filter-status');
  const typeEl     = main.querySelector('#filter-type');
  const employeeEl = main.querySelector('#filter-employee');
  const yearEl     = main.querySelector('#filter-year');
  const fromEl     = main.querySelector('#filter-from');
  const toEl       = main.querySelector('#filter-to');

  function applyFilters() {
    const status   = statusEl.value;
    const type     = typeEl.value;
    const employee = employeeEl.value.trim().toLowerCase();
    const from     = fromEl.value;
    const to       = toEl.value;

    const filtered = allItems.filter(item => {
      if (status   && item.status !== status)                           return false;
      if (type     && item.type   !== type)                             return false;
      if (employee && !item.employee.toLowerCase().includes(employee))  return false;
      if (from     && item.period < from)                               return false;
      if (to       && item.period > to)                                 return false;
      return true;
    });

    renderRows(filtered);
  }

  // Year dropdown sets date inputs; manual date input clears year to "Custom"
  yearEl.addEventListener('change', () => {
    const y = yearEl.value;
    if (y === 'custom') return;
    fromEl.value = `${y}-01-01`;
    toEl.value   = y === String(currentYear) ? todayIso : `${y}-12-31`;
    applyFilters();
  });

  fromEl.addEventListener('change', () => { yearEl.value = 'custom'; applyFilters(); });
  toEl.addEventListener('change',   () => { yearEl.value = 'custom'; applyFilters(); });
  statusEl.addEventListener('change',   applyFilters);
  typeEl.addEventListener('change',     applyFilters);
  employeeEl.addEventListener('input',  applyFilters);

  // Delegate click for Review buttons
  main.querySelector('#submissions-tbody').addEventListener('click', e => {
    const btn = e.target.closest('.review-btn');
    if (!btn) return;
    const { id, type } = btn.dataset;
    navigate(type === 'expense' ? '#/admin/expense-review/' + id : '#/admin/review/' + id);
  });

  // Initial render with current-year default
  applyFilters();
}

function renderRows(items) {
  const tbody = document.querySelector('#submissions-tbody');
  const empty = document.querySelector('#empty-state');
  if (!tbody) return;

  if (items.length === 0) {
    tbody.innerHTML = '';
    if (empty) empty.style.display = '';
    return;
  }
  if (empty) empty.style.display = 'none';

  tbody.innerHTML = items.map(item => {
    const periodLabel = item.type === 'timesheet' ? formatWeek(item.period) : formatDate(item.period);
    const amountLabel = item.type === 'timesheet'
      ? `${fmtHours(item.amount)} h`
      : `$${Number(item.amount).toFixed(2)}`;
    const typeLabel   = item.type === 'timesheet' ? 'Timesheet' : 'Expense';
    const typeBadge   = item.type === 'timesheet'
      ? `<span class="badge badge--draft" style="background:#e0e7ff;color:#3730a3">${typeLabel}</span>`
      : `<span class="badge badge--draft" style="background:#d1fae5;color:#065f46">${typeLabel}</span>`;

    return `<tr>
      <td data-label="Employee">${esc(item.employee)}</td>
      <td data-label="Type">${typeBadge}</td>
      <td data-label="Period">${esc(periodLabel)}</td>
      <td data-label="Hrs / Amount" style="text-align:right;font-variant-numeric:tabular-nums">${esc(amountLabel)}</td>
      <td data-label="Status"><span class="badge badge--${esc(item.status)}">${statusLabel(item.status)}</span></td>
      <td data-label="Submitted">${item.submittedAt ? formatDateTime(item.submittedAt) : '—'}</td>
      <td data-label=" ">
        <div class="data-table__actions">
          <button class="btn btn--primary btn--sm review-btn" data-id="${esc(item.id)}" data-type="${esc(item.type)}">Review</button>
        </div>
      </td>
    </tr>`;
  }).join('');
}

function isoDate(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function formatWeek(weekStart) {
  const sat = new Date(weekStart + 'T00:00:00');
  const fri = new Date(sat); fri.setDate(fri.getDate() + 6);
  const fmt = d => d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  return `${fmt(sat)} – ${fmt(fri)}`;
}

function formatDate(iso) {
  return new Date(iso + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function formatDateTime(iso) {
  return new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

function statusLabel(s) {
  return { submitted: 'Submitted', approved: 'Approved', rejected: 'Rejected', returned: 'Returned' }[s] ?? s;
}

function esc(str) {
  return String(str ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
