import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { initDatabase, closeDatabase } from '../../src/db/index.js';
import {
  insertDelivery,
  getDelivery,
  listDeliveries,
  updateDeliveryStatus,
  insertAttempt,
  getAttemptsByDelivery,
  insertDeadLetter,
  listDeadLetters,
  getDeadLetter,
  insertQueueJob,
  dequeueJobs,
  ackJob,
  nackJob,
  moveJobToDeadLetter,
  getJobsByDelivery,
  incrementStat,
  getStats,
} from '../../src/db/queries.js';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

let db;
let dbPath;

beforeAll(() => {
  dbPath = path.join(os.tmpdir(), `hookpipe-test-queries-${Date.now()}.db`);
  db = initDatabase(dbPath);
});

afterAll(() => {
  closeDatabase(db);
  fs.unlinkSync(dbPath);
});

describe('Deliveries', () => {
  const delivery = {
    id: 'del_01',
    pipelineId: 'pipe_a',
    payload: { event: 'push', repo: 'hookpipe' },
    headers: { 'content-type': 'application/json' },
    sourceIp: '127.0.0.1',
    status: 'pending',
  };

  it('insertDelivery + getDelivery round-trips correctly', () => {
    insertDelivery(db, delivery);
    const row = getDelivery(db, 'del_01');
    expect(row).not.toBeNull();
    expect(row.id).toBe('del_01');
    expect(row.pipeline_id).toBe('pipe_a');
    expect(row.payload).toEqual({ event: 'push', repo: 'hookpipe' });
    expect(row.headers).toEqual({ 'content-type': 'application/json' });
    expect(row.source_ip).toBe('127.0.0.1');
    expect(row.status).toBe('pending');
    expect(row.created_at).toBeDefined();
  });

  it('getDelivery returns null for non-existent id', () => {
    const row = getDelivery(db, 'nonexistent');
    expect(row).toBeNull();
  });

  it('updateDeliveryStatus changes status and updated_at', () => {
    // Force updated_at to a known past value so the update is distinguishable
    db.prepare("UPDATE deliveries SET updated_at = '2000-01-01 00:00:00' WHERE id = 'del_01'").run();
    const before = getDelivery(db, 'del_01');
    updateDeliveryStatus(db, 'del_01', 'delivered');
    const after = getDelivery(db, 'del_01');
    expect(after.status).toBe('delivered');
    expect(after.updated_at).not.toBe(before.updated_at);
  });

  it('listDeliveries filters by pipelineId', () => {
    insertDelivery(db, { ...delivery, id: 'del_02', pipelineId: 'pipe_b' });
    const rows = listDeliveries(db, { pipelineId: 'pipe_a' });
    expect(rows.every(r => r.pipeline_id === 'pipe_a')).toBe(true);
  });

  it('listDeliveries filters by status', () => {
    const rows = listDeliveries(db, { status: 'delivered' });
    expect(rows.every(r => r.status === 'delivered')).toBe(true);
    expect(rows.length).toBeGreaterThan(0);
  });

  it('listDeliveries supports limit and offset', () => {
    insertDelivery(db, { ...delivery, id: 'del_03', pipelineId: 'pipe_a' });
    insertDelivery(db, { ...delivery, id: 'del_04', pipelineId: 'pipe_a' });
    const page1 = listDeliveries(db, { pipelineId: 'pipe_a', limit: 2, offset: 0 });
    const page2 = listDeliveries(db, { pipelineId: 'pipe_a', limit: 2, offset: 2 });
    expect(page1.length).toBe(2);
    expect(page2.length).toBeGreaterThan(0);
    expect(page1[0].id).not.toBe(page2[0].id);
  });

  it('listDeliveries filters by since (ISO date)', () => {
    const past = '2000-01-01T00:00:00.000Z';
    const rows = listDeliveries(db, { since: past });
    expect(rows.length).toBeGreaterThan(0);
    const future = '2099-01-01T00:00:00.000Z';
    const empty = listDeliveries(db, { since: future });
    expect(empty.length).toBe(0);
  });
});

describe('Delivery Attempts', () => {
  const attempt = {
    id: 'att_01',
    deliveryId: 'del_01',
    destinationId: 'dest_x',
    attemptNumber: 1,
    status: 'success',
    statusCode: 200,
    responseBody: '{"ok":true}',
    errorMessage: null,
    durationMs: 42,
  };

  it('insertAttempt + getAttemptsByDelivery round-trips', () => {
    insertAttempt(db, attempt);
    insertAttempt(db, { ...attempt, id: 'att_02', attemptNumber: 2, status: 'failed', statusCode: 500 });
    const rows = getAttemptsByDelivery(db, 'del_01');
    expect(rows.length).toBe(2);
    expect(rows[0].attempt_number).toBe(1);
    expect(rows[1].attempt_number).toBe(2);
  });

  it('getAttemptsByDelivery returns empty array for unknown delivery', () => {
    const rows = getAttemptsByDelivery(db, 'nonexistent');
    expect(rows).toEqual([]);
  });
});

describe('Dead Letters', () => {
  const deadLetter = {
    id: 'dl_01',
    deliveryId: 'del_01',
    pipelineId: 'pipe_a',
    destinationId: 'dest_x',
    payload: { event: 'push' },
    headers: { 'x-hook': '1' },
    errorMessage: 'max retries exceeded',
    attempts: 3,
  };

  it('insertDeadLetter + getDeadLetter round-trips', () => {
    insertDeadLetter(db, deadLetter);
    const row = getDeadLetter(db, 'dl_01');
    expect(row).not.toBeNull();
    expect(row.id).toBe('dl_01');
    expect(row.payload).toEqual({ event: 'push' });
    expect(row.headers).toEqual({ 'x-hook': '1' });
    expect(row.error_message).toBe('max retries exceeded');
    expect(row.attempts).toBe(3);
  });

  it('getDeadLetter returns null for unknown id', () => {
    expect(getDeadLetter(db, 'nope')).toBeNull();
  });

  it('listDeadLetters filters by pipelineId with pagination', () => {
    insertDeadLetter(db, { ...deadLetter, id: 'dl_02', pipelineId: 'pipe_b' });
    insertDeadLetter(db, { ...deadLetter, id: 'dl_03', pipelineId: 'pipe_a' });
    const rows = listDeadLetters(db, { pipelineId: 'pipe_a' });
    expect(rows.every(r => r.pipeline_id === 'pipe_a')).toBe(true);
    const limited = listDeadLetters(db, { limit: 1 });
    expect(limited.length).toBe(1);
  });
});

describe('Queue Jobs', () => {
  const job = {
    id: 'job_01',
    deliveryId: 'del_01',
    destinationId: 'dest_x',
    pipelineId: 'pipe_a',
    payload: { event: 'push' },
    headers: { 'content-type': 'application/json' },
    maxAttempts: 3,
  };

  it('insertQueueJob creates a pending job', () => {
    insertQueueJob(db, job);
    const rows = getJobsByDelivery(db, 'del_01');
    const inserted = rows.find(r => r.id === 'job_01');
    expect(inserted).toBeDefined();
    expect(inserted.status).toBe('pending');
    expect(inserted.attempts).toBe(0);
    expect(inserted.max_attempts).toBe(3);
    expect(inserted.payload).toEqual({ event: 'push' });
  });

  it('dequeueJobs locks pending jobs and returns them', () => {
    const dequeued = dequeueJobs(db, 10, 'worker_1');
    expect(dequeued.length).toBeGreaterThan(0);
    const j = dequeued.find(r => r.id === 'job_01');
    expect(j.status).toBe('processing');
    expect(j.locked_by).toBe('worker_1');
    expect(j.locked_at).toBeDefined();
  });

  it('dequeueJobs does not return already-locked jobs', () => {
    const dequeued = dequeueJobs(db, 10, 'worker_2');
    const j = dequeued.find(r => r.id === 'job_01');
    expect(j).toBeUndefined();
  });

  it('ackJob sets status to completed', () => {
    ackJob(db, 'job_01');
    const rows = getJobsByDelivery(db, 'del_01');
    const j = rows.find(r => r.id === 'job_01');
    expect(j.status).toBe('completed');
  });

  it('nackJob increments attempts, resets lock, sets next_attempt_at', () => {
    insertQueueJob(db, { ...job, id: 'job_02' });
    dequeueJobs(db, 1, 'worker_1');
    const nextAt = '2099-01-01T00:00:00.000Z';
    nackJob(db, 'job_02', 'timeout', nextAt);
    const rows = getJobsByDelivery(db, 'del_01');
    const j = rows.find(r => r.id === 'job_02');
    expect(j.status).toBe('pending');
    expect(j.attempts).toBe(1);
    expect(j.error_message).toBe('timeout');
    expect(j.next_attempt_at).toBe(nextAt);
    expect(j.locked_at).toBeNull();
    expect(j.locked_by).toBeNull();
  });

  it('moveJobToDeadLetter sets status to dead_letter', () => {
    insertQueueJob(db, { ...job, id: 'job_03' });
    moveJobToDeadLetter(db, 'job_03');
    const rows = getJobsByDelivery(db, 'del_01');
    const j = rows.find(r => r.id === 'job_03');
    expect(j.status).toBe('dead_letter');
  });

  it('getJobsByDelivery returns all jobs for a delivery', () => {
    const rows = getJobsByDelivery(db, 'del_01');
    expect(rows.length).toBe(3);
  });
});

describe('Pipeline Stats', () => {
  it('incrementStat upserts and increments total_received', () => {
    incrementStat(db, 'pipe_stats_1', 'total_received');
    const stats = getStats(db, 'pipe_stats_1');
    expect(stats.total_received).toBe(1);
    expect(stats.last_received_at).toBeDefined();
  });

  it('incrementStat increments existing value', () => {
    incrementStat(db, 'pipe_stats_1', 'total_received');
    incrementStat(db, 'pipe_stats_1', 'total_received');
    const stats = getStats(db, 'pipe_stats_1');
    expect(stats.total_received).toBe(3);
  });

  it('incrementStat works for total_delivered', () => {
    incrementStat(db, 'pipe_stats_1', 'total_delivered');
    const stats = getStats(db, 'pipe_stats_1');
    expect(stats.total_delivered).toBe(1);
  });

  it('incrementStat works for total_failed', () => {
    incrementStat(db, 'pipe_stats_1', 'total_failed');
    const stats = getStats(db, 'pipe_stats_1');
    expect(stats.total_failed).toBe(1);
  });

  it('incrementStat works for total_filtered', () => {
    incrementStat(db, 'pipe_stats_1', 'total_filtered');
    const stats = getStats(db, 'pipe_stats_1');
    expect(stats.total_filtered).toBe(1);
  });

  it('getStats returns null for unknown pipeline', () => {
    expect(getStats(db, 'nonexistent')).toBeNull();
  });
});
