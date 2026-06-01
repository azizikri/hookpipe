import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { initDatabase, runMigrations, closeDatabase } from '../../src/db/index.js';

describe('Database Initialization', () => {
  let dbPath;
  let db;

  beforeEach(() => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hookpipe-test-'));
    dbPath = path.join(tmpDir, 'data', 'test.db');
  });

  afterEach(() => {
    if (db) {
      try { closeDatabase(db); } catch {}
      db = null;
    }
    // Clean up temp files
    const dir = path.dirname(path.dirname(dbPath));
    fs.rmSync(dir, { recursive: true, force: true });
  });

  describe('initDatabase', () => {
    it('creates data directory if it does not exist', () => {
      db = initDatabase(dbPath);
      expect(fs.existsSync(path.dirname(dbPath))).toBe(true);
    });

    it('enables WAL mode', () => {
      db = initDatabase(dbPath);
      const result = db.pragma('journal_mode', { simple: true });
      expect(result).toBe('wal');
    });

    it('enables foreign keys', () => {
      db = initDatabase(dbPath);
      const result = db.pragma('foreign_keys', { simple: true });
      expect(result).toBe(1);
    });

    it('runs migrations and creates all tables from 001_initial.sql', () => {
      db = initDatabase(dbPath);
      const tables = db.prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name"
      ).all().map(r => r.name);

      expect(tables).toContain('migrations');
      expect(tables).toContain('deliveries');
      expect(tables).toContain('delivery_attempts');
      expect(tables).toContain('dead_letters');
      expect(tables).toContain('queue_jobs');
      expect(tables).toContain('pipeline_stats');
    });

    it('records migration in migrations table', () => {
      db = initDatabase(dbPath);
      const rows = db.prepare('SELECT name FROM migrations').all();
      expect(rows.length).toBeGreaterThan(0);
      expect(rows[0].name).toBe('001_initial.sql');
    });
  });

  describe('runMigrations (idempotency)', () => {
    it('re-running migrations does not throw', () => {
      db = initDatabase(dbPath);
      // Run again - should be idempotent
      expect(() => runMigrations(db)).not.toThrow();
    });

    it('does not duplicate migration records on re-run', () => {
      db = initDatabase(dbPath);
      runMigrations(db);
      const rows = db.prepare('SELECT name FROM migrations').all();
      const unique = new Set(rows.map(r => r.name));
      expect(rows.length).toBe(unique.size);
    });
  });

  describe('closeDatabase', () => {
    it('closes without error', () => {
      db = initDatabase(dbPath);
      expect(() => closeDatabase(db)).not.toThrow();
      db = null; // prevent afterEach double-close
    });
  });
});
