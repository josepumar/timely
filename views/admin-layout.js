import { logout, currentUser } from '../auth.js';
import { navigate } from '../app.js';

/**
 * Render the admin shell (sidebar + content area) into `root`.
 * Returns the `<main>` element so callers can populate it.
 *
 * @param {HTMLElement} root
 * @param {string} currentHash  e.g. '#/admin/approvals'
 * @param {string} [title]      Page heading text
 * @returns {HTMLElement}       The <main> element
 */
export function renderAdminShell(root, currentHash, title = '') {
  const user = currentUser();

  root.innerHTML = `
    <div class="admin-layout">
      <nav class="admin-sidebar" aria-label="Admin navigation">
        <div class="admin-sidebar__brand">
          Timely
          <span>Admin Panel</span>
        </div>
        <ul class="admin-nav" role="list">
          ${navItem('#/admin/approvals',    'Pending Approvals', currentHash)}
          ${navItem('#/admin/all',          'All Submissions',   currentHash)}
          ${navItem('#/admin/charge-codes', 'Charge Codes',      currentHash)}
          ${navItem('#/admin/users',        'Users',             currentHash)}
        </ul>
        <div class="admin-sidebar__footer">
          <div style="font-size:var(--font-size-xs);color:var(--color-neutral-400);margin-bottom:var(--space-2)">
            Signed in as<br>
            <strong style="color:var(--color-neutral-200)">${esc(user?.name ?? '')}</strong>
          </div>
          <button class="btn btn--ghost btn--sm" id="logout-btn" style="color:var(--color-neutral-400);padding-left:0">
            ← Sign Out
          </button>
        </div>
      </nav>
      <main class="admin-main" id="admin-content">
        ${title ? `<h1>${esc(title)}</h1>` : ''}
      </main>
    </div>
  `;

  root.querySelector('#logout-btn').addEventListener('click', () => {
    logout();
    navigate('#/login');
  });

  return root.querySelector('#admin-content');
}

function navItem(href, label, currentHash) {
  const isActive = currentHash.startsWith(href);
  return `<li>
    <a href="${href}"${isActive ? ' aria-current="page"' : ''}>${esc(label)}</a>
  </li>`;
}

function esc(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
