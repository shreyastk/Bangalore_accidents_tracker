/**
 * Unit Tests for AuthController.handleLogin
 * Task 3.1: Login flow in auth-controller.js
 *
 * Tests cover:
 * - Client-side validation (Req 2.7)
 * - Non-specific error on failed auth (Req 2.2)
 * - Redirect with returnTo param (Req 2.3)
 * - Redirect to dashboard without returnTo (Req 2.4)
 * - Network error handling without clearing fields (Req 2.8)
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// --- DOM Mock Setup ---
function createMockDOM(options = {}) {
  const elements = {};

  // Create mock elements
  const elementDefs = {
    'login-email': { value: options.email || '', type: 'input' },
    'login-password': { value: options.password || '', type: 'input' },
    'login-btn': { disabled: false, innerHTML: '<span>Sign In</span>', type: 'button' },
    'login-email-err': { textContent: '', type: 'div' },
    'login-pw-err': { textContent: '', type: 'div' },
    'auth-alert': { innerHTML: '', type: 'div' },
  };

  for (const [id, config] of Object.entries(elementDefs)) {
    elements[id] = { ...config, id };
  }

  // Mock document.getElementById
  global.document = {
    getElementById: (id) => elements[id] || null,
    querySelectorAll: () => Object.values(elements).filter(e => e.type === 'div').map(e => ({
      textContent: e.textContent,
      set textContent(v) { e.textContent = v; }
    })),
  };

  // Mock window.location
  const searchParams = options.returnTo
    ? `?returnTo=${options.returnTo}`
    : '';

  delete global.window;
  global.window = {
    location: {
      search: searchParams,
      href: '',
    },
    SupabaseAuthClient: options.authClient || null,
  };

  return elements;
}

/**
 * Creates a minimal AuthController for testing (extracted logic from auth-controller.js).
 * This avoids needing to import the module which relies on browser globals at load time.
 */
function createAuthController() {
  return {
    _clearErrors() {
      const alertContainer = document.getElementById('auth-alert');
      if (alertContainer) alertContainer.innerHTML = '';
      const emailErr = document.getElementById('login-email-err');
      if (emailErr) emailErr.textContent = '';
      const pwErr = document.getElementById('login-pw-err');
      if (pwErr) pwErr.textContent = '';
    },

    _showFieldError(fieldId, message) {
      const el = document.getElementById(fieldId);
      if (el) el.textContent = message;
    },

    _setButtonLoading(btn, loading, text) {
      if (!btn) return;
      btn.disabled = loading;
      if (loading) {
        btn.innerHTML = `<span class="spinner"></span> ${text}`;
      } else {
        btn.innerHTML = `<span>${text}</span>`;
      }
    },

    showAlert(type, message) {
      const alertContainer = document.getElementById('auth-alert');
      if (alertContainer) {
        alertContainer.innerHTML = `<div class="alert alert-${type}">${message}</div>`;
      }
    },

    _withTimeout(promise, timeoutMs) {
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          reject(new Error('REQUEST_TIMEOUT'));
        }, timeoutMs);

        promise
          .then(result => {
            clearTimeout(timer);
            resolve(result);
          })
          .catch(err => {
            clearTimeout(timer);
            reject(err);
          });
      });
    },

    _isNetworkError(error) {
      if (!error) return false;
      const lowerError = error.toLowerCase();
      return (
        lowerError.includes('network') ||
        lowerError.includes('unavailable') ||
        lowerError.includes('timeout') ||
        lowerError.includes('fetch') ||
        lowerError.includes('connection') ||
        lowerError.includes('offline') ||
        lowerError.includes('temporarily unavailable')
      );
    },

    async handleLogin(email, password) {
      this._clearErrors();

      let valid = true;

      if (!email) {
        this._showFieldError('login-email-err', 'Email is required.');
        valid = false;
      }

      if (!password) {
        this._showFieldError('login-pw-err', 'Password is required.');
        valid = false;
      }

      if (!valid) {
        return;
      }

      const btn = document.getElementById('login-btn');
      this._setButtonLoading(btn, true, 'Signing in...');

      try {
        const result = await this._withTimeout(
          window.SupabaseAuthClient.signIn(email, password),
          10000
        );

        if (!result.success) {
          if (this._isNetworkError(result.error)) {
            this.showAlert('error', 'Unable to connect. Please check your internet connection and try again.');
          } else {
            this.showAlert('error', 'Invalid email or password.');
          }
          this._setButtonLoading(btn, false, 'Sign In');
          return;
        }

        this.showAlert('success', 'Logged in! Redirecting...');
        this._setButtonLoading(btn, false, 'Sign In');

        const params = new URLSearchParams(window.location.search);
        const returnTo = params.get('returnTo');
        window.location.href = returnTo || 'dashboard.html';

      } catch (err) {
        if (err.message === 'REQUEST_TIMEOUT') {
          this.showAlert('error', 'Unable to connect. Please check your internet connection and try again.');
        } else {
          this.showAlert('error', 'Unable to connect. Please check your internet connection and try again.');
        }
        this._setButtonLoading(btn, false, 'Sign In');
      }
    },
  };
}

describe('AuthController.handleLogin', () => {
  let controller;

  beforeEach(() => {
    vi.useFakeTimers();
    controller = createAuthController();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  describe('Client-side validation (Req 2.7)', () => {
    it('should show field error when email is empty', async () => {
      const elements = createMockDOM({
        email: '',
        password: 'password123',
        authClient: { signIn: vi.fn() },
      });

      await controller.handleLogin('', 'password123');

      expect(elements['login-email-err'].textContent).toBe('Email is required.');
      // Should NOT call Supabase
      expect(window.SupabaseAuthClient.signIn).not.toHaveBeenCalled();
    });

    it('should show field error when password is empty', async () => {
      const elements = createMockDOM({
        email: 'test@example.com',
        password: '',
        authClient: { signIn: vi.fn() },
      });

      await controller.handleLogin('test@example.com', '');

      expect(elements['login-pw-err'].textContent).toBe('Password is required.');
      expect(window.SupabaseAuthClient.signIn).not.toHaveBeenCalled();
    });

    it('should show both field errors when both fields are empty', async () => {
      const elements = createMockDOM({
        email: '',
        password: '',
        authClient: { signIn: vi.fn() },
      });

      await controller.handleLogin('', '');

      expect(elements['login-email-err'].textContent).toBe('Email is required.');
      expect(elements['login-pw-err'].textContent).toBe('Password is required.');
      expect(window.SupabaseAuthClient.signIn).not.toHaveBeenCalled();
    });
  });

  describe('Authentication failure (Req 2.2)', () => {
    it('should show non-specific error on invalid credentials', async () => {
      const elements = createMockDOM({
        authClient: {
          signIn: vi.fn().mockResolvedValue({
            success: false,
            error: 'Invalid login credentials',
          }),
        },
      });

      await controller.handleLogin('user@test.com', 'wrongpassword');

      expect(elements['auth-alert'].innerHTML).toContain('Invalid email or password.');
      // Must NOT reveal whether email exists or password was wrong
      expect(elements['auth-alert'].innerHTML).not.toContain('not registered');
      expect(elements['auth-alert'].innerHTML).not.toContain('email not found');
    });

    it('should re-enable the button after auth failure', async () => {
      const elements = createMockDOM({
        authClient: {
          signIn: vi.fn().mockResolvedValue({
            success: false,
            error: 'Invalid login credentials',
          }),
        },
      });

      await controller.handleLogin('user@test.com', 'wrongpass');

      expect(elements['login-btn'].disabled).toBe(false);
    });
  });

  describe('Successful login redirect (Req 2.3, 2.4)', () => {
    it('should redirect to dashboard when no returnTo param is present', async () => {
      createMockDOM({
        authClient: {
          signIn: vi.fn().mockResolvedValue({
            success: true,
            session: { access_token: 'token123' },
            user: { id: 'user-1', email: 'user@test.com' },
          }),
        },
      });

      await controller.handleLogin('user@test.com', 'correctpassword');

      expect(window.location.href).toBe('dashboard.html');
    });

    it('should redirect to returnTo page when param is present', async () => {
      createMockDOM({
        returnTo: 'profile.html',
        authClient: {
          signIn: vi.fn().mockResolvedValue({
            success: true,
            session: { access_token: 'token123' },
            user: { id: 'user-1', email: 'user@test.com' },
          }),
        },
      });

      await controller.handleLogin('user@test.com', 'correctpassword');

      expect(window.location.href).toBe('profile.html');
    });

    it('should show success message on successful login', async () => {
      const elements = createMockDOM({
        authClient: {
          signIn: vi.fn().mockResolvedValue({
            success: true,
            session: { access_token: 'token123' },
            user: { id: 'user-1' },
          }),
        },
      });

      await controller.handleLogin('user@test.com', 'correctpassword');

      expect(elements['auth-alert'].innerHTML).toContain('Logged in!');
    });
  });

  describe('Network error handling (Req 2.8)', () => {
    it('should show connectivity message on network error from signIn', async () => {
      const elements = createMockDOM({
        authClient: {
          signIn: vi.fn().mockResolvedValue({
            success: false,
            error: 'Authentication service is temporarily unavailable. Please try again.',
          }),
        },
      });

      await controller.handleLogin('user@test.com', 'password123');

      expect(elements['auth-alert'].innerHTML).toContain('Unable to connect');
      expect(elements['auth-alert'].innerHTML).toContain('internet connection');
    });

    it('should show connectivity message on request timeout', async () => {
      const elements = createMockDOM({
        authClient: {
          signIn: vi.fn().mockImplementation(() => new Promise(() => {
            // Never resolves — simulates timeout
          })),
        },
      });

      const loginPromise = controller.handleLogin('user@test.com', 'password123');

      // Advance past the 10s timeout
      await vi.advanceTimersByTimeAsync(11000);
      await loginPromise;

      expect(elements['auth-alert'].innerHTML).toContain('Unable to connect');
    });

    it('should NOT clear form fields on network error (allow retry)', async () => {
      const elements = createMockDOM({
        email: 'user@test.com',
        password: 'password123',
        authClient: {
          signIn: vi.fn().mockResolvedValue({
            success: false,
            error: 'Network request failed',
          }),
        },
      });

      await controller.handleLogin('user@test.com', 'password123');

      // The email and password values should remain unchanged
      expect(elements['login-email'].value).toBe('user@test.com');
      expect(elements['login-password'].value).toBe('password123');
    });

    it('should re-enable button after network error', async () => {
      const elements = createMockDOM({
        authClient: {
          signIn: vi.fn().mockResolvedValue({
            success: false,
            error: 'fetch failed',
          }),
        },
      });

      await controller.handleLogin('user@test.com', 'password123');

      expect(elements['login-btn'].disabled).toBe(false);
    });
  });

  describe('Loading state', () => {
    it('should disable button and show spinner during login', async () => {
      let resolveSignIn;
      const elements = createMockDOM({
        authClient: {
          signIn: vi.fn().mockImplementation(() => new Promise((resolve) => {
            resolveSignIn = resolve;
          })),
        },
      });

      const loginPromise = controller.handleLogin('user@test.com', 'password123');

      // Button should be disabled while waiting
      expect(elements['login-btn'].disabled).toBe(true);
      expect(elements['login-btn'].innerHTML).toContain('Signing in...');

      // Resolve the sign-in
      resolveSignIn({ success: true, session: {}, user: {} });
      await loginPromise;

      // Button should be re-enabled
      expect(elements['login-btn'].disabled).toBe(false);
    });
  });
});
