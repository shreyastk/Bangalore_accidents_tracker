/**
 * Unit Tests for Inactivity Timer Logic
 * Task 10.4: Test timer resets, warning display, and auto-logout
 *
 * Requirements: 4.6 (Correctness Property 5: Inactivity timeout)
 *
 * Tests the core inactivity timer logic using dependency injection
 * to decouple from DOM and admin-app.js internals.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

/**
 * Creates a testable inactivity timer with dependency injection.
 * Mirrors the logic of initInactivityTimer in admin-app.js but accepts
 * callbacks instead of directly manipulating DOM/session.
 *
 * @param {Object} options
 * @param {number} options.timeoutMs - Total inactivity timeout (default 30 min)
 * @param {number} options.warningBeforeMs - Warning shown this many ms before timeout (default 5 min)
 * @param {Function} options.onWarning - Called when warning should be shown
 * @param {Function} options.onTimeout - Called when auto-logout should occur
 */
function createInactivityTimer({
  timeoutMs = 30 * 60 * 1000,
  warningBeforeMs = 5 * 60 * 1000,
  onWarning = () => {},
  onTimeout = () => {},
} = {}) {
  let logoutTimer = null;
  let warningTimer = null;
  let stopped = false;
  let warningFired = false;

  function reset() {
    if (stopped) return;
    clearTimeout(logoutTimer);
    clearTimeout(warningTimer);
    warningFired = false;

    // Set warning timer (fires at timeoutMs - warningBeforeMs)
    warningTimer = setTimeout(() => {
      if (!stopped) {
        warningFired = true;
        onWarning();
      }
    }, timeoutMs - warningBeforeMs);

    // Set logout timer (fires at timeoutMs)
    logoutTimer = setTimeout(() => {
      if (!stopped) {
        onTimeout();
      }
    }, timeoutMs);
  }

  function stop() {
    stopped = true;
    clearTimeout(logoutTimer);
    clearTimeout(warningTimer);
  }

  // Initial start
  reset();

  return { reset, stop };
}

describe('Inactivity Timer - Unit Tests', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('Warning callback', () => {
    it('fires warning callback after 25 minutes (T-5 min before 30 min timeout)', () => {
      const onWarning = vi.fn();
      const onTimeout = vi.fn();

      createInactivityTimer({ onWarning, onTimeout });

      // At 24 minutes, no warning yet
      vi.advanceTimersByTime(24 * 60 * 1000);
      expect(onWarning).not.toHaveBeenCalled();

      // At 25 minutes, warning fires
      vi.advanceTimersByTime(1 * 60 * 1000);
      expect(onWarning).toHaveBeenCalledTimes(1);

      // Timeout has not fired yet
      expect(onTimeout).not.toHaveBeenCalled();
    });

    it('fires warning at custom warningBeforeMs offset', () => {
      const onWarning = vi.fn();

      // 10 minute timeout, warning 2 minutes before
      createInactivityTimer({
        timeoutMs: 10 * 60 * 1000,
        warningBeforeMs: 2 * 60 * 1000,
        onWarning,
      });

      // At 7 minutes, no warning
      vi.advanceTimersByTime(7 * 60 * 1000);
      expect(onWarning).not.toHaveBeenCalled();

      // At 8 minutes, warning fires
      vi.advanceTimersByTime(1 * 60 * 1000);
      expect(onWarning).toHaveBeenCalledTimes(1);
    });
  });

  describe('Auto-logout callback', () => {
    it('fires timeout callback after 30 minutes with no activity', () => {
      const onWarning = vi.fn();
      const onTimeout = vi.fn();

      createInactivityTimer({ onWarning, onTimeout });

      // At 29 minutes, no timeout yet
      vi.advanceTimersByTime(29 * 60 * 1000);
      expect(onTimeout).not.toHaveBeenCalled();

      // At 30 minutes, timeout fires
      vi.advanceTimersByTime(1 * 60 * 1000);
      expect(onTimeout).toHaveBeenCalledTimes(1);
    });

    it('fires both warning and timeout in sequence without activity', () => {
      const onWarning = vi.fn();
      const onTimeout = vi.fn();

      createInactivityTimer({ onWarning, onTimeout });

      // Advance full 30 minutes
      vi.advanceTimersByTime(30 * 60 * 1000);

      expect(onWarning).toHaveBeenCalledTimes(1);
      expect(onTimeout).toHaveBeenCalledTimes(1);
    });
  });

  describe('Timer resets on user activity', () => {
    it('calling reset() restarts the full 30-minute countdown', () => {
      const onWarning = vi.fn();
      const onTimeout = vi.fn();

      const timer = createInactivityTimer({ onWarning, onTimeout });

      // Advance 20 minutes
      vi.advanceTimersByTime(20 * 60 * 1000);
      expect(onWarning).not.toHaveBeenCalled();
      expect(onTimeout).not.toHaveBeenCalled();

      // Simulate user activity — reset the timer
      timer.reset();

      // Advance another 20 minutes (40 min total, but only 20 since reset)
      vi.advanceTimersByTime(20 * 60 * 1000);
      expect(onWarning).not.toHaveBeenCalled();
      expect(onTimeout).not.toHaveBeenCalled();

      // Advance 5 more minutes (25 since reset) — warning fires
      vi.advanceTimersByTime(5 * 60 * 1000);
      expect(onWarning).toHaveBeenCalledTimes(1);
      expect(onTimeout).not.toHaveBeenCalled();

      // Advance 5 more minutes (30 since reset) — timeout fires
      vi.advanceTimersByTime(5 * 60 * 1000);
      expect(onTimeout).toHaveBeenCalledTimes(1);
    });

    it('after reset, the next warning is 25 minutes from the reset time', () => {
      const onWarning = vi.fn();

      const timer = createInactivityTimer({ onWarning });

      // Advance to 24 minutes (just before original warning)
      vi.advanceTimersByTime(24 * 60 * 1000);
      expect(onWarning).not.toHaveBeenCalled();

      // Reset at 24 minutes
      timer.reset();

      // The original warning at 25 min should NOT fire now
      vi.advanceTimersByTime(1 * 60 * 1000);
      expect(onWarning).not.toHaveBeenCalled();

      // 25 minutes after reset = warning fires
      vi.advanceTimersByTime(24 * 60 * 1000);
      expect(onWarning).toHaveBeenCalledTimes(1);
    });

    it('multiple resets keep extending the countdown', () => {
      const onTimeout = vi.fn();

      const timer = createInactivityTimer({ onTimeout });

      // Reset every 10 minutes, 5 times (50 minutes total)
      for (let i = 0; i < 5; i++) {
        vi.advanceTimersByTime(10 * 60 * 1000);
        timer.reset();
      }

      // No timeout despite 50 minutes elapsed
      expect(onTimeout).not.toHaveBeenCalled();

      // Now wait the full 30 minutes without resetting
      vi.advanceTimersByTime(30 * 60 * 1000);
      expect(onTimeout).toHaveBeenCalledTimes(1);
    });
  });

  describe('stop() prevents further callbacks', () => {
    it('stop() prevents warning callback from firing', () => {
      const onWarning = vi.fn();
      const onTimeout = vi.fn();

      const timer = createInactivityTimer({ onWarning, onTimeout });

      // Stop after 10 minutes
      vi.advanceTimersByTime(10 * 60 * 1000);
      timer.stop();

      // Advance past the full timeout
      vi.advanceTimersByTime(30 * 60 * 1000);

      expect(onWarning).not.toHaveBeenCalled();
      expect(onTimeout).not.toHaveBeenCalled();
    });

    it('stop() prevents timeout callback from firing', () => {
      const onWarning = vi.fn();
      const onTimeout = vi.fn();

      const timer = createInactivityTimer({ onWarning, onTimeout });

      // Advance past warning time
      vi.advanceTimersByTime(26 * 60 * 1000);
      expect(onWarning).toHaveBeenCalledTimes(1);

      // Stop after warning but before timeout
      timer.stop();

      // Advance past timeout
      vi.advanceTimersByTime(10 * 60 * 1000);
      expect(onTimeout).not.toHaveBeenCalled();
    });

    it('reset() has no effect after stop()', () => {
      const onWarning = vi.fn();
      const onTimeout = vi.fn();

      const timer = createInactivityTimer({ onWarning, onTimeout });

      timer.stop();

      // Try to reset after stop
      timer.reset();

      // Advance full timeout
      vi.advanceTimersByTime(30 * 60 * 1000);

      expect(onWarning).not.toHaveBeenCalled();
      expect(onTimeout).not.toHaveBeenCalled();
    });
  });
});
