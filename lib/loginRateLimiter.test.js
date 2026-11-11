import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  checkLoginRateLimit,
  recordFailedAttempt,
  resetAttempts,
  _loginAttempts,
  _MAX_ATTEMPTS,
  _WINDOW_MS,
} from './loginRateLimiter.js';

describe('loginRateLimiter', () => {
  beforeEach(() => {
    _loginAttempts.clear();
  });

  describe('checkLoginRateLimit', () => {
    it('allows the first attempt for a new phone', () => {
      const result = checkLoginRateLimit('9876543210');
      expect(result).toEqual({ allowed: true });
    });

    it('allows attempts under the limit', () => {
      const phone = '9876543210';
      for (let i = 0; i < 9; i++) {
        recordFailedAttempt(phone);
      }
      const result = checkLoginRateLimit(phone);
      expect(result).toEqual({ allowed: true });
    });

    it('blocks the 11th attempt after 10 failed attempts', () => {
      const phone = '9876543210';
      for (let i = 0; i < 10; i++) {
        recordFailedAttempt(phone);
      }
      const result = checkLoginRateLimit(phone);
      expect(result.allowed).toBe(false);
      expect(result.retryAfter).toBeGreaterThan(0);
      expect(result.retryAfter).toBeLessThanOrEqual(15 * 60);
    });

    it('returns retryAfter as remaining seconds in the window', () => {
      const phone = '9876543210';
      const now = Date.now();
      // Simulate that the window started 5 minutes ago
      _loginAttempts.set(phone, { count: 10, windowStart: now - 5 * 60 * 1000 });

      const result = checkLoginRateLimit(phone);
      expect(result.allowed).toBe(false);
      // Should be approximately 10 minutes (600 seconds)
      expect(result.retryAfter).toBeGreaterThan(590);
      expect(result.retryAfter).toBeLessThanOrEqual(600);
    });

    it('resets the window after expiry and allows the attempt', () => {
      const phone = '9876543210';
      // Set a window that has expired (started 16 minutes ago)
      _loginAttempts.set(phone, { count: 10, windowStart: Date.now() - 16 * 60 * 1000 });

      const result = checkLoginRateLimit(phone);
      expect(result).toEqual({ allowed: true });
    });

    it('isolates rate limiting per phone number', () => {
      const phone1 = '1111111111';
      const phone2 = '2222222222';

      for (let i = 0; i < 10; i++) {
        recordFailedAttempt(phone1);
      }

      expect(checkLoginRateLimit(phone1).allowed).toBe(false);
      expect(checkLoginRateLimit(phone2).allowed).toBe(true);
    });
  });

  describe('recordFailedAttempt', () => {
    it('creates a new entry for a new phone', () => {
      recordFailedAttempt('9876543210');
      const entry = _loginAttempts.get('9876543210');
      expect(entry.count).toBe(1);
      expect(entry.windowStart).toBeGreaterThan(0);
    });

    it('increments count for existing phone within window', () => {
      const phone = '9876543210';
      recordFailedAttempt(phone);
      recordFailedAttempt(phone);
      recordFailedAttempt(phone);
      const entry = _loginAttempts.get(phone);
      expect(entry.count).toBe(3);
    });

    it('resets window if previous window expired', () => {
      const phone = '9876543210';
      _loginAttempts.set(phone, { count: 8, windowStart: Date.now() - 16 * 60 * 1000 });

      recordFailedAttempt(phone);
      const entry = _loginAttempts.get(phone);
      expect(entry.count).toBe(1);
    });
  });

  describe('resetAttempts', () => {
    it('removes the entry for the phone', () => {
      const phone = '9876543210';
      recordFailedAttempt(phone);
      expect(_loginAttempts.has(phone)).toBe(true);

      resetAttempts(phone);
      expect(_loginAttempts.has(phone)).toBe(false);
    });

    it('does not throw for a phone with no entry', () => {
      expect(() => resetAttempts('0000000000')).not.toThrow();
    });
  });

  describe('constants', () => {
    it('has max 10 attempts', () => {
      expect(_MAX_ATTEMPTS).toBe(10);
    });

    it('has 15-minute window', () => {
      expect(_WINDOW_MS).toBe(15 * 60 * 1000);
    });
  });
});
