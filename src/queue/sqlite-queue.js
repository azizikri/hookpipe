import { QueueInterface } from './interface.js';
import { insertQueueJob, dequeueJobs, ackJob, nackJob, moveJobToDeadLetter, insertDeadLetter } from '../db/queries.js';
import { ulid } from 'ulid';

export class SqliteQueue extends QueueInterface {
  #db;
  #config;

  constructor(db, config = {}) {
    super();
    this.#db = db;
    this.#config = {
      pollIntervalMs: config.pollIntervalMs ?? 1000,
      concurrency: config.concurrency ?? 5,
    };
  }

  async enqueue(job) {
    const id = ulid();
    insertQueueJob(this.#db, {
      id,
      deliveryId: job.deliveryId,
      destinationId: job.destinationId,
      pipelineId: job.pipelineId,
      payload: job.payload,
      headers: job.headers,
      maxAttempts: job.maxAttempts,
    });
    return { id, ...job };
  }

  async dequeue(limit = 1) {
    const lockId = ulid();
    return dequeueJobs(this.#db, limit, lockId);
  }

  async ack(jobId) {
    ackJob(this.#db, jobId);
  }

  async nack(jobId, error, nextAttemptAt) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    nackJob(this.#db, jobId, errorMessage, nextAttemptAt);
  }

  async moveToDeadLetter(jobId, error) {
    const job = this.#db.prepare('SELECT * FROM queue_jobs WHERE id = ?').get(jobId);
    if (!job) throw new Error(`Job not found: ${jobId}`);

    const errorMessage = error instanceof Error ? error.message : String(error);

    insertDeadLetter(this.#db, {
      id: ulid(),
      deliveryId: job.delivery_id,
      pipelineId: job.pipeline_id,
      destinationId: job.destination_id,
      payload: JSON.parse(job.payload),
      headers: JSON.parse(job.headers),
      errorMessage,
      attempts: job.attempts,
    });

    moveJobToDeadLetter(this.#db, jobId);
  }

  async getStats() {
    const rows = this.#db.prepare(`
      SELECT status, COUNT(*) as count FROM queue_jobs GROUP BY status
    `).all();

    const stats = { pending: 0, processing: 0, completed: 0, failed: 0, deadLetter: 0 };
    for (const row of rows) {
      switch (row.status) {
        case 'pending': stats.pending = row.count; break;
        case 'processing': stats.processing = row.count; break;
        case 'completed': stats.completed = row.count; break;
        case 'failed': stats.failed = row.count; break;
        case 'dead_letter': stats.deadLetter = row.count; break;
      }
    }
    return stats;
  }
}
