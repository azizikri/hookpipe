import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { calculateNextDelay, shouldRetry, getNextAttemptTime } from '../../src/delivery/retry.js';

describe('retry module', () => {
  describe('calculateNextDelay', () => {
    describe('exponential backoff', () => {
      const config = { backoff: 'exponential', initialDelayMs: 1000, maxDelayMs: 300000 };

      it('attempt 1 returns ~1000ms (base delay + jitter)', () => {
        const delay = calculateNextDelay(1, config);
        expect(delay).toBeGreaterThanOrEqual(1000);
        expect(delay).toBeLessThanOrEqual(1250); // 1000 + 25% jitter
      });

      it('attempt 2 returns ~2000ms', () => {
        const delay = calculateNextDelay(2, config);
        expect(delay).toBeGreaterThanOrEqual(2000);
        expect(delay).toBeLessThanOrEqual(2500);
      });

      it('attempt 3 returns ~4000ms', () => {
        const delay = calculateNextDelay(3, config);
        expect(delay).toBeGreaterThanOrEqual(4000);
        expect(delay).toBeLessThanOrEqual(5000);
      });

      it('caps at maxDelayMs', () => {
        const smallMax = { backoff: 'exponential', initialDelayMs: 1000, maxDelayMs: 5000 };
        const delay = calculateNextDelay(10, smallMax); // 1000 * 2^9 = 512000, capped at 5000
        expect(delay).toBeGreaterThanOrEqual(5000);
        expect(delay).toBeLessThanOrEqual(6250); // 5000 + 25% jitter
      });

      it('jitter is within 0-25% range', () => {
        const results = Array.from({ length: 100 }, () => calculateNextDelay(1, config));
        const baseDelay = 1000;
        for (const delay of results) {
          expect(delay).toBeGreaterThanOrEqual(baseDelay);
          expect(delay).toBeLessThanOrEqual(baseDelay * 1.25);
        }
      });
    });

    describe('linear backoff', () => {
      const config = { backoff: 'linear', initialDelayMs: 1000, maxDelayMs: 300000 };

      it('attempt 1 returns ~1000ms', () => {
        const delay = calculateNextDelay(1, config);
        expect(delay).toBeGreaterThanOrEqual(1000);
        expect(delay).toBeLessThanOrEqual(1250);
      });

      it('attempt 2 returns ~2000ms', () => {
        const delay = calculateNextDelay(2, config);
        expect(delay).toBeGreaterThanOrEqual(2000);
        expect(delay).toBeLessThanOrEqual(2500);
      });

      it('attempt 3 returns ~3000ms', () => {
        const delay = calculateNextDelay(3, config);
        expect(delay).toBeGreaterThanOrEqual(3000);
        expect(delay).toBeLessThanOrEqual(3750);
      });

      it('caps at maxDelayMs', () => {
        const smallMax = { backoff: 'linear', initialDelayMs: 1000, maxDelayMs: 3000 };
        const delay = calculateNextDelay(10, smallMax); // 1000 * 10 = 10000, capped at 3000
        expect(delay).toBeGreaterThanOrEqual(3000);
        expect(delay).toBeLessThanOrEqual(3750);
      });
    });

    describe('fixed backoff', () => {
      const config = { backoff: 'fixed', initialDelayMs: 1000, maxDelayMs: 300000 };

      it('always returns exactly initialDelayMs regardless of attempt', () => {
        expect(calculateNextDelay(1, config)).toBe(1000);
        expect(calculateNextDelay(5, config)).toBe(1000);
        expect(calculateNextDelay(100, config)).toBe(1000);
      });
    });

    describe('default config', () => {
      it('uses defaults when config fields are missing', () => {
        const delay = calculateNextDelay(1, {});
        // defaults: exponential, 1000ms initial, 300000ms max
        expect(delay).toBeGreaterThanOrEqual(1000);
        expect(delay).toBeLessThanOrEqual(1250);
      });
    });
  });

  describe('shouldRetry', () => {
    it('returns true when attempt < maxAttempts', () => {
      expect(shouldRetry(1, 3)).toBe(true);
      expect(shouldRetry(2, 3)).toBe(true);
    });

    it('returns false when attempt >= maxAttempts', () => {
      expect(shouldRetry(3, 3)).toBe(false);
      expect(shouldRetry(4, 3)).toBe(false);
    });
  });

  describe('getNextAttemptTime', () => {
    beforeEach(() => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2025-01-01T00:00:00.000Z'));
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('returns a valid ISO 8601 string', () => {
      const config = { backoff: 'fixed', initialDelayMs: 5000, maxDelayMs: 300000 };
      const result = getNextAttemptTime(1, config);
      expect(result).toBe('2025-01-01T00:00:05.000Z');
    });

    it('returns a time in the future based on delay', () => {
      const config = { backoff: 'fixed', initialDelayMs: 60000, maxDelayMs: 300000 };
      const result = getNextAttemptTime(1, config);
      const resultDate = new Date(result);
      expect(resultDate.getTime()).toBe(Date.now() + 60000);
    });
  });
});
