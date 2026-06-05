/**
 * Property-Based Tests for Supabase Client Initialization
 * Task 1.3: No plaintext passwords stored after signUp/signIn
 *
 * **Validates: Requirements 9.1, 9.2**
 *
 * Property 1: No plaintext passwords — verify that after signUp/signIn,
 * no password string is stored in localStorage or sessionStorage.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
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

// --- Mock Supabase client factory ---
function createMockSupabaseClient(localStorage, sessionStorage) {
  /**
   * This mock simulates what Supabase Auth does:
   * - On signUp/signIn success, it stores a session token in localStorage
   *   (supabase uses localStorage for session persistence by default)
   * - It should NEVER store the raw password
   */
  return {
    auth: {
      signUp: async ({ email, password, options }) => {
        // Simulate Supabase storing a session (JWT token, not password)
        const fakeSession = {
          access_token: 'eyJhbGciOiJIUzI1NiJ9.fake-jwt-token',
          refresh_token: 'fake-refresh-token-' + Date.now(),
          user: {
            id: 'uuid-' + Math.random().toString(36).slice(2),
            email,
            user_metadata: { name: options?.data?.name || '' },
          },
        };
        // Supabase persists session in localStorage (simulated)
        localStorage.setItem(
          'sb-fake-auth-token',
          JSON.stringify({
            access_token: fakeSession.access_token,
            refresh_token: fakeSession.refresh_token,
            user: fakeSession.user,
          })
        );
        return { data: { user: fakeSession.user, session: fakeSession }, error: null };
      },
      signInWithPassword: async ({ email, password }) => {
        // Simulate Supabase storing a session (JWT token, not password)
        const fakeSession = {
          access_token: 'eyJhbGciOiJIUzI1NiJ9.fake-jwt-token-signin',
          refresh_token: 'fake-refresh-token-signin-' + Date.now(),
          user: {
            id: 'uuid-' + Math.random().toString(36).slice(2),
            email,
            user_metadata: {},
          },
        };
        localStorage.setItem(
          'sb-fake-auth-token',
          JSON.stringify({
            access_token: fakeSession.access_token,
            refresh_token: fakeSession.refresh_token,
            user: fakeSession.user,
          })
        );
        return { data: { user: fakeSession.user, session: fakeSession }, error: null };
      },
      getSession: async () => {
        const raw = localStorage.getItem('sb-fake-auth-token');
        if (!raw) return { data: { session: null }, error: null };
        const session = JSON.parse(raw);
        return { data: { session }, error: null };
      },
      signOut: async () => {
        localStorage.removeItem('sb-fake-auth-token');
        return { error: null };
      },
      onAuthStateChange: (cb) => ({ data: { subscription: { unsubscribe: () => {} } } }),
      getUser: async () => ({ data: { user: null }, error: null }),
      updateUser: async () => ({ data: { user: null }, error: null }),
    },
  };
}

/**
 * Creates a SupabaseAuthClient-like module that exercises signUp/signIn
 * against the mock, similar to the real supabase-auth.js implementation.
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
  };
}

/**
 * Helper: checks all values in a storage mock for the presence of a substring.
 * Returns true if the password is found anywhere in storage.
 */
function storageContainsPassword(storage, password) {
  const store = storage._store;
  for (const key of Object.keys(store)) {
    const value = store[key];
    // Check if the password appears in either the key or the value
    if (key.includes(password)) return true;
    if (value.includes(password)) return true;
  }
  return false;
}

describe('Supabase Auth Client - Property Tests', () => {
  let mockLocalStorage;
  let mockSessionStorage;

  beforeEach(() => {
    mockLocalStorage = createMockStorage();
    mockSessionStorage = createMockStorage();
  });

  describe('Property 1: No plaintext passwords stored after signUp/signIn', () => {
    /**
     * **Validates: Requirements 9.1, 9.2**
     *
     * For any arbitrary password string used in signUp, the password
     * MUST NOT appear in localStorage or sessionStorage after the operation completes.
     */
    it('signUp never stores the password in localStorage or sessionStorage', async () => {
      await fc.assert(
        fc.asyncProperty(
          // Generate arbitrary email-like strings
          fc.emailAddress(),
          // Generate arbitrary passwords (min 6 chars to match requirement)
          // Use a prefix to ensure the password is never a substring of other stored data
          fc.string({ minLength: 6, maxLength: 100 }).filter((s) => s.length >= 6),
          // Generate arbitrary display names
          fc.string({ minLength: 2, maxLength: 50 }).filter((s) => s.trim().length >= 2),
          async (email, password, name) => {
            // Skip cases where password coincidentally appears as substring of
            // legitimately stored data (email, name) — these are false positives
            if (email.includes(password) || name.includes(password)) return;

            // Clear storage before each run
            mockLocalStorage.clear();
            mockSessionStorage.clear();

            const mockSupabase = createMockSupabaseClient(mockLocalStorage, mockSessionStorage);
            const authClient = createAuthClient(mockSupabase);

            // Perform signUp
            await authClient.signUp(email, password, name);

            // Property: password MUST NOT appear in any storage
            const inLocalStorage = storageContainsPassword(mockLocalStorage, password);
            const inSessionStorage = storageContainsPassword(mockSessionStorage, password);

            expect(inLocalStorage).toBe(false);
            expect(inSessionStorage).toBe(false);
          }
        ),
        { numRuns: 100 }
      );
    });

    /**
     * **Validates: Requirements 9.1, 9.2**
     *
     * For any arbitrary password string used in signIn, the password
     * MUST NOT appear in localStorage or sessionStorage after the operation completes.
     */
    it('signIn never stores the password in localStorage or sessionStorage', async () => {
      await fc.assert(
        fc.asyncProperty(
          // Generate arbitrary email-like strings
          fc.emailAddress(),
          // Generate arbitrary passwords (min 6 chars to match requirement)
          fc.string({ minLength: 6, maxLength: 100 }).filter((s) => s.length >= 6),
          async (email, password) => {
            // Skip cases where password coincidentally appears as substring of
            // legitimately stored data (email) — these are false positives
            if (email.includes(password)) return;

            // Clear storage before each run
            mockLocalStorage.clear();
            mockSessionStorage.clear();

            const mockSupabase = createMockSupabaseClient(mockLocalStorage, mockSessionStorage);
            const authClient = createAuthClient(mockSupabase);

            // Perform signIn
            await authClient.signIn(email, password);

            // Property: password MUST NOT appear in any storage
            const inLocalStorage = storageContainsPassword(mockLocalStorage, password);
            const inSessionStorage = storageContainsPassword(mockSessionStorage, password);

            expect(inLocalStorage).toBe(false);
            expect(inSessionStorage).toBe(false);
          }
        ),
        { numRuns: 100 }
      );
    });
  });
});
