import { renderAdminShell } from './admin-layout.js';
import * as db from '../db.js';
import { showToast } from '../app.js';

let _chargeCodes = [];
let _editingId   = null;
let _main;

export async function render(root) {
  _main = renderAdminShell(root, '#/admin/charge-codes', 'Charge Codes');
  _editingId = null;

  const { data, error } = await db.getChargeCodes();
  if (error) {
    _main.insertAdjacentHTML('beforeend', `<p style="color:var(--color-danger)">Failed to load: ${esc(error.message)}</p>`);
    return;
  }
  _chargeCodes = data ?? [];

  _main.insertAdjacentHTML('beforeend', `
    <div class="table-wrapper" id="cc-table-wrapper">
      <table class="data-table" aria-label="Charge codes">
        <thead>
          <tr>
            <th scope="col">Code</th>
            <th scope="col">Description</th>
            <th scope="col">Status</th>
            <th scope="col"><span class="sr-only">Actions</span></th>
          </tr>
        </thead>
        <tbody id="cc-tbody"></tbody>
      </table>
    </div>

    <div class="section-card" style="margin-top:var(--space-6)">
      <h2>Add Charge Code</h2>
      <form id="add-cc-form">
        <div class="add-form">
          <div class="form-group">
            <label for="new-code">Code</label>
            <input id="new-code" class="input" type="text" required maxlength="20" placeholder="e.g. PROJ-C">
          </div>
          <div class="form-group" style="flex:2">
            <label for="new-desc">Description</label>
            <input id="new-desc" class="input" type="text" required placeholder="e.g. Project Gamma">
          </div>
          <div style="align-self:flex-end;padding-bottom:1px">
            <button type="submit" class="btn btn--primary">Add</button>
          </div>
        </div>
      </form>
    </div>
  `);

  renderTable();
  attachEvents();
}

function renderTable() {
  const tbody = _main.querySelector('#cc-tbody');
  if (!tbody) return;

  if (_chargeCodes.length === 0) {
    tbody.innerHTML = `<tr><td colspan="4" style="text-align:center;color:var(--color-neutral-400);font-style:italic;padding:var(--space-6)">No charge codes yet.</td></tr>`;
    return;
  }

  tbody.innerHTML = _chargeCodes.map(cc => {
    if (_editingId === cc.id) return editRow(cc);
    return viewRow(cc);
  }).join('');
}

function viewRow(cc) {
  return `
    <tr data-cc-id="${esc(cc.id)}">
      <td data-label="Code"><strong>${esc(cc.code)}</strong></td>
      <td data-label="Description">${esc(cc.description)}</td>
      <td data-label="Status"><span class="badge badge--${cc.active ? 'active' : 'inactive'}">${cc.active ? 'Active' : 'Inactive'}</span></td>
      <td data-label=" ">
        <div class="data-table__actions">
          <button class="btn btn--secondary btn--sm edit-btn" data-id="${esc(cc.id)}">Edit</button>
          <button class="btn btn--sm ${cc.active ? 'btn--danger' : 'btn--ghost'} toggle-btn" data-id="${esc(cc.id)}" data-active="${cc.active}">
            ${cc.active ? 'Deactivate' : 'Reactivate'}
          </button>
        </div>
      </td>
    </tr>
  `;
}

function editRow(cc) {
  return `
    <tr data-cc-id="${esc(cc.id)}" class="editing-row">
      <td data-label="Code">
        <input id="edit-code" class="input input--sm" type="text" value="${esc(cc.code)}" maxlength="20" style="width:8ch">
      </td>
      <td data-label="Description">
        <input id="edit-desc" class="input" type="text" value="${esc(cc.description)}" style="width:100%">
      </td>
      <td data-label="Status"><span class="badge badge--${cc.active ? 'active' : 'inactive'}">${cc.active ? 'Active' : 'Inactive'}</span></td>
      <td data-label=" ">
        <div class="data-table__actions">
          <button class="btn btn--primary btn--sm save-edit-btn" data-id="${esc(cc.id)}">Save</button>
          <button class="btn btn--secondary btn--sm cancel-edit-btn">Cancel</button>
        </div>
      </td>
    </tr>
  `;
}

function attachEvents() {
  // Table delegation
  const wrapper = _main.querySelector('#cc-table-wrapper');
  wrapper.addEventListener('click', async e => {
    const editBtn   = e.target.closest('.edit-btn');
    const saveBtn   = e.target.closest('.save-edit-btn');
    const cancelBtn = e.target.closest('.cancel-edit-btn');
    const toggleBtn = e.target.closest('.toggle-btn');

    if (editBtn) {
      _editingId = editBtn.dataset.id;
      renderTable();
      _main.querySelector('#edit-code')?.focus();
      return;
    }

    if (cancelBtn) {
      _editingId = null;
      renderTable();
      return;
    }

    if (saveBtn) {
      const id   = saveBtn.dataset.id;
      const code = _main.querySelector('#edit-code')?.value.trim();
      const desc = _main.querySelector('#edit-desc')?.value.trim();
      if (!code || !desc) { showToast('Code and description are required.', 'error'); return; }

      const { data, error } = await db.updateChargeCode(id, { code, description: desc });
      if (error) { showToast('Update failed: ' + error.message, 'error'); return; }

      const idx = _chargeCodes.findIndex(c => c.id === id);
      if (idx !== -1) _chargeCodes[idx] = data;
      _editingId = null;
      renderTable();
      showToast('Charge code updated.', 'success');
      return;
    }

    if (toggleBtn) {
      const id     = toggleBtn.dataset.id;
      const active = toggleBtn.dataset.active === 'true';
      const fn     = active ? db.deactivateChargeCode : db.reactivateChargeCode;
      const { data, error } = await fn(id);
      if (error) { showToast('Update failed: ' + error.message, 'error'); return; }

      const idx = _chargeCodes.findIndex(c => c.id === id);
      if (idx !== -1) _chargeCodes[idx] = data;
      renderTable();
      showToast(`Charge code ${active ? 'deactivated' : 'reactivated'}.`, 'info');
    }
  });

  // Add form
  _main.querySelector('#add-cc-form').addEventListener('submit', async e => {
    e.preventDefault();
    const code = _main.querySelector('#new-code').value.trim();
    const desc = _main.querySelector('#new-desc').value.trim();

    if (!code || !desc) { showToast('Code and description are required.', 'error'); return; }

    const submitBtn = _main.querySelector('#add-cc-form button[type="submit"]');
    submitBtn.disabled = true; submitBtn.textContent = 'Adding…';

    const { data, error } = await db.createChargeCode({ code, description: desc });
    submitBtn.disabled = false; submitBtn.textContent = 'Add';

    if (error) { showToast('Failed: ' + error.message, 'error'); return; }

    _chargeCodes.push(data);
    _main.querySelector('#new-code').value = '';
    _main.querySelector('#new-desc').value = '';
    renderTable();
    showToast('Charge code added.', 'success');
    _main.querySelector('#new-code').focus();
  });
}

function esc(str) {
  return String(str ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
