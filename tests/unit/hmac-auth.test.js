import { describe, it, expect } from 'vitest';
import { createHmac } from 'node:crypto';
import { verifyWebhookAuth } from '../../src/auth/hmac.js';
import fixture from '../fixtures/github-webhook.json' with { type: 'json' };

describe('verifyWebhookAuth', () => {
  it('returns valid when no auth config is provided', () => {
    const result = verifyWebhookAuth('any body', {}, null);
    expect(result).toEqual({ valid: true });
  });

  it('returns valid when authConfig is undefined', () => {
    const result = verifyWebhookAuth('any body', {}, undefined);
    expect(result).toEqual({ valid: true });
  });

  it('validates a correct GitHub SHA-256 signature', () => {
    const result = verifyWebhookAuth(fixture.payload, fixture.headers, {
      type: 'hmac-sha256',
      header: 'x-hub-signature-256',
      secret: fixture.secret,
    });
    expect(result).toEqual({ valid: true });
  });

  it('rejects a tampered payload', () => {
    const result = verifyWebhookAuth('{"tampered":true}', fixture.headers, {
      type: 'hmac-sha256',
      header: 'x-hub-signature-256',
      secret: fixture.secret,
    });
    expect(result).toEqual({ valid: false, error: 'Invalid signature' });
  });

  it('returns error when signature header is missing', () => {
    const headers = { 'content-type': 'application/json' };
    const result = verifyWebhookAuth(fixture.payload, headers, {
      type: 'hmac-sha256',
      header: 'x-hub-signature-256',
      secret: fixture.secret,
    });
    expect(result).toEqual({ valid: false, error: 'Missing signature header' });
  });

  it('supports HMAC-SHA1 for legacy webhooks', () => {
    const payload = '{"event":"charge.completed"}';
    const secret = 'whsec_legacy';
    const sig = 'sha1=' + createHmac('sha1', secret).update(payload).digest('hex');
    const headers = { 'x-webhook-signature': sig };

    const result = verifyWebhookAuth(payload, headers, {
      type: 'hmac-sha1',
      header: 'x-webhook-signature',
      secret,
    });
    expect(result).toEqual({ valid: true });
  });

  it('performs case-insensitive header lookup', () => {
    const headers = { 'X-Hub-Signature-256': fixture.headers['x-hub-signature-256'] };
    const result = verifyWebhookAuth(fixture.payload, headers, {
      type: 'hmac-sha256',
      header: 'x-hub-signature-256',
      secret: fixture.secret,
    });
    expect(result).toEqual({ valid: true });
  });
});

describe('verifyWebhookAuth - Stripe', () => {
  const secret = 'whsec_test_stripe_secret';
  const payload = '{"id":"evt_123","type":"charge.succeeded"}';
  const timestamp = '1614556828';
  const signedPayload = `${timestamp}.${payload}`;
  const validSig = createHmac('sha256', secret).update(signedPayload).digest('hex');

  const stripeConfig = {
    type: 'stripe',
    header: 'stripe-signature',
    secret,
  };

  it('validates a correct Stripe signature', () => {
    const headers = { 'stripe-signature': `t=${timestamp},v1=${validSig}` };
    const result = verifyWebhookAuth(payload, headers, stripeConfig);
    expect(result).toEqual({ valid: true });
  });

  it('validates when multiple v1 signatures are present', () => {
    const headers = { 'stripe-signature': `t=${timestamp},v1=invalid_sig,v1=${validSig}` };
    const result = verifyWebhookAuth(payload, headers, stripeConfig);
    expect(result).toEqual({ valid: true });
  });

  it('rejects a tampered payload', () => {
    const headers = { 'stripe-signature': `t=${timestamp},v1=${validSig}` };
    const result = verifyWebhookAuth('{"tampered":true}', headers, stripeConfig);
    expect(result).toEqual({ valid: false, error: 'Invalid signature' });
  });

  it('rejects when signature header is missing', () => {
    const result = verifyWebhookAuth(payload, {}, stripeConfig);
    expect(result).toEqual({ valid: false, error: 'Missing signature header' });
  });

  it('rejects invalid Stripe signature format (no timestamp)', () => {
    const headers = { 'stripe-signature': `v1=${validSig}` };
    const result = verifyWebhookAuth(payload, headers, stripeConfig);
    expect(result).toEqual({ valid: false, error: 'Invalid Stripe signature format' });
  });

  it('rejects invalid Stripe signature format (no v1)', () => {
    const headers = { 'stripe-signature': `t=${timestamp}` };
    const result = verifyWebhookAuth(payload, headers, stripeConfig);
    expect(result).toEqual({ valid: false, error: 'Invalid Stripe signature format' });
  });

  it('rejects when all v1 signatures are wrong', () => {
    const headers = { 'stripe-signature': `t=${timestamp},v1=bad1,v1=bad2` };
    const result = verifyWebhookAuth(payload, headers, stripeConfig);
    expect(result).toEqual({ valid: false, error: 'Invalid signature' });
  });
});
