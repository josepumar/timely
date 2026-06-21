import { renderAdminShell } from './admin-layout.js';
import * as db from '../db.js';

export async function render(root) {
  const main = renderAdminShell(root, '#/admin/users', 'Users & Roles');

  const { data: users, error } = await db.getUsers();
  if (error) {
    main.insertAdjacentHTML('beforeend', `<p style="color:var(--color-danger)">Failed to load users.</p>`);
    return;
  }

  const rows = (users ?? []).map(u => `
    <tr>
      <td data-label="Name"><strong>${esc(u.name)}</strong></td>
      <td data-label="Email">${esc(u.email)}</td>
      <td data-label="Role">
        <span class="badge badge--${u.role === 'admin' ? 'submitted' : 'draft'}">
          ${u.role === 'admin' ? 'Admin' : 'Employee'}
        </span>
      </td>
      <td data-label="Banked Hours" style="text-align:right">
        ${fmtBanked(u.bankedHours)}
      </td>
    </tr>
  `).join('');

  main.insertAdjacentHTML('beforeend', `
    <p style="color:var(--color-neutral-500);font-size:var(--font-size-sm);margin-bottom:var(--space-4)">
      To change a user's role, edit the <code>profiles</code> table in the Supabase dashboard (Phase 2).
    </p>
    <div class="table-wrapper">
      <table class="data-table" aria-label="Users and roles">
        <thead>
          <tr>
            <th scope="col">Name</th>
            <th scope="col">Email</th>
            <th scope="col">Role</th>
            <th scope="col" style="text-align:right">Banked Hours</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
  `);
}

function fmtBanked(n) {
  if (n == null) return '—';
  const sign = n > 0 ? '+' : '';
  return `${sign}${Number(n).toFixed(1)} h`;
}

function esc(str) {
  return String(str ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
