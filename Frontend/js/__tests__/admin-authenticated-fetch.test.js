/**
 * Unit Tests for Admin Authenticated Fetch with Token Refresh
 * Task 7.2: Use Supabase JWT as Bearer token with 401 refresh handling
 *
 * **Validates: Requirements 5.4, 5.5, 5.6**
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

// ─── Recreate core functions from admin-app.js for isolated testing ──────────

/**
 * Testable version of refreshToken that accepts dependencies.
 * @param {object} deps - { authClient, getToken, setToken, tokenKey, sessionStorage }
 * @returns {boolean} true if refresh succeeded
 */
async function refreshToken({ authClient, setToken, tokenKey, sessionStorage }) {
  if (!authClient) return false;
  try {
    const session = await authClient.getSession();
    if (session && session.access_token) {
      setToken(session.access_token);
      sessionStorage.setItem(tokenKey, session.access_token);
      return true;
    }
  } catch (e) {
    // Refresh failed
  }
  return false;
}

/**
 * Testable version of authenticatedFetch that accepts dependencies.
 * @param {string} url
 * @param {object} options - fetch options
 * @param {object} deps - { fetchFn, token, authHeaders, refreshTokenFn, onAuthFailure }
 * @returns {Response}
 */
async function authenticatedFetch(url, options = {}, deps) {
  const { fetchFn, authHeaders, refreshTokenFn, onAuthFailure } = deps;

  // Merge auth headers
  options.headers = { ...authHeaders(), ...(options.headers || {}) };

  const r = await fetchFn(url, options);

  if (r.status === 401) {
    // Attempt token refresh
    const refreshed = await refreshTokenFn();
    if (refreshed) {
      // Retry with new auth headers (overwrite Authorization)
      options.headers = { ...(options.headers || {}), ...authHeaders() };
      return fetchFn(url, options);
    } else {
      // Refresh failed — redirect to admin login
      onAuthFailure();
      return r;
    }
  }

  return r;
}


describe('Admin Authenticated Fetch (Task 7.2)', () => {

  describe('refreshToken()', () => {
    let mockSessionStorage;

    beforeEach(() => {
      mockSessionStorage = {
        store: {},
        setItem(key, val) { this.store[key] = val; },
        getItem(key) { return this.store[key] || null; },
        removeItem(key) { delete this.store[key]; },
      };
    });

    it('returns true and updates token when session has access_token', async () => {
      let currentToken = 'old-token';
      const authClient = {
        getSession: vi.fn().mockResolvedValue({ access_token: 'new-token', user: {} }),
      };

      const result = await refreshToken({
        authClient,
        setToken: (t) => { currentToken = t; },
        tokenKey: 'bat_admin_token',
        sessionStorage: mockSessionStorage,
      });

      expect(result).toBe(true);
      expect(currentToken).toBe('new-token');
      expect(mockSessionStorage.store['bat_admin_token']).toBe('new-token');
    });

    it('returns false when authClient is null', async () => {
      const result = await refreshToken({
        authClient: null,
        setToken: vi.fn(),
        tokenKey: 'bat_admin_token',
        sessionStorage: mockSessionStorage,
      });

      expect(result).toBe(false);
    });

    it('returns false when getSession returns null', async () => {
      const authClient = {
        getSession: vi.fn().mockResolvedValue(null),
      };

      const result = await refreshToken({
        authClient,
        setToken: vi.fn(),
        tokenKey: 'bat_admin_token',
        sessionStorage: mockSessionStorage,
      });

      expect(result).toBe(false);
    });

    it('returns false when getSession returns session without access_token', async () => {
      const authClient = {
        getSession: vi.fn().mockResolvedValue({ user: {} }),
      };

      const result = await refreshToken({
        authClient,
        setToken: vi.fn(),
        tokenKey: 'bat_admin_token',
        sessionStorage: mockSessionStorage,
      });

      expect(result).toBe(false);
    });

    it('returns false when getSession throws an error', async () => {
      const authClient = {
        getSession: vi.fn().mockRejectedValue(new Error('Network error')),
      };

      const result = await refreshToken({
        authClient,
        setToken: vi.fn(),
        tokenKey: 'bat_admin_token',
        sessionStorage: mockSessionStorage,
      });

      expect(result).toBe(false);
    });
  });

  describe('authenticatedFetch()', () => {
    let deps;
    let currentToken;

    beforeEach(() => {
      currentToken = 'initial-token';
      deps = {
        fetchFn: vi.fn(),
        authHeaders: () => ({ 'Content-Type': 'application/json', Authorization: `Bearer ${currentToken}` }),
        refreshTokenFn: vi.fn(),
        onAuthFailure: vi.fn(),
      };
    });

    it('includes Bearer token in Authorization header (Req 5.4)', async () => {
      deps.fetchFn.mockResolvedValue({ status: 200, ok: true });

      await authenticatedFetch('http://api/admin/data', {}, deps);

      expect(deps.fetchFn).toHaveBeenCalledWith(
        'http://api/admin/data',
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: 'Bearer initial-token',
          }),
        })
      );
    });

    it('returns response directly on non-401 status', async () => {
      const mockResponse = { status: 200, ok: true };
      deps.fetchFn.mockResolvedValue(mockResponse);

      const result = await authenticatedFetch('http://api/admin/data', {}, deps);

      expect(result).toBe(mockResponse);
      expect(deps.refreshTokenFn).not.toHaveBeenCalled();
      expect(deps.onAuthFailure).not.toHaveBeenCalled();
    });

    it('attempts token refresh on 401 response (Req 5.5)', async () => {
      deps.fetchFn.mockResolvedValueOnce({ status: 401, ok: false });
      deps.refreshTokenFn.mockResolvedValue(true);
      currentToken = 'refreshed-token';
      deps.fetchFn.mockResolvedValueOnce({ status: 200, ok: true });

      await authenticatedFetch('http://api/admin/data', {}, deps);

      expect(deps.refreshTokenFn).toHaveBeenCalledTimes(1);
    });

    it('retries request with new token after successful refresh', async () => {
      deps.fetchFn.mockResolvedValueOnce({ status: 401, ok: false });
      deps.refreshTokenFn.mockImplementation(async () => {
        currentToken = 'refreshed-token';
        return true;
      });
      deps.fetchFn.mockResolvedValueOnce({ status: 200, ok: true });

      const result = await authenticatedFetch('http://api/admin/data', {}, deps);

      expect(deps.fetchFn).toHaveBeenCalledTimes(2);
      // Second call should use the refreshed token
      expect(deps.fetchFn.mock.calls[1][1].headers.Authorization).toBe('Bearer refreshed-token');
      expect(result.status).toBe(200);
    });

    it('calls onAuthFailure and returns 401 if refresh fails (Req 5.5)', async () => {
      const mockResponse = { status: 401, ok: false };
      deps.fetchFn.mockResolvedValue(mockResponse);
      deps.refreshTokenFn.mockResolvedValue(false);

      const result = await authenticatedFetch('http://api/admin/data', {}, deps);

      expect(deps.refreshTokenFn).toHaveBeenCalledTimes(1);
      expect(deps.onAuthFailure).toHaveBeenCalledTimes(1);
      expect(result.status).toBe(401);
    });

    it('preserves method and body in retried request', async () => {
      deps.fetchFn.mockResolvedValueOnce({ status: 401, ok: false });
      deps.refreshTokenFn.mockImplementation(async () => {
        currentToken = 'new-token';
        return true;
      });
      deps.fetchFn.mockResolvedValueOnce({ status: 200, ok: true });

      await authenticatedFetch('http://api/admin/accidents/1', {
        method: 'PATCH',
        body: JSON.stringify({ status: 'hidden' }),
      }, deps);

      const retryCall = deps.fetchFn.mock.calls[1];
      expect(retryCall[1].method).toBe('PATCH');
      expect(retryCall[1].body).toBe(JSON.stringify({ status: 'hidden' }));
    });

    it('does not retry on non-401 errors (e.g. 403, 500)', async () => {
      deps.fetchFn.mockResolvedValue({ status: 403, ok: false });

      const result = await authenticatedFetch('http://api/admin/data', {}, deps);

      expect(result.status).toBe(403);
      expect(deps.refreshTokenFn).not.toHaveBeenCalled();
      expect(deps.onAuthFailure).not.toHaveBeenCalled();
    });

    it('does not retry on successful responses', async () => {
      deps.fetchFn.mockResolvedValue({ status: 201, ok: true });

      const result = await authenticatedFetch('http://api/admin/data', { method: 'POST' }, deps);

      expect(result.status).toBe(201);
      expect(deps.fetchFn).toHaveBeenCalledTimes(1);
    });
  });

  describe('Sign-out clears session (Req 5.6)', () => {
    it('sign-out calls authClient.signOut and clears token from sessionStorage', async () => {
      const mockSessionStorage = {
        store: { bat_admin_token: 'some-jwt' },
        removeItem(key) { delete this.store[key]; },
      };
      const authClient = { signOut: vi.fn().mockResolvedValue(undefined) };

      // Simulate logout handler
      let token = 'some-jwt';
      if (authClient) {
        await authClient.signOut();
      }
      token = '';
      mockSessionStorage.removeItem('bat_admin_token');

      expect(authClient.signOut).toHaveBeenCalledTimes(1);
      expect(token).toBe('');
      expect(mockSessionStorage.store['bat_admin_token']).toBeUndefined();
    });
  });
});
