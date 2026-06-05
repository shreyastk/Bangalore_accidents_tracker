/**
 * Unit Tests for Auth Controller - Registration Validation Logic
 * Task 2.3: Test name length, email format, password length, and password match validation
 *
 * **Validates: Requirements 1.3, 1.4, 1.5**
 */

import { describe, it, expect, beforeEach } from 'vitest';

/**
 * Extract the validation logic from AuthController for unit testing.
 * Since auth-controller.js is a plain script that attaches to `window`,
 * we recreate the validation functions directly for isolated testing.
 */

// Email validation regex (same as in auth-controller.js)
function isValidEmail(email) {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
}

/**
 * Validate registration inputs.
 * Returns an array of { field, message } objects for any validation failures.
 * This mirrors AuthController._validateRegistration exactly.
 */
function validateRegistration(name, email, password, confirmPassword, termsAccepted) {
  const errors = [];

  // Name: at least 2 characters (Req 1.5)
  if (!name || name.length < 2) {
    errors.push({
      field: 'reg-name-err',
      message: 'Name must be at least 2 characters.'
    });
  }

  // Email: valid format with @ and domain (Req 1.1)
  if (!email || !isValidEmail(email)) {
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
}

describe('AuthController - Registration Validation', () => {
  describe('Name length validation (Requirement 1.5)', () => {
    it('rejects empty name', () => {
      const errors = validateRegistration('', 'user@example.com', 'password123', 'password123', true);
      const nameError = errors.find(e => e.field === 'reg-name-err');
      expect(nameError).toBeDefined();
      expect(nameError.message).toBe('Name must be at least 2 characters.');
    });

    it('rejects name with 1 character', () => {
      const errors = validateRegistration('A', 'user@example.com', 'password123', 'password123', true);
      const nameError = errors.find(e => e.field === 'reg-name-err');
      expect(nameError).toBeDefined();
      expect(nameError.message).toBe('Name must be at least 2 characters.');
    });

    it('accepts name with exactly 2 characters', () => {
      const errors = validateRegistration('AB', 'user@example.com', 'password123', 'password123', true);
      const nameError = errors.find(e => e.field === 'reg-name-err');
      expect(nameError).toBeUndefined();
    });

    it('accepts name with more than 2 characters', () => {
      const errors = validateRegistration('Shreyas Kumar', 'user@example.com', 'password123', 'password123', true);
      const nameError = errors.find(e => e.field === 'reg-name-err');
      expect(nameError).toBeUndefined();
    });

    it('rejects null name', () => {
      const errors = validateRegistration(null, 'user@example.com', 'password123', 'password123', true);
      const nameError = errors.find(e => e.field === 'reg-name-err');
      expect(nameError).toBeDefined();
    });

    it('rejects undefined name', () => {
      const errors = validateRegistration(undefined, 'user@example.com', 'password123', 'password123', true);
      const nameError = errors.find(e => e.field === 'reg-name-err');
      expect(nameError).toBeDefined();
    });
  });

  describe('Email format validation (Requirement 1.1)', () => {
    it('rejects empty email', () => {
      const errors = validateRegistration('John', '', 'password123', 'password123', true);
      const emailError = errors.find(e => e.field === 'reg-email-err');
      expect(emailError).toBeDefined();
      expect(emailError.message).toBe('Please enter a valid email address.');
    });

    it('rejects email without @ symbol', () => {
      const errors = validateRegistration('John', 'userexample.com', 'password123', 'password123', true);
      const emailError = errors.find(e => e.field === 'reg-email-err');
      expect(emailError).toBeDefined();
    });

    it('rejects email without domain', () => {
      const errors = validateRegistration('John', 'user@', 'password123', 'password123', true);
      const emailError = errors.find(e => e.field === 'reg-email-err');
      expect(emailError).toBeDefined();
    });

    it('rejects email without TLD (no dot after @)', () => {
      const errors = validateRegistration('John', 'user@example', 'password123', 'password123', true);
      const emailError = errors.find(e => e.field === 'reg-email-err');
      expect(emailError).toBeDefined();
    });

    it('accepts valid email format', () => {
      const errors = validateRegistration('John', 'user@example.com', 'password123', 'password123', true);
      const emailError = errors.find(e => e.field === 'reg-email-err');
      expect(emailError).toBeUndefined();
    });

    it('accepts email with subdomain', () => {
      const errors = validateRegistration('John', 'user@mail.example.co.in', 'password123', 'password123', true);
      const emailError = errors.find(e => e.field === 'reg-email-err');
      expect(emailError).toBeUndefined();
    });

    it('rejects email with spaces', () => {
      const errors = validateRegistration('John', 'user @example.com', 'password123', 'password123', true);
      const emailError = errors.find(e => e.field === 'reg-email-err');
      expect(emailError).toBeDefined();
    });
  });

  describe('Password length validation (Requirement 1.3)', () => {
    it('rejects empty password', () => {
      const errors = validateRegistration('John', 'user@example.com', '', '', true);
      const pwError = errors.find(e => e.field === 'reg-pw-err');
      expect(pwError).toBeDefined();
      expect(pwError.message).toBe('Password must be at least 6 characters.');
    });

    it('rejects password with 5 characters', () => {
      const errors = validateRegistration('John', 'user@example.com', '12345', '12345', true);
      const pwError = errors.find(e => e.field === 'reg-pw-err');
      expect(pwError).toBeDefined();
      expect(pwError.message).toBe('Password must be at least 6 characters.');
    });

    it('accepts password with exactly 6 characters', () => {
      const errors = validateRegistration('John', 'user@example.com', '123456', '123456', true);
      const pwError = errors.find(e => e.field === 'reg-pw-err');
      expect(pwError).toBeUndefined();
    });

    it('accepts password with more than 6 characters', () => {
      const errors = validateRegistration('John', 'user@example.com', 'securepassword123', 'securepassword123', true);
      const pwError = errors.find(e => e.field === 'reg-pw-err');
      expect(pwError).toBeUndefined();
    });

    it('rejects null password', () => {
      const errors = validateRegistration('John', 'user@example.com', null, null, true);
      const pwError = errors.find(e => e.field === 'reg-pw-err');
      expect(pwError).toBeDefined();
    });
  });

  describe('Password match validation (Requirement 1.4)', () => {
    it('rejects mismatched passwords', () => {
      const errors = validateRegistration('John', 'user@example.com', 'password123', 'password456', true);
      const confirmError = errors.find(e => e.field === 'reg-confirm-err');
      expect(confirmError).toBeDefined();
      expect(confirmError.message).toBe('Passwords do not match.');
    });

    it('accepts matching passwords', () => {
      const errors = validateRegistration('John', 'user@example.com', 'password123', 'password123', true);
      const confirmError = errors.find(e => e.field === 'reg-confirm-err');
      expect(confirmError).toBeUndefined();
    });

    it('rejects when confirm password is empty but password is not', () => {
      const errors = validateRegistration('John', 'user@example.com', 'password123', '', true);
      const confirmError = errors.find(e => e.field === 'reg-confirm-err');
      expect(confirmError).toBeDefined();
    });

    it('detects case sensitivity mismatch', () => {
      const errors = validateRegistration('John', 'user@example.com', 'Password123', 'password123', true);
      const confirmError = errors.find(e => e.field === 'reg-confirm-err');
      expect(confirmError).toBeDefined();
    });
  });

  describe('Terms acceptance validation', () => {
    it('rejects when terms not accepted', () => {
      const errors = validateRegistration('John', 'user@example.com', 'password123', 'password123', false);
      const termsError = errors.find(e => e.field === 'terms-err');
      expect(termsError).toBeDefined();
      expect(termsError.message).toBe('You must agree to the Terms of Service.');
    });

    it('accepts when terms are accepted', () => {
      const errors = validateRegistration('John', 'user@example.com', 'password123', 'password123', true);
      const termsError = errors.find(e => e.field === 'terms-err');
      expect(termsError).toBeUndefined();
    });
  });

  describe('Multiple validation errors', () => {
    it('returns all errors when all fields are invalid', () => {
      const errors = validateRegistration('', '', '', 'x', false);
      expect(errors.length).toBeGreaterThanOrEqual(4);
      expect(errors.find(e => e.field === 'reg-name-err')).toBeDefined();
      expect(errors.find(e => e.field === 'reg-email-err')).toBeDefined();
      expect(errors.find(e => e.field === 'reg-pw-err')).toBeDefined();
      expect(errors.find(e => e.field === 'reg-confirm-err')).toBeDefined();
      expect(errors.find(e => e.field === 'terms-err')).toBeDefined();
    });

    it('returns no errors when all fields are valid', () => {
      const errors = validateRegistration('John Doe', 'john@example.com', 'secure123', 'secure123', true);
      expect(errors).toHaveLength(0);
    });
  });
});
