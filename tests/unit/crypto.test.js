import { describe, it, expect } from 'vitest';
import crypto from 'node:crypto';
import { timingSafeCompare, computeHmac, verifySignature } from '../../src/utils/crypto.js';

// Test fixtures - real webhook signature formats
const SECRET = 'whsec_test_secret_key_123';
const PAYLOAD = '{"event":"push","ref":"refs/heads/main"}';

function makeGitHubSignature(secret, payload) {
  return 'sha256=' + crypto.createHmac('sha256', secret).update(payload).digest('hex');
}

function makeStripeSignature(secret, payload, timestamp) {
  const signedPayload = `${timestamp}.${payload}`;
  const sig = crypto.createHmac('sha256', secret).update(signedPayload).digest('hex');
  return `t=${timestamp},v1=${sig}`;
}

describe('timingSafeCompare', () => {
  it('returns true for identical strings', () => {
    expect(timingSafeCompare('abc123', 'abc123')).toBe(true);
  });

  it('returns false for different strings', () => {
    expect(timingSafeCompare('abc123', 'xyz789')).toBe(false);
  });

  it('returns false for different length strings', () => {
    expect(timingSafeCompare('short', 'muchlongerstring')).toBe(false);
  });

  it('returns false for empty vs non-empty', () => {
    expect(timingSafeCompare('', 'notempty')).toBe(false);
  });
});

describe('computeHmac', () => {
  it('computes sha256 HMAC hex digest', () => {
    const expected = crypto.createHmac('sha256', SECRET).update(PAYLOAD).digest('hex');
    expect(computeHmac('sha256', SECRET, PAYLOAD)).toBe(expected);
  });

  it('computes sha1 HMAC hex digest', () => {
    const expected = crypto.createHmac('sha1', SECRET).update(PAYLOAD).digest('hex');
    expect(computeHmac('sha1', SECRET, PAYLOAD)).toBe(expected);
  });

  it('handles Buffer payload', () => {
    const buf = Buffer.from(PAYLOAD);
    const expected = crypto.createHmac('sha256', SECRET).update(buf).digest('hex');
    expect(computeHmac('sha256', SECRET, buf)).toBe(expected);
  });
});

describe('verifySignature', () => {
  describe('GitHub webhook format (sha256=<hex>)', () => {
    const signature = makeGitHubSignature(SECRET, PAYLOAD);

    it('verifies valid GitHub signature', () => {
      expect(verifySignature({
        algorithm: 'sha256',
        secret: SECRET,
        payload: PAYLOAD,
        signature,
        prefix: 'sha256=',
      })).toBe(true);
    });

    it('rejects tampered payload', () => {
      expect(verifySignature({
        algorithm: 'sha256',
        secret: SECRET,
        payload: PAYLOAD + 'tampered',
        signature,
        prefix: 'sha256=',
      })).toBe(false);
    });

    it('rejects wrong secret', () => {
      expect(verifySignature({
        algorithm: 'sha256',
        secret: 'wrong_secret',
        payload: PAYLOAD,
        signature,
        prefix: 'sha256=',
      })).toBe(false);
    });
  });

  describe('Stripe webhook format (t=<ts>,v1=<hex>)', () => {
    const timestamp = '1614556828';
    const stripeSecret = 'whsec_stripe_test';
    const signedPayload = `${timestamp}.${PAYLOAD}`;
    const expectedSig = crypto.createHmac('sha256', stripeSecret).update(signedPayload).digest('hex');

    it('verifies valid Stripe signature (extracted v1 value)', () => {
      // Stripe sends t=<ts>,v1=<sig> — caller extracts v1 value
      expect(verifySignature({
        algorithm: 'sha256',
        secret: stripeSecret,
        payload: signedPayload,
        signature: `v1=${expectedSig}`,
        prefix: 'v1=',
      })).toBe(true);
    });

    it('rejects tampered Stripe payload', () => {
      expect(verifySignature({
        algorithm: 'sha256',
        secret: stripeSecret,
        payload: `${timestamp}.tampered`,
        signature: `v1=${expectedSig}`,
        prefix: 'v1=',
      })).toBe(false);
    });
  });

  describe('without prefix', () => {
    it('verifies raw hex signature without prefix', () => {
      const rawSig = crypto.createHmac('sha256', SECRET).update(PAYLOAD).digest('hex');
      expect(verifySignature({
        algorithm: 'sha256',
        secret: SECRET,
        payload: PAYLOAD,
        signature: rawSig,
      })).toBe(true);
    });
  });
});
