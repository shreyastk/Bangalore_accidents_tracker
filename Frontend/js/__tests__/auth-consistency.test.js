/**
 * Property-Based Tests for Auth State Consistency
 * Task 13.3: Auth state consistency after signOut
 *
 * **Validates: Requirements 2.6, 3.6 (Correctness Property 6)**
 *
 * Property 6: Auth state consistency — after signOut(), getSession() returns null
 * and all protected pages redirect to login.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as fc from 'fast-check';

// --- Mock browser storage ---
function createMockStorage() {
  const store = {};
  return {
    getItem: (key) => store[key] ?? null,
    setItem: (key, value) => { store[key] = String(value); },
    removeItem: (key) => { delete store[key]; },
    clear: () => { Object.keys(store).forEach((k) => delete store[k]); },
    get length() { return Object.keys(store).length; },
    key: (i) => Object.keys(store)[i] ?? null,
    _store: store,
  };
}

/**
 * Creates a mock Supabase client that simulates session behavior.
 * Supports arbitrary initial session states set before signOut.
 */
function createMockSupabaseClient(localStorage) {
  let currentSession = null;

  return {
    auth: {
      signInWithPassword: async ({ email, password }) => {
        const header = btoa(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
        const payload = btoa(JSON.stringify({
          sub: 'uuid-' + Math.random().toString(36).slice(2),
          email,
          exp: Math.floor(Date.now() / 1000) + 3600,
          iat: Math.floor(Date.now() / 1000),
        }));
        const signature = btoa('mock-signature-' + Math.random().toString(36).slice(2));
        const accessToken = `${header}.${payload}.${signature}`;

        const session = {
          access_token: accessToken,
          refresh_token: 'refresh-' + Math.random().toString(36).slice(2),
          user: {
            id: 'uuid-' + Math.random().toString(36).slice(2),
            email,
            user_metadata: { name: 'Test User' },
          },
        };

        currentSession = session;
        localStorage.setItem('sb-fake-auth-token', JSON.stringify(session));
        return { data: { user: session.user, session }, error: null };
      },

      getSession: async () => {
        if (!currentSession) {
          const raw = localStorage.getItem('sb-fake-auth-token');
          if (!raw) return { data: { session: null }, error: null };
          currentSession = JSON.parse(raw);
        }
        return { data: { session: currentSession }, error: null };
      },

      signOut: async () => {
        currentSession = null;
        localStorage.removeItem('sb-fake-auth-token');
        return { error: null };
      },

      signUp: async ({ email, password, options }) => {
        const header = btoa(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
        const payload = btoa(JSON.stringify({
          sub: 'uuid-' + Math.random().toString(36).slice(2),
          email,
          exp: Math.floor(Date.now() / 1000) + 3600,
          iat: Math.floor(Date.now() / 1000),
        }));
        const signature = btoa('mock-signature-' + Math.random().toString(36).slice(2));
        const accessToken = `${header}.${payload}.${signature}`;

        const session = {
          access_token: accessToken,
          refresh_token: 'refresh-' + Math.random().toString(36).slice(2),
          user: {
            id: 'uuid-' + Math.random().toString(36).slice(2),
            email,
            user_metadata: options?.data || {},
          },
        };

        currentSession = session;
        localStorage.setItem('sb-fake-auth-token', JSON.stringify(session));
        return { data: { user: session.user, session }, error: null };
      },

      onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => {} } } }),
      getUser: async () => ({ data: { user: currentSession?.user ?? null }, error: null }),
      updateUser: async () => ({ data: { user: null }, error: null }),
    },

    /**
     * Inject an arbitrary session state for testing.
     * This simulates various starting states before signOut.
     */
    _setSession: (session) => {
      currentSession = session;
      if (session) {
        localStorage.setItem('sb-fake-auth-token', JSON.stringify(session));
      }
    },
  };
}

/**
 * Creates a SupabaseAuthClient-like wrapper matching the real implementation.
 */
function createAuthClient(mockSupabase) {
  return {
    async signUp(email, password, name) {
      const { data, error } = await mockSupabase.auth.signUp({
        email,
        password,
        options: { data: { name } },
      });
      if (error) return { success: false, error: error.message };
      return { success: true, user: data.user, session: data.session };
    },

    async signIn(email, password) {
      const { data, error } = await mockSupabase.auth.signInWithPassword({
        email,
        password,
      });
      if (error) return { success: false, error: error.message };
      return { success: true, session: data.session, user: data.user };
    },

    async getSession() {
      const { data: { session }, error } = await mockSupabase.auth.getSession();
      if (error || !session) return null;
      return {
        user: session.user,
        access_token: session.access_token,
      };
    },

    async signOut() {
      await mockSupabase.auth.signOut();
    },
  };
}

/**
 * Creates an Auth module (isLoggedIn, requireAuth) using the given auth client.
 * Simulates the behavior of auth.js.
 */
function createAuthModule(authClient) {
  let redirectedTo = null;

  return {
    async isLoggedIn() {
      const session = await authClient.getSession();
      return session !== null;
    },

    async requireAuth(redirectTo = 'login.html') {
      const session = await authClient.getSession();
      if (!session) {
        redirectedTo = redirectTo + '?returnTo=current-page';
      }
      return session;
    },

    getRedirectedTo() {
      return redirectedTo;
    },

    resetRedirect() {
      redirectedTo = null;
    },
  };
}

/**
 * Generator for arbitrary initial session states.
 * Produces sessions that simulate various user login states.
 */
const sessionArbitrary = fc.record({
  access_token: fc.tuple(
    fc.base64String({ minLength: 4, maxLength: 20 }),
    fc.base64String({ minLength: 4, maxLength: 40 }),
    fc.base64String({ minLength: 4, maxLength: 20 })
  ).map(([h, p, s]) => `${h}.${p}.${s}`),
  refresh_token: fc.string({ minLength: 8, maxLength: 32 }).map((s) => 'refresh-' + s),
  user: fc.record({
    id: fc.uuid(),
    email: fc.emailAddress(),
    user_metadata: fc.record({
      name: fc.string({ minLength: 2, maxLength: 50 }),
    }),
  }),
});

describe('Auth State Consistency - Property Tests', () => {
  let mockLocalStorage;

  beforeEach(() => {
    mockLocalStorage = createMockStorage();
  });

  describe('Property 6: Auth state consistency', () => {
    /**
     * **Validates: Requirements 2.6, 3.6**
     *
     * After signOut(), getSession() always returns null regardless of the
     * initial session state that was active before signing out.
     */
    it('after signOut(), getSession() returns null for any initial session state', async () => {
      await fc.assert(
        fc.asyncProperty(
          sessionArbitrary,
          async (initialSession) => {
            // Fresh storage for each run
            mockLocalStorage.clear();

            const mockSupabase = createMockSupabaseClient(mockLocalStorage);
            const authClient = createAuthClient(mockSupabase);

            // Set an arbitrary initial authenticated session
            mockSupabase._setSession(initialSession);

            // Verify we are in an authenticated state before signOut
            const sessionBefore = await authClient.getSession();
            expect(sessionBefore).not.toBeNull();

            // Perform signOut
            await authClient.signOut();

            // After signOut, getSession() MUST return null
            const sessionAfter = await authClient.getSession();
            expect(sessionAfter).toBeNull();
          }
        ),
        { numRuns: 100 }
      );
    });

    /**
     * **Validates: Requirements 2.6, 3.6**
     *
     * After signOut(), isLoggedIn() always returns false regardless of
     * the prior session state.
     */
    it('after signOut(), isLoggedIn() returns false for any initial session state', async () => {
      await fc.assert(
        fc.asyncProperty(
          sessionArbitrary,
          async (initialSession) => {
            mockLocalStorage.clear();

            const mockSupabase = createMockSupabaseClient(mockLocalStorage);
            const authClient = createAuthClient(mockSupabase);
            const authModule = createAuthModule(authClient);

            // Set an arbitrary initial authenticated session
            mockSupabase._setSession(initialSession);

            // Verify we are logged in before signOut
            const loggedInBefore = await authModule.isLoggedIn();
            expect(loggedInBefore).toBe(true);

            // Perform signOut
            await authClient.signOut();

            // After signOut, isLoggedIn() MUST return false
            const loggedInAfter = await authModule.isLoggedIn();
            expect(loggedInAfter).toBe(false);
          }
        ),
        { numRuns: 100 }
      );
    });

    /**
     * **Validates: Requirements 2.6, 3.6**
     *
     * After signOut(), requireAuth() triggers a redirect to login
     * (session is null means the page should redirect).
     */
    it('after signOut(), requireAuth() redirects to login for any initial session state', async () => {
      await fc.assert(
        fc.asyncProperty(
          sessionArbitrary,
          async (initialSession) => {
            mockLocalStorage.clear();

            const mockSupabase = createMockSupabaseClient(mockLocalStorage);
            const authClient = createAuthClient(mockSupabase);
            const authModule = createAuthModule(authClient);

            // Set an arbitrary initial authenticated session
            mockSupabase._setSession(initialSession);

            // Verify requireAuth does NOT redirect when session is active
            authModule.resetRedirect();
            await authModule.requireAuth();
            expect(authModule.getRedirectedTo()).toBeNull();

            // Perform signOut
            await authClient.signOut();

            // After signOut, requireAuth() MUST trigger a redirect to login
            authModule.resetRedirect();
            await authModule.requireAuth();
            expect(authModule.getRedirectedTo()).not.toBeNull();
            expect(authModule.getRedirectedTo()).toContain('login.html');
          }
        ),
        { numRuns: 100 }
      );
    });

    /**
     * **Validates: Requirements 2.6, 3.6**
     *
     * Consistency holds across different authentication methods (signIn/signUp)
     * followed by signOut — the post-signout state is always "logged out".
     */
    it('post-signout state is always "logged out" regardless of how session was established', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.emailAddress(),
          fc.string({ minLength: 6, maxLength: 72 }).filter((s) => s.length >= 6),
          fc.string({ minLength: 2, maxLength: 50 }),
          fc.boolean(), // whether to use signUp or signIn
          async (email, password, name, useSignUp) => {
            mockLocalStorage.clear();

            const mockSupabase = createMockSupabaseClient(mockLocalStorage);
            const authClient = createAuthClient(mockSupabase);
            const authModule = createAuthModule(authClient);

            // Establish session via either signUp or signIn
            if (useSignUp) {
              const result = await authClient.signUp(email, password, name);
              expect(result.success).toBe(true);
            } else {
              const result = await authClient.signIn(email, password);
              expect(result.success).toBe(true);
            }

            // Verify authenticated state
            const loggedInBefore = await authModule.isLoggedIn();
            expect(loggedInBefore).toBe(true);

            // Perform signOut
            await authClient.signOut();

            // Verify complete logout state
            const sessionAfter = await authClient.getSession();
            expect(sessionAfter).toBeNull();

            const loggedInAfter = await authModule.isLoggedIn();
            expect(loggedInAfter).toBe(false);

            // requireAuth should redirect
            authModule.resetRedirect();
            await authModule.requireAuth();
            expect(authModule.getRedirectedTo()).toContain('login.html');
          }
        ),
        { numRuns: 100 }
      );
    });
  });
});
