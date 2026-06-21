import { renderAdminShell } from './admin-layout.js';
import * as db from '../db.js';
import { navigate } from '../app.js';
import { fmtHours } from '../calc.js';

export async function render(root) {
  const main = renderAdminShell(root, '#/admin/approvals', 'Pending Approvals');

  const { data, error } = await db.getSubmittedTimesheets();
  if (error) {
    main.insertAdjacentHTML('beforeend', `<p style="color:var(--color-danger)">Failed to load: ${esc(error.message)}</p>`);
    return;
  }

  const items = data ?? [];

  if (items.length === 0) {
    main.insertAdjacentHTML('beforeend', `
      <div class="empty-state">
        <p>&#10003; All caught up!</p>
        <small>No timesheets are waiting for review.</small>
      </div>
    `);
    return;
  }

  const rows = items.map(({ timesheet: ts, userName, totalHours }) => `
    <tr>
      <td data-label="Employee">${esc(userName)}</td>
      <td data-label="Week of">${formatWeek(ts.weekStart)}</td>
      <td data-label="Total Hours" style="text-align:right">${fmtHours(totalHours)} h</td>
      <td data-label="Submitted">${ts.submittedAt ? formatDateTime(ts.submittedAt) : '—'}</td>
      <td data-label=" ">
        <div class="data-table__actions">
          <button class="btn btn--primary btn--sm review-btn" data-id="${esc(ts.id)}">Review</button>
        </div>
      </td>
    </tr>
  `).join('');

  main.insertAdjacentHTML('beforeend', `
    <div class="table-wrapper">
      <table class="data-table" aria-label="Submitted timesheets pending review">
        <thead>
          <tr>
            <th scope="col">Employee</th>
            <th scope="col">Week of</th>
            <th scope="col" style="text-align:right">Total Hours</th>
            <th scope="col">Submitted</th>
            <th scope="col"><span class="sr-only">Actions</span></th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
  `);

  main.addEventListener('click', e => {
    const btn = e.target.closest('.review-btn');
    if (btn) navigate('#/admin/review/' + btn.dataset.id);
  });
}

function formatWeek(weekStart) {
  const sat = new Date(weekStart + 'T00:00:00');
  const fri = new Date(sat);
  fri.setDate(fri.getDate() + 6);
  const fmt = d => d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  return `${fmt(sat)} – ${fmt(fri)}`;
}

function formatDateTime(iso) {
  return new Date(iso).toLocaleString('en-US', {
    month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit'
  });
}

function esc(str) {
  return String(str ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
