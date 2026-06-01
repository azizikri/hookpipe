// --- Deliveries ---

export function insertDelivery(db, { id, pipelineId, payload, headers, sourceIp, status }) {
  const stmt = db.prepare(`
    INSERT INTO deliveries (id, pipeline_id, payload, headers, source_ip, status, received_at)
    VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
  `);
  stmt.run(id, pipelineId, JSON.stringify(payload), JSON.stringify(headers), sourceIp, status);
}

export function getDelivery(db, id) {
  const row = db.prepare('SELECT * FROM deliveries WHERE id = ?').get(id);
  if (!row) return null;
  row.payload = JSON.parse(row.payload);
  row.headers = JSON.parse(row.headers);
  return row;
}

export function listDeliveries(db, { pipelineId, status, limit = 50, offset = 0, since } = {}) {
  const conditions = [];
  const params = [];

  if (pipelineId) {
    conditions.push('pipeline_id = ?');
    params.push(pipelineId);
  }
  if (status) {
    conditions.push('status = ?');
    params.push(status);
  }
  if (since) {
    conditions.push('created_at >= ?');
    params.push(since);
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const sql = `SELECT * FROM deliveries ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`;
  params.push(limit, offset);

  const rows = db.prepare(sql).all(...params);
  return rows.map(row => {
    row.payload = JSON.parse(row.payload);
    row.headers = JSON.parse(row.headers);
    return row;
  });
}

export function updateDeliveryStatus(db, id, status) {
  db.prepare(`UPDATE deliveries SET status = ?, updated_at = datetime('now') WHERE id = ?`).run(status, id);
}

// --- Delivery Attempts ---

export function insertAttempt(db, { id, deliveryId, destinationId, attemptNumber, status, statusCode, responseBody, errorMessage, durationMs }) {
  db.prepare(`
    INSERT INTO delivery_attempts (id, delivery_id, destination_id, attempt_number, status, status_code, response_body, error_message, duration_ms)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, deliveryId, destinationId, attemptNumber, status, statusCode, responseBody, errorMessage, durationMs);
}

export function getAttemptsByDelivery(db, deliveryId) {
  return db.prepare('SELECT * FROM delivery_attempts WHERE delivery_id = ? ORDER BY attempt_number ASC').all(deliveryId);
}

// --- Dead Letters ---

export function insertDeadLetter(db, { id, deliveryId, pipelineId, destinationId, payload, headers, errorMessage, attempts }) {
  db.prepare(`
    INSERT INTO dead_letters (id, delivery_id, pipeline_id, destination_id, payload, headers, error_message, attempts)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, deliveryId, pipelineId, destinationId, JSON.stringify(payload), JSON.stringify(headers), errorMessage, attempts);
}

export function getDeadLetter(db, id) {
  const row = db.prepare('SELECT * FROM dead_letters WHERE id = ?').get(id);
  if (!row) return null;
  row.payload = JSON.parse(row.payload);
  row.headers = JSON.parse(row.headers);
  return row;
}

export function listDeadLetters(db, { pipelineId, limit = 50, offset = 0 } = {}) {
  const conditions = [];
  const params = [];

  if (pipelineId) {
    conditions.push('pipeline_id = ?');
    params.push(pipelineId);
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const sql = `SELECT * FROM dead_letters ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`;
  params.push(limit, offset);

  const rows = db.prepare(sql).all(...params);
  return rows.map(row => {
    row.payload = JSON.parse(row.payload);
    row.headers = JSON.parse(row.headers);
    return row;
  });
}

// --- Queue Jobs ---

export function insertQueueJob(db, { id, deliveryId, destinationId, pipelineId, payload, headers, maxAttempts }) {
  db.prepare(`
    INSERT INTO queue_jobs (id, delivery_id, destination_id, pipeline_id, payload, headers, max_attempts)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(id, deliveryId, destinationId, pipelineId, JSON.stringify(payload), JSON.stringify(headers), maxAttempts);
}

export function dequeueJobs(db, limit, lockId) {
  const now = new Date().toISOString();
  const dequeue = db.transaction(() => {
    const jobs = db.prepare(`
      SELECT * FROM queue_jobs
      WHERE status = 'pending' AND next_attempt_at <= datetime('now')
      LIMIT ?
    `).all(limit);

    if (jobs.length === 0) return [];

    const ids = jobs.map(j => j.id);
    const placeholders = ids.map(() => '?').join(',');
    db.prepare(`
      UPDATE queue_jobs
      SET status = 'processing', locked_at = datetime('now'), locked_by = ?, updated_at = datetime('now')
      WHERE id IN (${placeholders})
    `).run(lockId, ...ids);

    return db.prepare(`
      SELECT * FROM queue_jobs WHERE id IN (${placeholders})
    `).all(...ids).map(row => {
      row.payload = JSON.parse(row.payload);
      row.headers = JSON.parse(row.headers);
      return row;
    });
  });
  return dequeue();
}

export function ackJob(db, jobId) {
  db.prepare(`UPDATE queue_jobs SET status = 'completed', updated_at = datetime('now') WHERE id = ?`).run(jobId);
}

export function nackJob(db, jobId, errorMessage, nextAttemptAt) {
  db.prepare(`
    UPDATE queue_jobs
    SET status = 'pending',
        attempts = attempts + 1,
        error_message = ?,
        next_attempt_at = ?,
        locked_at = NULL,
        locked_by = NULL,
        updated_at = datetime('now')
    WHERE id = ?
  `).run(errorMessage, nextAttemptAt, jobId);
}

export function moveJobToDeadLetter(db, jobId) {
  db.prepare(`UPDATE queue_jobs SET status = 'dead_letter', updated_at = datetime('now') WHERE id = ?`).run(jobId);
}

export function getJobsByDelivery(db, deliveryId) {
  return db.prepare('SELECT * FROM queue_jobs WHERE delivery_id = ? ORDER BY created_at ASC').all(deliveryId).map(row => {
    row.payload = JSON.parse(row.payload);
    row.headers = JSON.parse(row.headers);
    return row;
  });
}

// --- Pipeline Stats ---

export function incrementStat(db, pipelineId, field) {
  const validFields = ['total_received', 'total_delivered', 'total_failed', 'total_filtered'];
  if (!validFields.includes(field)) {
    throw new Error(`Invalid stat field: ${field}`);
  }

  const lastReceivedClause = field === 'total_received'
    ? ", last_received_at = datetime('now')"
    : '';

  db.prepare(`
    INSERT INTO pipeline_stats (pipeline_id, ${field}, updated_at${field === 'total_received' ? ', last_received_at' : ''})
    VALUES (?, 1, datetime('now')${field === 'total_received' ? ", datetime('now')" : ''})
    ON CONFLICT(pipeline_id) DO UPDATE SET
      ${field} = ${field} + 1,
      updated_at = datetime('now')
      ${lastReceivedClause}
  `).run(pipelineId);
}

export function getStats(db, pipelineId) {
  return db.prepare('SELECT * FROM pipeline_stats WHERE pipeline_id = ?').get(pipelineId) || null;
}
