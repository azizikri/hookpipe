import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Constant-time string comparison to prevent timing attacks.
 */
export function timingSafeCompare(a, b) {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);

  if (bufA.length !== bufB.length) {
    // Still do a comparison to avoid leaking length info via timing
    timingSafeEqual(bufA, bufA);
    return false;
  }

  return timingSafeEqual(bufA, bufB);
}

/**
 * Compute HMAC hex digest for a given algorithm, secret, and payload.
 */
export function computeHmac(algorithm, secret, payload) {
  return createHmac(algorithm, secret).update(payload).digest('hex');
}

/**
 * Verify a webhook signature against a computed HMAC.
 *
 * @param {object} opts
 * @param {'sha256'|'sha1'} opts.algorithm
 * @param {string} opts.secret
 * @param {string|Buffer} opts.payload
 * @param {string} opts.signature - The signature header value
 * @param {string} [opts.prefix] - Prefix to strip (e.g., 'sha256=')
 * @returns {boolean}
 */
export function verifySignature({ algorithm, secret, payload, signature, prefix }) {
  const expected = computeHmac(algorithm, secret, payload);
  const actual = prefix && signature.startsWith(prefix)
    ? signature.slice(prefix.length)
    : signature;

  return timingSafeCompare(expected, actual);
}
