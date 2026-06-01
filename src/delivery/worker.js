import { ulid } from 'ulid';
import { calculateNextDelay, shouldRetry, getNextAttemptTime } from './retry.js';
import { insertAttempt, updateDeliveryStatus, incrementStat } from '../db/queries.js';

const DEFAULT_CONFIG = {
  pollIntervalMs: 1000,
  concurrency: 5,
};

const DEFAULT_RETRY_CONFIG = {
  maxAttempts: 3,
  backoff: 'exponential',
  initialDelayMs: 1000,
  maxDelayMs: 300000,
};

export class DeliveryWorker {
  #queue;
  #db;
  #destinationRegistry;
  #logger;
  #config;
  #getPipeline;
  #interval = null;
  #isPolling = false;

  constructor({ queue, db, destinationRegistry, logger, config = {}, getPipeline }) {
    if (typeof getPipeline !== 'function') {
      throw new Error('DeliveryWorker requires getPipeline(pipelineId)');
    }

    this.#queue = queue;
    this.#db = db;
    this.#destinationRegistry = destinationRegistry;
    this.#logger = logger;
    this.#config = { ...DEFAULT_CONFIG, ...config };
    this.#getPipeline = getPipeline;
  }

  start() {
    if (this.#interval) {
      return;
    }

    this.#interval = setInterval(() => {
      this.#poll().catch((error) => {
        this.#logger?.error?.({ error }, 'delivery worker poll failed');
      });
    }, this.#config.pollIntervalMs);
  }

  stop() {
    if (!this.#interval) {
      return;
    }

    clearInterval(this.#interval);
    this.#interval = null;
  }

  async #poll() {
    if (this.#isPolling) {
      return;
    }

    this.#isPolling = true;
    try {
      const jobs = await this.#queue.dequeue(this.#config.concurrency);
      await Promise.all(jobs.map((job) => this.#processJob(job)));
    } finally {
      this.#isPolling = false;
    }
  }

  async #processJob(job) {
    const startedAt = Date.now();
    const pipeline = await this.#getPipeline(job.pipeline_id);
    const destConfig = getDestinationConfig(pipeline, job.destination_id);
    const retryConfig = getRetryConfig(pipeline);
    const adapter = this.#destinationRegistry.getAdapter(destConfig.type);
    const payload = typeof job.payload === 'string' ? JSON.parse(job.payload) : job.payload;
    const headers = typeof job.headers === 'string' ? JSON.parse(job.headers) : job.headers;
    const context = {
      deliveryId: job.delivery_id,
      pipelineId: job.pipeline_id,
      attempt: job.attempts,
      headers,
    };

    try {
      const response = await adapter.send(payload, destConfig, context);
      const durationMs = Date.now() - startedAt;

      if (response?.success === false) {
        const error = new Error(response.error || `HTTP ${response.statusCode}`);
        error.statusCode = response.statusCode;
        error.responseBody = response.responseBody;
        insertAttempt(this.#db, {
          id: ulid(),
          deliveryId: job.delivery_id,
          destinationId: destConfig.id ?? destConfig.type,
          attemptNumber: job.attempts,
          status: 'failure',
          statusCode: response.statusCode ?? null,
          responseBody: response.responseBody ?? null,
          errorMessage: error.message,
          durationMs,
        });
        await this.#handleRetryOrDlq(job, destConfig, retryConfig, error);
        return;
      }

      await this.#queue.ack(job.id);
      insertAttempt(this.#db, {
        id: ulid(),
        deliveryId: job.delivery_id,
        destinationId: destConfig.id ?? destConfig.type,
        attemptNumber: job.attempts,
        status: 'success',
        statusCode: response?.statusCode ?? null,
        responseBody: response?.responseBody ?? null,
        errorMessage: null,
        durationMs,
      });
      updateDeliveryStatus(this.#db, job.delivery_id, 'delivered');
      incrementStat(this.#db, job.pipeline_id, 'total_delivered');
    } catch (error) {
      const durationMs = Date.now() - startedAt;
      insertAttempt(this.#db, {
        id: ulid(),
        deliveryId: job.delivery_id,
        destinationId: destConfig.id ?? destConfig.type,
        attemptNumber: job.attempts,
        status: 'failure',
        statusCode: null,
        responseBody: null,
        errorMessage: error instanceof Error ? error.message : String(error),
        durationMs,
      });
      await this.#handleRetryOrDlq(job, destConfig, retryConfig, error);
    }
  }

  async #handleRetryOrDlq(job, destConfig, retryConfig, error) {
    // If on_failure is 'log', just log and mark completed (no retry, no DLQ)
    if (destConfig.on_failure === 'log') {
      await this.#queue.ack(job.id);
      this.#logger?.warn?.({ deliveryId: job.delivery_id, error: error.message }, 'delivery failed, on_failure=log, not retrying');
      incrementStat(this.#db, job.pipeline_id, 'total_failed');
      return;
    }

    if (shouldRetry(job.attempts, retryConfig.maxAttempts)) {
      const nextAttemptAt = getNextAttemptTime(job.attempts, retryConfig);
      await this.#queue.nack(job.id, error, nextAttemptAt);
      return;
    }

    await this.#queue.moveToDeadLetter(job.id, error);
    updateDeliveryStatus(this.#db, job.delivery_id, 'dead_letter');
    incrementStat(this.#db, job.pipeline_id, 'total_failed');
  }
}

function getDestinationConfig(pipeline, destinationId) {
  // Support both array-based destinations and single destination config
  if (Array.isArray(pipeline?.destinations)) {
    const dest = destinationId
      ? pipeline.destinations.find((d) => d.id === destinationId)
      : pipeline.destinations[0];
    if (!dest?.type) {
      throw new Error(`Pipeline ${pipeline?.id ?? 'unknown'} destination '${destinationId}' not found or missing type`);
    }
    return dest;
  }
  const destConfig = pipeline?.destination ?? pipeline?.destConfig ?? pipeline?.destinationConfig;
  if (!destConfig?.type) {
    throw new Error(`Pipeline ${pipeline?.id ?? 'unknown'} is missing destination config`);
  }
  return destConfig;
}

function getRetryConfig(pipeline) {
  const raw = pipeline?.retry ?? pipeline?.retryConfig ?? {};
  return {
    ...DEFAULT_RETRY_CONFIG,
    maxAttempts: raw.maxAttempts ?? raw.max_attempts ?? DEFAULT_RETRY_CONFIG.maxAttempts,
    backoff: raw.backoff ?? DEFAULT_RETRY_CONFIG.backoff,
    initialDelayMs: raw.initialDelayMs ?? raw.initial_delay_ms ?? DEFAULT_RETRY_CONFIG.initialDelayMs,
    maxDelayMs: raw.maxDelayMs ?? raw.max_delay_ms ?? DEFAULT_RETRY_CONFIG.maxDelayMs,
  };
}
