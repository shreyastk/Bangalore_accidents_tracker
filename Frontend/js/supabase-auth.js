/**
 * Supabase Auth Client Module
 * Wraps Supabase JS client for all user authentication operations.
 * Replaces localStorage-based auth from db.js.
 *
 * Requirements: 10.1, 10.2, 10.3, 10.4, 10.5
 */

import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';

/**
 * Initialize the Supabase client using BAT_CONFIG credentials.
 * Handles missing/invalid config gracefully (Req 10.4).
 * Completes initialization within 1 second of script loading (Req 10.5).
 */
function initSupabaseClient() {
  const config = window.BAT_CONFIG;

  // Validate config exists and has required properties (Req 10.4)
  if (!config) {
    console.error('[supabase-auth] window.BAT_CONFIG is not defined. Supabase client will not be initialized.');
    return null;
  }

  const { supabaseUrl, supabaseAnonKey } = config;

  if (!supabaseUrl || typeof supabaseUrl !== 'string' || supabaseUrl.trim() === '') {
    console.error('[supabase-auth] Missing or invalid supabaseUrl in BAT_CONFIG. Supabase client set to null.');
    return null;
  }

  if (!supabaseAnonKey || typeof supabaseAnonKey !== 'string' || supabaseAnonKey.trim() === '') {
    console.error('[supabase-auth] Missing or invalid supabaseAnonKey in BAT_CONFIG. Supabase client set to null.');
    return null;
  }

  try {
    // Initialize with persistSession and autoRefreshToken (Req 10.3)
    const client = createClient(supabaseUrl, supabaseAnonKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true
      }
    });
    return client;
  } catch (err) {
    console.error('[supabase-auth] Failed to create Supabase client:', err);
    return null;
  }
}

// Initialize and expose on window (Req 10.2)
const supabase = initSupabaseClient();
window.supabase = supabase;

// Development fallback helpers used when remote Supabase calls fail due to network/DNS.
function devLoadUsers() { try { return JSON.parse(localStorage.getItem('dev_users_v1') || '[]'); } catch { return []; } }
function devSaveUsers(u) { localStorage.setItem('dev_users_v1', JSON.stringify(u)); }
function devCreateSessionFor(user) { const s = { user, access_token: 'devtoken_' + user.id }; localStorage.setItem('dev_session_v1', JSON.stringify(s)); return s; }
function devSignUp(email, password, name) {
  const users = devLoadUsers();
  if (users.find(u => u.email === email)) return { success: false, error: 'User already registered' };
  const id = 'dev_' + Date.now();
  const user = { id, email, user_metadata: { name }, created_at: new Date().toISOString() };
  users.push({ id, email, password, user_metadata: user.user_metadata }); devSaveUsers(users);
  const session = devCreateSessionFor(user);
  return { success: true, user, session };
}
function devSignIn(email, password) {
  const users = devLoadUsers();
  const found = users.find(u => u.email === email && u.password === password);
  if (!found) return { success: false, error: 'Invalid login' };
  const user = { id: found.id, email: found.email, user_metadata: found.user_metadata };
  const session = devCreateSessionFor(user);
  return { success: true, session, user };
}

/**
 * SupabaseAuthClient — public API for authentication operations.
 */
const SupabaseAuthClient = {
  /**
   * Register a new user with email, password, and display name.
   * @param {string} email
   * @param {string} password
   * @param {string} name
   * @returns {Promise<{success: boolean, user?: object, error?: string}>}
   */
  async signUp(email, password, name) {
    if (!supabase) {
      return { success: false, error: 'Supabase client is not initialized.' };
    }

    try {
      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: {
          data: { name }
        }
      });

      if (error) {
        // If request failed due to network/DNS, fall back to local dev auth
        const lower = (error.message || '').toLowerCase();
        if (lower.includes('network') || lower.includes('name') || lower.includes('dns') || lower.includes('fetch') || lower.includes('offline')) {
          return devSignUp(email, password, name);
        }
        return { success: false, error: error.message };
      }

      return { success: true, user: data.user, session: data.session };
    } catch (err) {
      // Try local dev fallback if remote is unreachable
      const msg = (err && err.message) ? err.message.toLowerCase() : '';
      if (msg.includes('network') || msg.includes('dns') || msg.includes('name') || msg.includes('fetch') || msg.includes('offline')) {
        return devSignUp(email, password, name);
      }
      return { success: false, error: 'Authentication service is temporarily unavailable. Please try again.' };
    }
  },

  /**
   * Sign in with email and password.
   * @param {string} email
   * @param {string} password
   * @returns {Promise<{success: boolean, session?: object, error?: string}>}
   */
  async signIn(email, password) {
    if (!supabase) {
      return { success: false, error: 'Supabase client is not initialized.' };
    }

    try {
      const { data, error } = await supabase.auth.signInWithPassword({
        email,
        password
      });

      if (error) {
        const lower = (error.message || '').toLowerCase();
        if (lower.includes('network') || lower.includes('name') || lower.includes('dns') || lower.includes('fetch') || lower.includes('offline')) {
          return devSignIn(email, password);
        }
        return { success: false, error: error.message };
      }

      return { success: true, session: data.session, user: data.user };
    } catch (err) {
      const msg = (err && err.message) ? err.message.toLowerCase() : '';
      if (msg.includes('network') || msg.includes('dns') || msg.includes('name') || msg.includes('fetch') || msg.includes('offline')) {
        return devSignIn(email, password);
      }
      return { success: false, error: 'Authentication service is temporarily unavailable. Please try again.' };
    }
  },

  async resetPassword(email) {
    if (!supabase) return { success: false, error: 'Supabase client is not initialized.' };
    const redirectTo = `${window.location.origin}${window.location.pathname}`;
    const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo });
    return error ? { success: false, error: error.message } : { success: true };
  },

  /**
   * Sign out the current user.
   * @returns {Promise<void>}
   */
  async signOut() {
    // Clear the offline-development session too, otherwise it survives logout.
    try { localStorage.removeItem('dev_session_v1'); } catch (_) {}
    if (!supabase) return;

    try {
      // Local scope reliably clears the browser session even when offline.
      await supabase.auth.signOut({ scope: 'local' });
    } catch (err) {
      console.error('[supabase-auth] Sign out error:', err);
    }
  },

  /**
   * Get the current session (null if not logged in).
   * @returns {Promise<{user: object, access_token: string} | null>}
   */
  async getSession() {
    if (!supabase) {
      return null;
    }

    try {
      const { data: { session }, error } = await supabase.auth.getSession();

      if (error || !session) {
        // If remote Supabase is unavailable, fall back to local dev session.
        try { const s = JSON.parse(localStorage.getItem('dev_session_v1') || 'null'); if (s) return { user: s.user, access_token: s.access_token }; } catch {};
        return null;
      }

      return {
        user: session.user,
        access_token: session.access_token
      };
    } catch (err) {
      console.error('[supabase-auth] getSession error:', err);
      try { const s = JSON.parse(localStorage.getItem('dev_session_v1') || 'null'); if (s) return { user: s.user, access_token: s.access_token }; } catch {}
      return null;
    }
  },

  /**
   * Get user profile metadata.
   * @returns {Promise<{id: string, email: string, user_metadata: {name: string}} | null>}
   */
  async getUser() {
    if (!supabase) {
      return null;
    }

    try {
      const { data: { user }, error } = await supabase.auth.getUser();

      if (error || !user) {
        // If remote Supabase is unavailable or the session is stale, fall back
        // to the local dev session so getSession() and getUser() stay consistent
        // (otherwise protected pages redirect to login while the login page
        // bounces straight back, causing an infinite redirect loop).
        try { const s = JSON.parse(localStorage.getItem('dev_session_v1') || 'null'); if (s) return s.user; } catch {};
        return null;
      }

      return {
        id: user.id,
        email: user.email,
        user_metadata: user.user_metadata
      };
    } catch (err) {
      console.error('[supabase-auth] getUser error:', err);
      try { const s = JSON.parse(localStorage.getItem('dev_session_v1') || 'null'); if (s) return s.user; } catch {}
      return null;
    }
  },

  /**
   * Listen for auth state changes (login/logout/token refresh).
   * @param {function} callback - Called with (event, session)
   * @returns {{unsubscribe: function}}
   */
  onAuthStateChange(callback) {
    if (!supabase) {
      // Return a no-op unsubscribe if client isn't available
      return { unsubscribe: () => {} };
    }

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      callback(event, session);
    });

    return { unsubscribe: () => subscription.unsubscribe() };
  },

  /**
   * Update user profile metadata (e.g., name).
   * @param {object} metadata - Key-value pairs to update in user_metadata
   * @returns {Promise<{success: boolean, error?: string}>}
   */
  async updateProfile(metadata) {
    if (!supabase) {
      return { success: false, error: 'Supabase client is not initialized.' };
    }

    try {
      const { data, error } = await supabase.auth.updateUser({
        data: metadata
      });

      if (error) {
        return { success: false, error: error.message };
      }

      return { success: true, user: data.user };
    } catch (err) {
      return { success: false, error: 'Failed to update profile. Please try again.' };
    }
  }
};

// Expose SupabaseAuthClient globally for other modules
window.SupabaseAuthClient = SupabaseAuthClient;

// If Supabase client failed to initialize (offline/dev), provide a small
// local mock auth implementation to allow development/testing without
// contacting the remote Supabase service.
if (!supabase) {
  (function createLocalMock() {
    const USERS_KEY = 'dev_users_v1';
    const SESSION_KEY = 'dev_session_v1';

    function loadUsers() {
      try { return JSON.parse(localStorage.getItem(USERS_KEY) || '[]'); } catch { return []; }
    }
    function saveUsers(u) { localStorage.setItem(USERS_KEY, JSON.stringify(u)); }

    function loadSession() {
      try { return JSON.parse(localStorage.getItem(SESSION_KEY) || 'null'); } catch { return null; }
    }
    function saveSession(s) { localStorage.setItem(SESSION_KEY, JSON.stringify(s)); }
    function clearSession() { localStorage.removeItem(SESSION_KEY); }

    const subs = [];

    const Mock = {
      async signUp(email, password, name) {
        const users = loadUsers();
        if (users.find(u => u.email === email)) {
          return { success: false, error: 'User already registered' };
        }
        const id = 'dev_' + Date.now();
        const user = { id, email, user_metadata: { name } , created_at: new Date().toISOString() };
        users.push({ id, email, password, user_metadata: user.user_metadata });
        saveUsers(users);
        const session = { user, access_token: 'devtoken_' + id };
        saveSession(session);
        subs.forEach(cb => cb('SIGNED_IN', session));
        return { success: true, user, session };
      },
      async signIn(email, password) {
        const users = loadUsers();
        const found = users.find(u => u.email === email && u.password === password);
        if (!found) return { success: false, error: 'Invalid login' };
        const user = { id: found.id, email: found.email, user_metadata: found.user_metadata };
        const session = { user, access_token: 'devtoken_' + found.id };
        saveSession(session);
        subs.forEach(cb => cb('SIGNED_IN', session));
        return { success: true, session, user };
      },
      async signOut() { clearSession(); subs.forEach(cb => cb('SIGNED_OUT', null)); return; },
      async getSession() { return loadSession(); },
      async getUser() { const s = loadSession(); return s ? s.user : null; },
      onAuthStateChange(cb) { subs.push(cb); return { unsubscribe() { const i = subs.indexOf(cb); if (i >= 0) subs.splice(i,1); } }; },
      async updateUser({ data }) {
        const s = loadSession(); if (!s) return { error: { message: 'No session' } };
        const users = loadUsers();
        const idx = users.findIndex(u => u.email === s.user.email);
        if (idx >= 0) { users[idx].user_metadata = { ...users[idx].user_metadata, ...data }; saveUsers(users); s.user.user_metadata = users[idx].user_metadata; saveSession(s); return { success: true, user: s.user }; }
        return { success: false, error: 'User not found' };
      }
    };

    // Expose as SupabaseAuthClient fallback
    window.SupabaseAuthClient = Mock;
    // Also expose a minimal window.supabase shim used by some legacy code paths
    window.supabase = { auth: { signUp: async (opts) => { return await Mock.signUp(opts.email, opts.password, (opts.options && opts.options.data && opts.options.data.name) || ''); }, signInWithPassword: async ({ email, password }) => { return await Mock.signIn(email, password); }, signOut: async () => Mock.signOut(), getSession: async () => ({ data: { session: await Mock.getSession() } }), getUser: async () => ({ data: { user: await Mock.getUser() } }), refreshSession: async () => ({ error: null }) } };
  })();
}

export { supabase, SupabaseAuthClient };
export default SupabaseAuthClient;
