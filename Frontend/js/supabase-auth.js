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
        return { success: false, error: error.message };
      }

      return { success: true, user: data.user, session: data.session };
    } catch (err) {
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
        return { success: false, error: error.message };
      }

      return { success: true, session: data.session, user: data.user };
    } catch (err) {
      return { success: false, error: 'Authentication service is temporarily unavailable. Please try again.' };
    }
  },

  /**
   * Sign out the current user.
   * @returns {Promise<void>}
   */
  async signOut() {
    if (!supabase) {
      return;
    }

    try {
      await supabase.auth.signOut();
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
        return null;
      }

      return {
        user: session.user,
        access_token: session.access_token
      };
    } catch (err) {
      console.error('[supabase-auth] getSession error:', err);
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
        return null;
      }

      return {
        id: user.id,
        email: user.email,
        user_metadata: user.user_metadata
      };
    } catch (err) {
      console.error('[supabase-auth] getUser error:', err);
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

export { supabase, SupabaseAuthClient };
export default SupabaseAuthClient;
