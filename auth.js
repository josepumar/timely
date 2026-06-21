/**
 * auth.js — Mock authentication for Phase 1.
 * Phase 2 replaces login/logout with Supabase Auth calls;
 * the currentUser() shape stays the same so views don't need to change.
 */

export const MOCK_USERS = [
  {
    id: 'u1',
    email: 'alice@example.com',
    password: 'pass',
    role: 'employee',
    name: 'Alice Smith',
    bankedHours: 2.5,
  },
  {
    id: 'u2',
    email: 'bob@example.com',
    password: 'pass',
    role: 'employee',
    name: 'Bob Jones',
    bankedHours: -1.0,
  },
  {
    id: 'u3',
    email: 'admin@example.com',
    password: 'pass',
    role: 'admin',
    name: 'Carol Admin',
    bankedHours: 0,
  },
];

let _currentUser = null;

/**
 * Attempt to log in. Returns the user object on success, null on failure.
 * Phase 2: replace body with supabase.auth.signInWithPassword(…)
 */
export function login(email, password) {
  const user = MOCK_USERS.find(
    u => u.email.toLowerCase() === email.toLowerCase() && u.password === password
  );
  if (user) {
    _currentUser = user;
    return user;
  }
  return null;
}

/** Clear the current session. Phase 2: also calls supabase.auth.signOut() */
export function logout() {
  _currentUser = null;
}

/** Returns the currently logged-in user, or null if not authenticated. */
export function currentUser() {
  return _currentUser;
}
