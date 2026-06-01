import { verifySignature, computeHmac, timingSafeCompare } from '../utils/crypto.js';

const TYPE_MAP = {
  'hmac-sha256': { algorithm: 'sha256', prefix: 'sha256=' },
  'hmac-sha1': { algorithm: 'sha1', prefix: 'sha1=' },
  'stripe': { algorithm: 'sha256', prefix: '' },
};

/**
 * Parse Stripe-Signature header format: t=<timestamp>,v1=<sig1>,v1=<sig2>
 */
function parseStripeSignature(headerValue) {
  const parts = headerValue.split(',');
  let timestamp = null;
  const signatures = [];
  for (const part of parts) {
    const [key, value] = part.split('=', 2);
    if (key === 't') timestamp = value;
    else if (key === 'v1') signatures.push(value);
  }
  return { timestamp, signatures };
}

/**
 * Verify Stripe webhook signature.
 * Stripe signs `${timestamp}.${rawBody}` with HMAC-SHA256.
 */
function verifyStripeAuth(rawBody, headers, authConfig) {
  const { header, secret } = authConfig;
  const headerLower = header.toLowerCase();
  const sigHeader = Object.entries(headers).find(
    ([key]) => key.toLowerCase() === headerLower
  )?.[1];

  if (!sigHeader) {
    return { valid: false, error: 'Missing signature header' };
  }

  const { timestamp, signatures } = parseStripeSignature(sigHeader);

  if (!timestamp || signatures.length === 0) {
    return { valid: false, error: 'Invalid Stripe signature format' };
  }

  const signedPayload = `${timestamp}.${rawBody}`;
  const expectedSig = computeHmac('sha256', secret, signedPayload);

  const isValid = signatures.some((sig) => timingSafeCompare(sig, expectedSig));

  if (!isValid) {
    return { valid: false, error: 'Invalid signature' };
  }

  return { valid: true };
}

/**
 * Verify webhook authentication via HMAC signature.
 *
 * @param {string|Buffer} rawBody - The raw request body
 * @param {object} headers - Request headers (keys may be any case)
 * @param {object|null|undefined} authConfig - Auth configuration from pipeline YAML
 * @returns {{ valid: boolean, error?: string }}
 */
export function verifyWebhookAuth(rawBody, headers, authConfig) {
  if (!authConfig) {
    return { valid: true };
  }

  const { type, header, secret } = authConfig;

  if (!TYPE_MAP[type]) {
    return { valid: false, error: `Unknown auth type: ${type}` };
  }

  // Stripe has its own verification flow
  if (type === 'stripe') {
    return verifyStripeAuth(rawBody, headers, authConfig);
  }

  const { algorithm, prefix } = TYPE_MAP[type];

  // Case-insensitive header lookup
  const headerLower = header.toLowerCase();
  const signature = Object.entries(headers).find(
    ([key]) => key.toLowerCase() === headerLower
  )?.[1];

  if (!signature) {
    return { valid: false, error: 'Missing signature header' };
  }

  const isValid = verifySignature({ algorithm, secret, payload: rawBody, signature, prefix });

  if (!isValid) {
    return { valid: false, error: 'Invalid signature' };
  }

  return { valid: true };
}
