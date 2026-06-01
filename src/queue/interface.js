/**
 * Abstract base class defining the queue contract for hookpipe.
 * All queue implementations (SQLite, PostgreSQL, etc.) must extend this class
 * and implement every method.
 */
export class QueueInterface {
  /**
   * Add a job to the queue.
   * @param {Object} job - The job to enqueue
   * @param {string} job.deliveryId - Unique delivery identifier
   * @param {string} job.destinationId - Target destination ID
   * @param {string} job.pipelineId - Pipeline this job belongs to
   * @param {Object} job.payload - The webhook payload body
   * @param {Object} job.headers - Original request headers
   * @param {number} job.maxAttempts - Maximum retry attempts allowed
   * @returns {Promise<Object>} The created job record
   */
  async enqueue(job) {
    throw new Error('QueueInterface.enqueue() not implemented');
  }

  /**
   * Fetch up to `limit` ready jobs (status=pending, next_attempt_at <= now).
   * @param {number} [limit=1] - Maximum number of jobs to dequeue
   * @returns {Promise<Array<Object>>} Array of job objects ready for processing
   */
  async dequeue(limit = 1) {
    throw new Error('QueueInterface.dequeue() not implemented');
  }

  /**
   * Mark a job as completed successfully.
   * @param {string} jobId - The job ID to acknowledge
   * @returns {Promise<void>}
   */
  async ack(jobId) {
    throw new Error('QueueInterface.ack() not implemented');
  }

  /**
   * Mark a job as failed and schedule a retry.
   * @param {string} jobId - The job ID that failed
   * @param {Error} error - The error that occurred
   * @param {Date} nextAttemptAt - When to retry the job
   * @returns {Promise<void>}
   */
  async nack(jobId, error, nextAttemptAt) {
    throw new Error('QueueInterface.nack() not implemented');
  }

  /**
   * Move an exhausted job to the dead letter queue.
   * @param {string} jobId - The job ID to move
   * @param {Error} error - The final error
   * @returns {Promise<void>}
   */
  async moveToDeadLetter(jobId, error) {
    throw new Error('QueueInterface.moveToDeadLetter() not implemented');
  }

  /**
   * Return queue statistics.
   * @returns {Promise<{pending: number, processing: number, completed: number, failed: number, deadLetter: number}>}
   */
  async getStats() {
    throw new Error('QueueInterface.getStats() not implemented');
  }
}
