/**
 * Base destination adapter class.
 *
 * All destination adapters (HTTP, SQS, etc.) must extend this class
 * and implement the `type` getter and `send()` method.
 *
 * @abstract
 */
export class DestinationAdapter {
  /**
   * The adapter type identifier (e.g., 'http', 'sqs').
   * Subclasses MUST override this getter.
   *
   * @returns {string}
   */
  get type() {
    throw new Error('Not implemented');
  }

  /**
   * Send a payload to the destination.
   *
   * @param {object} payload - The transformed webhook payload.
   * @param {object} destConfig - Destination configuration from pipeline YAML
   *   (url, method, headers, body_template, timeout_ms, etc.).
   * @param {object} context - Delivery context.
   * @param {string} context.deliveryId - Unique delivery ID.
   * @param {string} context.pipelineId - Pipeline identifier.
   * @param {number} context.attempt - Current attempt number.
   * @param {object} context.headers - Original webhook headers.
   * @returns {Promise<{success: boolean, statusCode?: number, responseBody?: string, error?: string, durationMs: number}>}
   */
  async send(payload, destConfig, context) {
    throw new Error('Not implemented');
  }

  /**
   * Optional health check for the destination.
   * Subclasses may override for active health probing.
   *
   * @param {object} destConfig - Destination configuration.
   * @returns {Promise<{healthy: boolean, error?: string}>}
   */
  async healthCheck(destConfig) {
    return { healthy: true };
  }
}
