import { login } from '../auth.js';
import { navigate } from '../app.js';

export async function render(root) {
  root.innerHTML = `
    <div class="login-page">
      <div class="login-card">
        <div class="login-card__logo">
          <h1>Timely</h1>
          <p>Family Timesheet System</p>
        </div>
        <form class="login-form" id="login-form" novalidate>
          <div class="form-group">
            <label for="email">Email address</label>
            <input
              id="email"
              class="input"
              type="email"
              autocomplete="username"
              required
              placeholder="you@example.com"
            >
          </div>
          <div class="form-group">
            <label for="password">Password</label>
            <input
              id="password"
              class="input"
              type="password"
              autocomplete="current-password"
              required
              placeholder="••••••••"
            >
          </div>
          <p class="login-error" id="login-error" role="alert" aria-live="polite"></p>
          <button type="submit" class="btn btn--primary btn--block">Sign In</button>
        </form>
        <p style="margin-top:1.5rem;font-size:0.8rem;color:var(--color-neutral-400);text-align:center">
          Phase 1 demo — use alice@example.com / pass or admin@example.com / pass
        </p>
      </div>
    </div>
  `;

  const form  = root.querySelector('#login-form');
  const errorEl = root.querySelector('#login-error');

  form.addEventListener('submit', e => {
    e.preventDefault();
    errorEl.textContent = '';

    const email    = root.querySelector('#email').value.trim();
    const password = root.querySelector('#password').value;

    if (!email || !password) {
      errorEl.textContent = 'Please enter your email and password.';
      return;
    }

    const user = login(email, password);
    if (!user) {
      errorEl.textContent = 'Invalid email or password.';
      root.querySelector('#password').value = '';
      root.querySelector('#password').focus();
      return;
    }

    navigate(user.role === 'admin' ? '#/admin/approvals' : '#/employee');
  });

  // Auto-focus email field
  root.querySelector('#email').focus();
}
