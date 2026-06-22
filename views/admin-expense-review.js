import { renderAdminShell } from './admin-layout.js';
import * as db from '../db.js';
import { navigate, showToast } from '../app.js';
import { currentUser } from '../auth.js';

export async function render(root, { id }) {
  const main = renderAdminShell(root, '#/admin/expense-review/' + id, '');
  await loadReview(main, id);
}

async function loadReview(main, id) {
  main.innerHTML = '<div class="loading-spinner" aria-label="Loading…"></div>';

  const [{ data: exData, error: exErr }, { data: auditData }] = await Promise.all([
    db.getExpenseById(id),
    db.getAuditLog('expense', id),
  ]);

  if (exErr || !exData) {
    main.innerHTML = `<a class="back-link" href="#/admin/all">&#8592; Back</a>
      <p style="color:var(--color-danger)">Expense not found.</p>`;
    return;
  }

  const { expense: ex, user, categoryName } = exData;
  const auditEvents = auditData ?? [];
  const adminId     = currentUser()?.id;

  const canDecide   = ex.status === 'submitted';
  const canSendBack = ex.status === 'approved' || ex.status === 'returned';

  main.innerHTML = `
    <a class="back-link" href="#/admin/all">&#8592; Back to All Submissions</a>
    <div style="display:flex;align-items:center;gap:var(--space-4);margin-bottom:var(--space-6);flex-wrap:wrap">
      <h1 style="margin:0">${esc(user?.name ?? 'Employee')} — Expense</h1>
      <span class="badge badge--${ex.status}" id="status-badge">${statusLabel(ex.status)}</span>
    </div>

    <div style="display:grid;grid-template-columns:1fr 300px;gap:var(--space-6);align-items:start">

      <div class="section-card" style="margin-top:0">
        <h2>Expense Details</h2>
        <dl class="expense-detail-list">
          <div class="expense-detail-list__row">
            <dt>Date</dt>
            <dd>${esc(formatDate(ex.date))}</dd>
          </div>
          <div class="expense-detail-list__row">
            <dt>Category</dt>
            <dd>${esc(categoryName)}</dd>
          </div>
          <div class="expense-detail-list__row">
            <dt>Amount</dt>
            <dd><strong>$${Number(ex.amount).toFixed(2)}</strong></dd>
          </div>
          <div class="expense-detail-list__row">
            <dt>Description</dt>
            <dd>${esc(ex.description)}</dd>
          </div>
          ${ex.receiptRef ? `<div class="expense-detail-list__row">
            <dt>Receipt Ref</dt>
            <dd>${esc(ex.receiptRef)}</dd>
          </div>` : ''}
          <div class="expense-detail-list__row">
            <dt>Submitted</dt>
            <dd>${ex.submittedAt ? formatDateTime(ex.submittedAt) : '—'}</dd>
          </div>
          ${ex.rejectionReason ? `<div class="expense-detail-list__row">
            <dt>Last reason</dt>
            <dd style="color:var(--color-neutral-600);font-style:italic">${esc(ex.rejectionReason)}</dd>
          </div>` : ''}
        </dl>
      </div>

      <aside>
        ${canDecide ? `
        <div class="section-card" style="margin-top:0">
          <h2>Decision</h2>
          <div style="display:flex;flex-direction:column;gap:var(--space-4)">
            <button class="btn btn--success btn--block" id="approve-btn">&#10003; Approve</button>
            <div>
              <label for="reject-reason" style="font-size:var(--font-size-sm);color:var(--color-neutral-600);display:block;margin-bottom:var(--space-1)">Rejection reason <span style="color:var(--color-danger)">*</span></label>
              <textarea id="reject-reason" class="input input--textarea" rows="2"
                placeholder="Required — employee will see this message"></textarea>
              <button class="btn btn--danger btn--block" id="reject-btn" style="margin-top:var(--space-2)">&#10005; Reject</button>
            </div>
          </div>
        </div>` : `<div style="margin-top:0"></div>`}

        ${canSendBack ? `
        <div class="section-card" ${canDecide ? '' : 'style="margin-top:0"'}>
          <h2>Send Back for Revision</h2>
          <p style="font-size:var(--font-size-sm);color:var(--color-neutral-500);margin-bottom:var(--space-3)">
            Returns this expense to the employee for editing and resubmission.
          </p>
          <label for="return-reason" style="font-size:var(--font-size-sm);color:var(--color-neutral-600);display:block;margin-bottom:var(--space-1)">Reason <span style="color:var(--color-danger)">*</span></label>
          <textarea id="return-reason" class="input input--textarea" rows="2"
            placeholder="Required — employee will see this message"></textarea>
          <button class="btn btn--block" id="sendback-btn"
            style="margin-top:var(--space-2);background:#f59e0b;color:white;border-color:#f59e0b">
            &#8626; Send Back
          </button>
        </div>` : ''}

        ${auditTimelineHtml(auditEvents)}
      </aside>
    </div>
  `;

  // ── Approve ──
  if (canDecide) {
    main.querySelector('#approve-btn').addEventListener('click', async () => {
      const btn = main.querySelector('#approve-btn');
      btn.disabled = true; btn.textContent = 'Approving…';
      const { error } = await db.approveExpense(id, adminId);
      if (error) { showToast(error.message, 'error'); btn.disabled = false; btn.textContent = '✓ Approve'; return; }
      showToast('Expense approved.', 'success');
      navigate('#/admin/all');
    });

    main.querySelector('#reject-btn').addEventListener('click', async () => {
      const reason   = main.querySelector('#reject-reason').value.trim();
      const textarea = main.querySelector('#reject-reason');
      if (!reason) {
        textarea.setAttribute('aria-invalid', 'true'); textarea.focus();
        showToast('Please enter a rejection reason.', 'error'); return;
      }
      textarea.removeAttribute('aria-invalid');
      const btn = main.querySelector('#reject-btn');
      btn.disabled = true; btn.textContent = 'Rejecting…';
      const { error } = await db.rejectExpense(id, reason, adminId);
      if (error) { showToast(error.message, 'error'); btn.disabled = false; btn.textContent = '✕ Reject'; return; }
      showToast('Expense rejected.', 'info');
      navigate('#/admin/all');
    });
  }

  // ── Send Back ──
  if (canSendBack) {
    main.querySelector('#sendback-btn').addEventListener('click', async () => {
      const reason   = main.querySelector('#return-reason').value.trim();
      const textarea = main.querySelector('#return-reason');
      if (!reason) {
        textarea.setAttribute('aria-invalid', 'true'); textarea.focus();
        showToast('Please enter a reason before sending back.', 'error'); return;
      }
      textarea.removeAttribute('aria-invalid');
      const btn = main.querySelector('#sendback-btn');
      btn.disabled = true; btn.textContent = 'Sending back…';
      const { error } = await db.returnExpense(id, reason, adminId);
      if (error) { showToast(error.message, 'error'); btn.disabled = false; btn.textContent = '↶ Send Back'; return; }
      showToast('Expense returned to employee for revision.', 'info');
      await loadReview(main, id);
    });
  }
}

function auditTimelineHtml(events) {
  if (!events.length) return '';
  return `
    <div class="section-card">
      <h2>History</h2>
      <ol class="audit-timeline" aria-label="Audit trail">
        ${events.map(e => `
          <li class="audit-timeline__event audit-timeline__event--${esc(e.action)}">
            <span class="audit-timeline__label">${actionLabel(e.action)}</span>
            <span class="audit-timeline__by">by ${esc(e.byName)}</span>
            <span class="audit-timeline__at">${formatDateTime(e.at)}</span>
            ${e.note ? `<span class="audit-timeline__note">${esc(e.note)}</span>` : ''}
          </li>`).join('')}
      </ol>
    </div>`;
}

function actionLabel(a) {
  return { submitted: 'Submitted', approved: 'Approved', rejected: 'Rejected', returned: 'Returned for revision' }[a] ?? a;
}

function formatDate(iso) {
  return new Date(iso + 'T00:00:00').toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
}

function formatDateTime(iso) {
  return new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });
}

function statusLabel(s) {
  return { draft: 'Draft', submitted: 'Submitted', approved: 'Approved', rejected: 'Rejected', returned: 'Returned' }[s] ?? s;
}

function esc(str) {
  return String(str ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
