import pino from 'pino';

const DEFAULT_REDACT_PATHS = ['*.secret', '*.password', '*.token'];

/**
 * Create a configured pino logger instance.
 * @param {object} [opts] - Options
 * @param {string} [opts.level] - Log level (defaults to HOOKPIPE_LOG_LEVEL env or 'info')
 * @param {string[]} [opts.redact] - Paths to redact
 * @param {object} [opts.stream] - Custom writable stream (for testing)
 * @returns {import('pino').Logger}
 */
export function createLogger(opts = {}) {
  const {
    level = process.env.HOOKPIPE_LOG_LEVEL || 'info',
    redact = DEFAULT_REDACT_PATHS,
    stream,
    ...rest
  } = opts;

  const config = {
    level,
    redact: {
      paths: redact,
      censor: '[Redacted]',
    },
    ...rest,
  };

  return stream ? pino(config, stream) : pino(config);
}

const logger = createLogger();

export default logger;
