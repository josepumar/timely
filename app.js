/**
 * app.js — Hash-based router, navigation helpers, and toast system.
 */

import { currentUser, logout } from './auth.js';

// ─── Lazy view imports ────────────────────────────────────────────────────────
// Each view module is imported only once (ES module cache handles dedup).
const views = {
  login:           () => import('./views/login.js'),
  employee:        () => import('./views/employee.js'),
  adminApprovals:  () => import('./views/admin-approvals.js'),
  adminReview:     () => import('./views/admin-review.js'),
  adminChargeCodes:() => import('./views/admin-charge-codes.js'),
  adminUsers:      () => import('./views/admin-users.js'),
};

// ─── Route Table ─────────────────────────────────────────────────────────────
const routes = [
  { pattern: '#/login',                   role: null,                  view: views.login },
  { pattern: '#/employee',                role: ['employee', 'admin'], view: views.employee },
  { pattern: '#/admin/approvals',         role: ['admin'],             view: views.adminApprovals },
  { pattern: '#/admin/review/:id',        role: ['admin'],             view: views.adminReview },
  { pattern: '#/admin/charge-codes',      role: ['admin'],             view: views.adminChargeCodes },
  { pattern: '#/admin/users',             role: ['admin'],             view: views.adminUsers },
];

// ─── Pattern Matching ─────────────────────────────────────────────────────────
function matchRoute(hash, pattern) {
  const hashSegs    = (hash    || '#/').replace(/^#\//, '').split('/');
  const patternSegs = (pattern || '#/').replace(/^#\//, '').split('/');
  if (hashSegs.length !== patternSegs.length) return null;
  const params = {};
  for (let i = 0; i < patternSegs.length; i++) {
    if (patternSegs[i].startsWith(':')) {
      params[patternSegs[i].slice(1)] = decodeURIComponent(hashSegs[i]);
    } else if (patternSegs[i] !== hashSegs[i]) {
      return null;
    }
  }
  return params;
}

// ─── Navigation ──────────────────────────────────────────────────────────────
export function navigate(hash) {
  window.location.hash = hash;
}

// ─── Toast ────────────────────────────────────────────────────────────────────
export function showToast(message, type = 'info') {
  const container = document.getElementById('toast-container');
  if (!container) return;
  const toast = document.createElement('div');
  toast.className = `toast toast--${type}`;
  toast.textContent = message;
  toast.setAttribute('role', 'status');
  container.appendChild(toast);
  setTimeout(() => {
    toast.classList.add('toast--leaving');
    toast.addEventListener('animationend', () => toast.remove(), { once: true });
  }, 3000);
}

// ─── Dispatch ─────────────────────────────────────────────────────────────────
async function dispatch(hash) {
  // Normalize: treat bare # or empty as login
  if (!hash || hash === '#' || hash === '#/') hash = '#/login';

  let matchedRoute = null;
  let params = {};

  for (const route of routes) {
    const p = matchRoute(hash, route.pattern);
    if (p !== null) {
      matchedRoute = route;
      params = p;
      break;
    }
  }

  if (!matchedRoute) {
    navigate('#/login');
    return;
  }

  // Auth guard
  const user = currentUser();
  if (matchedRoute.role !== null) {
    if (!user) { navigate('#/login'); return; }
    if (!matchedRoute.role.includes(user.role)) {
      // Wrong role: send to their home
      navigate(user.role === 'admin' ? '#/admin/approvals' : '#/employee');
      return;
    }
  }

  const root = document.getElementById('app-root');
  root.innerHTML = '<div class="loading-spinner" aria-label="Loading…"></div>';

  try {
    const mod = await matchedRoute.view();
    await mod.render(root, params);
  } catch (e) {
    console.error('View render error:', e);
    root.innerHTML = `<div style="padding:2rem;color:#DC2626">
      <h2>Something went wrong</h2><pre>${e.message}</pre></div>`;
  }
}

// ─── Bootstrap ────────────────────────────────────────────────────────────────
window.addEventListener('hashchange', e => {
  const hash = new URL(e.newURL).hash || '#/login';
  dispatch(hash);
});

document.addEventListener('DOMContentLoaded', () => {
  dispatch(window.location.hash || '#/login');
});
