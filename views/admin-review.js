import { renderAdminShell } from './admin-layout.js';
import { timesheetGridReadonlyHtml } from './timesheet-rows.js';
import * as db from '../db.js';
import { getChargeCodes } from '../db.js';
import { fmtHours, remarksRollup } from '../calc.js';
import { navigate, showToast } from '../app.js';
import { currentUser } from '../auth.js';

export async function render(root, { id }) {
  const main = renderAdminShell(root, '#/admin/review/' + id, '');

  const [{ data: tsData, error: tsErr }, { data: ccData }] = await Promise.all([
    db.getTimesheetById(id),
    getChargeCodes(),
  ]);

  if (tsErr || !tsData) {
    main.innerHTML = `<a class="back-link" href="#/admin/approvals">← Back to Approvals</a>
      <p style="color:var(--color-danger)">Timesheet not found.</p>`;
    return;
  }

  const { timesheet: ts, user, entries, totals } = tsData;
  const chargeCodes = ccData ?? [];

  const weekLabel = formatWeek(ts.weekStart);
  const rollup    = remarksRollup(entries);

  main.innerHTML = `
    <a class="back-link" href="#/admin/approvals">&#8592; Back to Approvals</a>
    <div style="display:flex;align-items:center;gap:var(--space-4);margin-bottom:var(--space-6);flex-wrap:wrap">
      <h1 style="margin:0">${esc(user?.name ?? 'Employee')} — ${esc(weekLabel)}</h1>
      <span class="badge badge--${ts.status}">${statusLabel(ts.status)}</span>
    </div>

    <div style="display:grid;grid-template-columns:1fr 280px;gap:var(--space-6);align-items:start" id="review-grid">

      <div>
        <h2 style="font-size:var(--font-size-lg);margin-bottom:var(--space-4)">Time Entries</h2>
        ${timesheetGridReadonlyHtml(entries, chargeCodes, ts.weekStart)}
      </div>

      <aside>
        <div class="section-card" style="margin-top:0">
          <h2>Weekly Summary</h2>
          <table class="totals-table" aria-label="Weekly totals">
            <thead>
              <tr>
                <th scope="col">Charge Code</th>
                <th scope="col" style="text-align:right">Hours</th>
              </tr>
            </thead>
            <tbody>
              ${Object.entries(totals.byCode).filter(([,h]) => h > 0).map(([ccId, h]) => {
                const cc = chargeCodes.find(c => c.id === ccId);
                return `<tr>
                  <th scope="row" style="font-weight:normal">${esc(cc?.code ?? ccId)}</th>
                  <td style="text-align:right">${fmtHours(h)}</td>
                </tr>`;
              }).join('')}
            </tbody>
            <tfoot>
              <tr class="totals-table__divider">
                <th scope="row">Regular</th>
                <td style="text-align:right">${fmtHours(totals.regular)}</td>
              </tr>
              ${totals.overtime > 0 ? `<tr class="totals-table__overtime">
                <th scope="row">Overtime</th>
                <td style="text-align:right">${fmtHours(totals.overtime)}</td>
              </tr>` : ''}
              <tr class="totals-table__total">
                <th scope="row">Total</th>
                <td style="text-align:right">${fmtHours(totals.total)}</td>
              </tr>
            </tfoot>
          </table>

          ${rollup ? `<div style="margin-top:var(--space-4)">
            <p style="font-size:var(--font-size-sm);font-weight:600;color:var(--color-neutral-600);margin-bottom:var(--space-2)">Remarks</p>
            <div class="remarks-rollup">${esc(rollup)}</div>
          </div>` : ''}
        </div>

        ${ts.status === 'submitted' ? `
        <div class="section-card">
          <h2>Decision</h2>
          <div class="review-actions" style="flex-direction:column;gap:var(--space-4);padding-top:0;border-top:none;margin-top:0">
            <button class="btn btn--success btn--block" id="approve-btn">&#10003; Approve</button>
            <div class="reject-section">
              <label for="reject-reason">Rejection reason <span style="color:var(--color-danger)">*</span></label>
              <textarea id="reject-reason" class="input input--textarea" rows="3"
                placeholder="Required — employee will see this message"></textarea>
              <button class="btn btn--danger btn--block" id="reject-btn">&#10005; Reject</button>
            </div>
          </div>
        </div>` : ''}
      </aside>
    </div>
  `;

  if (ts.status !== 'submitted') return;

  const adminId = currentUser()?.id;

  main.querySelector('#approve-btn').addEventListener('click', async () => {
    const btn = main.querySelector('#approve-btn');
    btn.disabled = true; btn.textContent = 'Approving…';
    const { error } = await db.approveTimesheet(id, adminId);
    if (error) { showToast(error.message, 'error'); btn.disabled = false; btn.textContent = '✓ Approve'; return; }
    showToast('Timesheet approved.', 'success');
    navigate('#/admin/approvals');
  });

  main.querySelector('#reject-btn').addEventListener('click', async () => {
    const reason = main.querySelector('#reject-reason').value.trim();
    const textarea = main.querySelector('#reject-reason');
    if (!reason) {
      textarea.setAttribute('aria-invalid', 'true');
      textarea.focus();
      showToast('Please enter a rejection reason.', 'error');
      return;
    }
    textarea.removeAttribute('aria-invalid');

    const btn = main.querySelector('#reject-btn');
    btn.disabled = true; btn.textContent = 'Rejecting…';
    const { error } = await db.rejectTimesheet(id, reason);
    if (error) { showToast(error.message, 'error'); btn.disabled = false; btn.textContent = '✕ Reject'; return; }
    showToast('Timesheet rejected.', 'info');
    navigate('#/admin/approvals');
  });
}

function formatWeek(weekStart) {
  const sat = new Date(weekStart + 'T00:00:00');
  const fri = new Date(sat); fri.setDate(fri.getDate() + 6);
  const fmt = d => d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  return `${fmt(sat)} – ${fmt(fri)}`;
}

function statusLabel(s) {
  return { draft: 'Draft', submitted: 'Submitted', approved: 'Approved', rejected: 'Rejected' }[s] ?? s;
}

function esc(str) {
  return String(str ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
