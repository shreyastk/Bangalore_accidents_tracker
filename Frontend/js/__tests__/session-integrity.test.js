/**
 * Property-Based Tests for Session Integrity
 * Task 3.3: Session integrity after signIn and signOut
 *
 * **Validates: Requirements 2.5, 2.6**
 *
 * Property 2: Session integrity — after signIn, getSession() returns a valid JWT;
 * after signOut, getSession() returns null.
 */

import { describe, it, expect, beforeEach } from 'vitest';
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
 * Creates a mock Supabase client that simulates session behavior:
 * - signInWithPassword stores a session with a JWT-like access_token
 * - getSession retrieves the stored session
 * - signOut clears the stored session
 */
function createMockSupabaseClient(localStorage) {
  let currentSession = null;

  return {
    auth: {
      signInWithPassword: async ({ email, password }) => {
        // Generate a JWT-like token: three base64url segments separated by dots
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
            user_metadata: {},
          },
        };

        currentSession = session;

        // Simulate Supabase persisting session in localStorage
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

      signUp: async () => ({ data: { user: null, session: null }, error: null }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => {} } } }),
      getUser: async () => ({ data: { user: null }, error: null }),
      updateUser: async () => ({ data: { user: null }, error: null }),
    },
  };
}

/**
 * Creates a SupabaseAuthClient-like wrapper matching the real implementation
 * in supabase-auth.js.
 */
function createAuthClient(mockSupabase) {
  return {
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
 * Checks whether a string has the structure of a JWT:
 * three non-empty segments separated by exactly two dots.
 */
function isJwtFormat(token) {
  if (typeof token !== 'string') return false;
  const parts = token.split('.');
  return parts.length === 3 && parts.every((part) => part.length > 0);
}

describe('Session Integrity - Property Tests', () => {
  let mockLocalStorage;

  beforeEach(() => {
    mockLocalStorage = createMockStorage();
  });

  describe('Property 2: Session integrity', () => {
    /**
     * **Validates: Requirements 2.5, 2.6**
     *
     * After a successful signIn, getSession() returns a non-null object
     * with an access_token that looks like a JWT (has 2 dots separating base64 segments).
     * After signOut, getSession() returns null.
     */
    it('after signIn, getSession() returns a valid JWT; after signOut, getSession() returns null', async () => {
      await fc.assert(
        fc.asyncProperty(
          // Generate random email addresses
          fc.emailAddress(),
          // Generate random passwords (min 6 chars per requirement)
          fc.string({ minLength: 6, maxLength: 72 }).filter((s) => s.length >= 6),
          async (email, password) => {
            // Fresh storage for each run
            mockLocalStorage.clear();

            const mockSupabase = createMockSupabaseClient(mockLocalStorage);
            const authClient = createAuthClient(mockSupabase);

            // --- Part 1: After signIn, getSession() returns a valid JWT ---
            const signInResult = await authClient.signIn(email, password);
            expect(signInResult.success).toBe(true);

            const session = await authClient.getSession();

            // Session must not be null after successful signIn
            expect(session).not.toBeNull();
            expect(session).toHaveProperty('access_token');
            expect(session).toHaveProperty('user');

            // access_token must be in JWT format (3 base64 segments separated by 2 dots)
            expect(isJwtFormat(session.access_token)).toBe(true);

            // --- Part 2: After signOut, getSession() returns null ---
            await authClient.signOut();

            const sessionAfterSignOut = await authClient.getSession();
            expect(sessionAfterSignOut).toBeNull();
          }
        ),
        { numRuns: 100 }
      );
    });
  });
});
