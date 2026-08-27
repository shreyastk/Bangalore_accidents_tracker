/**
 * Auth UI Controller
 * Manages login/register form interactions, validation, and redirects.
 * Replaces inline auth scripts in login.html with calls to SupabaseAuthClient.
 *
 * Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7, 2.1, 2.2, 2.3, 2.4, 2.7, 2.8
 */

const AuthController = {
  /**
   * Initialize forms, tabs, and event listeners.
   * Call this on DOMContentLoaded from login.html.
   */
  init() {
    this._setupTabs();
    this._setupPasswordToggles();
    this._setupForms();
    this._setupPasswordReset();
    this._checkUrlParams();
    this._redirectIfAuthenticated();
  },

  /**
   * Handle registration form submission.
   * Performs client-side validation, calls SupabaseAuthClient.signUp,
   * and handles success/error states.
   *
   * @param {string} name - User's full name
   * @param {string} email - User's email address
   * @param {string} password - Chosen password
   * @param {string} confirmPassword - Password confirmation
   * @returns {Promise<void>}
   */
  async handleRegister(name, email, password, confirmPassword) {
    this._clearErrors();

    // Client-side validation
    const termsChecked = document.getElementById('terms')
      ? document.getElementById('terms').checked
      : false;

    const errors = this._validateRegistration(name, email, password, confirmPassword, termsChecked);

    if (errors.length > 0) {
      errors.forEach(err => this._showFieldError(err.field, err.message));
      return;
    }

    // Show loading state
    const btn = document.getElementById('register-btn');
    this._setButtonLoading(btn, true, 'Creating account...');

    try {
      // Call SupabaseAuthClient with a timeout for unreachable detection (Req 1.7)
      const result = await this._withTimeout(
        window.SupabaseAuthClient.signUp(email, password, name),
        10000
      );

      if (!result.success) {
        // Handle specific error cases
        const errorMsg = this._mapRegistrationError(result.error);
        this.showAlert('error', errorMsg);
        this._setButtonLoading(btn, false, 'Create Account');
        return;
      }

      // Success: auto-login and redirect to dashboard within 2 seconds (Req 1.6)
      this.showAlert('success', 'Account created! Redirecting...');
      this._setButtonLoading(btn, false, 'Create Account');

      setTimeout(() => {
        const params = new URLSearchParams(window.location.search);
        window.location.href = params.get('returnTo') || 'dashboard.html';
      }, 1500);

    } catch (err) {
      // Timeout or network error (Req 1.7)
      if (err.message === 'REQUEST_TIMEOUT') {
        this.showAlert('error', 'Unable to connect to the authentication service. Please check your internet connection and try again.');
      } else {
        this.showAlert('error', 'An unexpected error occurred. Please try again.');
      }
      this._setButtonLoading(btn, false, 'Create Account');
    }
  },

  /**
   * Handle login form submission.
   * Performs client-side validation, calls SupabaseAuthClient.signIn,
   * and handles success/error states including redirects.
   *
   * @param {string} email - User's email address
   * @param {string} password - User's password
   * @returns {Promise<void>}
   *
   * Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.7, 2.8
   */
  async handleLogin(email, password) {
    this._clearErrors();

    // Client-side validation: non-empty email and password (Req 2.7)
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

    // Show loading state
    const btn = document.getElementById('login-btn');
    this._setButtonLoading(btn, true, 'Signing in...');

    try {
      // Call SupabaseAuthClient.signIn with timeout for network error detection (Req 2.8)
      const result = await this._withTimeout(
        window.SupabaseAuthClient.signIn(email, password),
        10000
      );

      if (!result.success) {
        // Check if this is a network/connectivity error vs auth failure
        if (this._isNetworkError(result.error)) {
          // Network error: show connectivity message, allow retry without re-entering credentials (Req 2.8)
          this.showAlert('error', 'Unable to connect. Please check your internet connection and try again.');
        } else {
          // Auth failure: single non-specific error message (Req 2.2)
          this.showAlert('error', 'Invalid email or password.');
        }
        this._setButtonLoading(btn, false, 'Sign In');
        return;
      }

      // Success: session is persisted automatically by Supabase (persistSession: true) (Req 2.5)
      this.showAlert('success', 'Logged in! Redirecting...');
      this._setButtonLoading(btn, false, 'Sign In');

      // Redirect based on returnTo param (Req 2.3, 2.4)
      const params = new URLSearchParams(window.location.search);
      const returnTo = params.get('returnTo');
      window.location.href = returnTo || 'dashboard.html';

    } catch (err) {
      // Timeout or unexpected network error (Req 2.8)
      if (err.message === 'REQUEST_TIMEOUT') {
        this.showAlert('error', 'Unable to connect. Please check your internet connection and try again.');
      } else {
        this.showAlert('error', 'Unable to connect. Please check your internet connection and try again.');
      }
      // Do NOT clear form fields — allow retry without re-entering credentials (Req 2.8)
      this._setButtonLoading(btn, false, 'Sign In');
    }
  },

  /**
   * Check if an error message indicates a network/connectivity issue.
   * @param {string} error - Error message from SupabaseAuthClient
   * @returns {boolean}
   */
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

  /**
   * Redirect if user is already authenticated.
   * @param {string} defaultPage - Default redirect target
   */
  async redirectIfAuthenticated(defaultPage = 'dashboard.html') {
    if (!window.SupabaseAuthClient) return;

    // Validate the session with getUser() (checks against Supabase and the dev
    // fallback) instead of getSession() (storage only). Using getSession() here
    // makes the login page bounce stale/expired sessions straight back to the
    // protected page, which redirects to login again — an infinite redirect loop.
    const user = await window.SupabaseAuthClient.getUser();
    if (user) {
      const params = new URLSearchParams(window.location.search);
      window.location.href = params.get('returnTo') || defaultPage;
    }
  },

  /**
   * Show an alert message at the top of the auth form.
   * @param {'success'|'error'|'info'} type - Alert type
   * @param {string} message - Alert message text
   */
  showAlert(type, message) {
    const alertContainer = document.getElementById('auth-alert');
    if (alertContainer) {
      alertContainer.innerHTML = `<div class="alert alert-${type}">${message}</div>`;
    }
  },

  // ─── Private Methods ──────────────────────────────────────────────

  /**
   * Validate registration inputs.
   * Returns an array of { field, message } objects for any validation failures.
   */
  _validateRegistration(name, email, password, confirmPassword, termsAccepted) {
    const errors = [];

    // Name: at least 2 characters (Req 1.5)
    if (!name || name.length < 2) {
      errors.push({
        field: 'reg-name-err',
        message: 'Name must be at least 2 characters.'
      });
    }

    // Email: valid format with @ and domain (Req 1.1)
    if (!email || !this._isValidEmail(email)) {
      errors.push({
        field: 'reg-email-err',
        message: 'Please enter a valid email address.'
      });
    }

    // Password: at least 6 characters (Req 1.3)
    if (!password || password.length < 6) {
      errors.push({
        field: 'reg-pw-err',
        message: 'Password must be at least 6 characters.'
      });
    }

    // Confirm password: must match (Req 1.4)
    if (password !== confirmPassword) {
      errors.push({
        field: 'reg-confirm-err',
        message: 'Passwords do not match.'
      });
    }

    // Terms: must be accepted (Req 1.1)
    if (!termsAccepted) {
      errors.push({
        field: 'terms-err',
        message: 'You must agree to the Terms of Service.'
      });
    }

    return errors;
  },

  /**
   * Validate email format.
   * Checks for a valid "@domain" format with at least one dot after @.
   */
  _isValidEmail(email) {
    // Simple but effective email validation
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
  },

  /**
   * Map Supabase error messages to user-friendly messages.
   * Handles duplicate email (Req 1.2) and other known errors.
   */
  _mapRegistrationError(error) {
    if (!error) return 'Registration failed. Please try again.';

    const lowerError = error.toLowerCase();

    // Duplicate email (Req 1.2)
    if (lowerError.includes('already registered') ||
        lowerError.includes('already been registered') ||
        lowerError.includes('user already registered') ||
        lowerError.includes('duplicate') ||
        lowerError.includes('already exists')) {
      return 'An account with this email address already exists. Please sign in or use a different email.';
    }

    // Password too short (shouldn't reach here due to client validation, but handle anyway)
    if (lowerError.includes('password') && lowerError.includes('short')) {
      return 'Password must be at least 6 characters.';
    }

    // Invalid email format
    if (lowerError.includes('invalid') && lowerError.includes('email')) {
      return 'Please enter a valid email address.';
    }

    // Rate limiting
    if (lowerError.includes('rate limit') || lowerError.includes('too many')) {
      return 'Too many registration attempts. Please wait a moment and try again.';
    }

    // Generic fallback
    return error;
  },

  /**
   * Wrap a promise with a timeout.
   * Rejects with REQUEST_TIMEOUT if the promise doesn't resolve within timeoutMs.
   * Used to detect Supabase unreachable within 10 seconds (Req 1.7).
   */
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

  /**
   * Show a field-level error message adjacent to the relevant input.
   */
  _showFieldError(fieldId, message) {
    const el = document.getElementById(fieldId);
    if (el) {
      el.textContent = message;
    }
  },

  /**
   * Clear all field-level errors and alerts.
   */
  _clearErrors() {
    document.querySelectorAll('.form-error').forEach(el => {
      el.textContent = '';
    });
    const alertContainer = document.getElementById('auth-alert');
    if (alertContainer) {
      alertContainer.innerHTML = '';
    }
  },

  /**
   * Set button loading state.
   */
  _setButtonLoading(btn, loading, text) {
    if (!btn) return;
    btn.disabled = loading;
    if (loading) {
      btn.innerHTML = `<span class="spinner"></span> ${text}`;
    } else {
      btn.innerHTML = `<span>${text}</span>`;
    }
  },

  /**
   * Setup tab switching between Login and Register panels.
   */
  _setupTabs() {
    const tabs = document.querySelectorAll('.auth-tab');
    tabs.forEach(tab => {
      tab.addEventListener('click', function () {
        tabs.forEach(t => t.classList.remove('active'));
        document.querySelectorAll('.auth-panel').forEach(p => p.classList.remove('active'));
        this.classList.add('active');
        const target = document.getElementById(this.dataset.target);
        if (target) target.classList.add('active');
      });
    });
  },

  /**
   * Setup password visibility toggles.
   */
  _setupPasswordToggles() {
    this._setupToggle('login-password', 'pw-toggle-login');
    this._setupToggle('reg-password', 'pw-toggle-reg');
  },

  _setupToggle(inputId, toggleId) {
    const toggle = document.getElementById(toggleId);
    if (!toggle) return;
    toggle.addEventListener('click', () => {
      const input = document.getElementById(inputId);
      if (input) {
        input.type = input.type === 'password' ? 'text' : 'password';
      }
    });
  },

  /**
   * Setup form submit event listeners.
   */
  _setupForms() {
    const registerForm = document.getElementById('register-form');
    if (registerForm) {
      registerForm.addEventListener('submit', (e) => {
        e.preventDefault();
        const name = document.getElementById('reg-name').value.trim();
        const email = document.getElementById('reg-email').value.trim();
        const password = document.getElementById('reg-password').value;
        const confirmPassword = document.getElementById('reg-confirm').value;
        this.handleRegister(name, email, password, confirmPassword);
      });
    }

    const loginForm = document.getElementById('login-form');
    if (loginForm) {
      loginForm.addEventListener('submit', (e) => {
        e.preventDefault();
        const email = document.getElementById('login-email').value.trim();
        const password = document.getElementById('login-password').value;
        this.handleLogin(email, password);
      });
    }
  },

  _setupPasswordReset() {
    const link = document.querySelector('.forgot-link');
    if (!link) return;
    link.addEventListener('click', async (event) => {
      event.preventDefault();
      const emailInput = document.getElementById('login-email');
      const email = emailInput?.value.trim();
      if (!email) {
        this.showAlert('info', 'Enter your email address first, then select Forgot password.');
        emailInput?.focus();
        return;
      }
      link.textContent = 'Sending...';
      const result = await window.SupabaseAuthClient.resetPassword(email);
      link.textContent = 'Forgot password?';
      this.showAlert(result.success ? 'success' : 'error', result.success
        ? 'If that account exists, a password reset link has been sent to the email address.'
        : 'Unable to send the reset email. Please try again.');
    });
  },

  /**
   * Check URL parameters for tab selection and messages.
   */
  _checkUrlParams() {
    const params = new URLSearchParams(window.location.search);

    // Switch to register tab if specified
    if (params.get('tab') === 'register') {
      const registerTab = document.getElementById('tab-register');
      if (registerTab) registerTab.click();
    }

    // Show expired session message
    if (params.get('expired') === 'true') {
      this.showAlert('info', 'Your session has expired. Please sign in again.');
    }

    // Show connectivity error message
    if (params.get('connectivity') === 'true') {
      this.showAlert('error', 'Connection lost. Please check your internet and sign in again.');
    }
  },

  /**
   * Check if user is already authenticated and redirect.
   */
  async _redirectIfAuthenticated() {
    await this.redirectIfAuthenticated();
  }
};

// Expose AuthController globally for use in login.html
window.AuthController = AuthController;
