import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { initDatabase, closeDatabase } from '../../src/db/index.js';
import { SqliteQueue } from '../../src/queue/sqlite-queue.js';
import { insertDelivery } from '../../src/db/queries.js';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

function makeTempDb() {
  const dbPath = path.join(os.tmpdir(), `hookpipe-test-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
  return { dbPath, db: initDatabase(dbPath) };
}

function seedDelivery(db, id = 'del-001') {
  insertDelivery(db, { id, pipelineId: 'pipe-001', payload: {}, headers: {}, sourceIp: '127.0.0.1', status: 'queued' });
}

function makeJob(overrides = {}) {
  return {
    deliveryId: 'del-001',
    destinationId: 'dest-001',
    pipelineId: 'pipe-001',
    payload: { event: 'push', data: { id: 1 } },
    headers: { 'content-type': 'application/json' },
    maxAttempts: 3,
    ...overrides,
  };
}

describe('SqliteQueue', () => {
  let db;
  let dbPath;
  let queue;

  beforeEach(() => {
    const tmp = makeTempDb();
    db = tmp.db;
    dbPath = tmp.dbPath;
    queue = new SqliteQueue(db);
    seedDelivery(db, 'del-001');
  });

  afterEach(() => {
    closeDatabase(db);
    try { fs.unlinkSync(dbPath); } catch {}
    try { fs.unlinkSync(dbPath + '-wal'); } catch {}
    try { fs.unlinkSync(dbPath + '-shm'); } catch {}
  });

  describe('enqueue', () => {
    it('creates a job retrievable by dequeue', async () => {
      const job = makeJob();
      const created = await queue.enqueue(job);

      expect(created).toBeDefined();
      expect(created.id).toBeDefined();
      expect(created.deliveryId || created.delivery_id).toBe('del-001');

      const dequeued = await queue.dequeue(1);
      expect(dequeued).toHaveLength(1);
      expect(dequeued[0].delivery_id).toBe('del-001');
      expect(dequeued[0].destination_id).toBe('dest-001');
      expect(dequeued[0].payload).toEqual({ event: 'push', data: { id: 1 } });
    });
  });

  describe('dequeue', () => {
    it('returns empty array when no jobs', async () => {
      const result = await queue.dequeue(5);
      expect(result).toEqual([]);
    });

    it('dequeued jobs are locked and not re-dequeued', async () => {
      await queue.enqueue(makeJob());

      const first = await queue.dequeue(1);
      expect(first).toHaveLength(1);

      const second = await queue.dequeue(1);
      expect(second).toEqual([]);
    });
  });

  describe('ack', () => {
    it('marks job as completed', async () => {
      await queue.enqueue(makeJob());
      const [job] = await queue.dequeue(1);

      await queue.ack(job.id);

      const stats = await queue.getStats();
      expect(stats.completed).toBe(1);
      expect(stats.processing).toBe(0);
    });
  });

  describe('nack', () => {
    it('reschedules job with new next_attempt_at', async () => {
      await queue.enqueue(makeJob());
      const [job] = await queue.dequeue(1);

      const futureDate = new Date(Date.now() + 60000).toISOString();
      await queue.nack(job.id, 'connection timeout', futureDate);

      // Job should be pending again but not yet dequeue-able (future next_attempt_at)
      const stats = await queue.getStats();
      expect(stats.pending).toBe(1);
      expect(stats.processing).toBe(0);

      // Should not dequeue because next_attempt_at is in the future
      const dequeued = await queue.dequeue(1);
      expect(dequeued).toEqual([]);
    });
  });

  describe('moveToDeadLetter', () => {
    it('creates dead letter entry and marks job', async () => {
      await queue.enqueue(makeJob());
      const [job] = await queue.dequeue(1);

      await queue.moveToDeadLetter(job.id, 'max retries exceeded');

      const stats = await queue.getStats();
      expect(stats.deadLetter).toBe(1);
      expect(stats.processing).toBe(0);

      // Verify dead letter was actually inserted
      const dl = db.prepare('SELECT * FROM dead_letters WHERE delivery_id = ?').get('del-001');
      expect(dl).toBeDefined();
      expect(dl.error_message).toBe('max retries exceeded');
    });
  });

  describe('getStats', () => {
    it('returns correct counts for all statuses', async () => {
      // Seed deliveries for FK constraint
      seedDelivery(db, 'del-1');
      seedDelivery(db, 'del-2');
      seedDelivery(db, 'del-3');
      seedDelivery(db, 'del-4');
      // Enqueue 4 jobs
      await queue.enqueue(makeJob({ deliveryId: 'del-1' }));
      await queue.enqueue(makeJob({ deliveryId: 'del-2' }));
      await queue.enqueue(makeJob({ deliveryId: 'del-3' }));
      await queue.enqueue(makeJob({ deliveryId: 'del-4' }));

      // Dequeue 3 (now processing)
      const jobs = await queue.dequeue(3);

      // Ack one (completed)
      await queue.ack(jobs[0].id);

      // Nack one (back to pending, but future)
      const future = new Date(Date.now() + 60000).toISOString();
      await queue.nack(jobs[1].id, 'err', future);

      // Dead letter one
      await queue.moveToDeadLetter(jobs[2].id, 'fatal');

      const stats = await queue.getStats();
      // del-1: completed, del-2: pending (nacked), del-3: dead_letter, del-4: pending (never dequeued)
      expect(stats.pending).toBe(2);
      expect(stats.processing).toBe(0);
      expect(stats.completed).toBe(1);
      expect(stats.deadLetter).toBe(1);
    });
  });
});
