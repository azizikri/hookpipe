const DEFAULTS = {
  backoff: 'exponential',
  initialDelayMs: 1000,
  maxDelayMs: 300000,
};

/**
 * Calculate the delay before the next retry attempt.
 * @param {number} attempt - Current attempt number (1-based)
 * @param {object} config - Retry configuration
 * @returns {number} Delay in milliseconds (integer)
 */
export function calculateNextDelay(attempt, config = {}) {
  const backoff = config.backoff || DEFAULTS.backoff;
  const initialDelayMs = config.initialDelayMs ?? DEFAULTS.initialDelayMs;
  const maxDelayMs = config.maxDelayMs ?? DEFAULTS.maxDelayMs;

  let baseDelay;

  switch (backoff) {
    case 'linear':
      baseDelay = Math.min(initialDelayMs * attempt, maxDelayMs);
      return baseDelay + jitter(baseDelay);

    case 'fixed':
      return initialDelayMs;

    case 'exponential':
    default:
      baseDelay = Math.min(initialDelayMs * 2 ** (attempt - 1), maxDelayMs);
      return baseDelay + jitter(baseDelay);
  }
}

/**
 * Determine if another retry should be attempted.
 * @param {number} attempt - Current attempt number
 * @param {number} maxAttempts - Maximum allowed attempts
 * @returns {boolean}
 */
export function shouldRetry(attempt, maxAttempts) {
  return attempt < maxAttempts;
}

/**
 * Get the ISO 8601 timestamp for when the next attempt should occur.
 * @param {number} attempt - Current attempt number
 * @param {object} config - Retry configuration
 * @returns {string} ISO 8601 date string
 */
export function getNextAttemptTime(attempt, config) {
  const delay = calculateNextDelay(attempt, config);
  return new Date(Date.now() + delay).toISOString();
}

/**
 * Add random jitter of 0-25% of the base delay.
 * @param {number} baseDelay
 * @returns {number} Integer jitter value
 */
function jitter(baseDelay) {
  return Math.floor(Math.random() * baseDelay * 0.25);
}
