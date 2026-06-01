import { createServer } from 'node:http';
import { HttpDestinationAdapter } from '../../src/destinations/http.js';

let server;
let serverPort;
let lastRequest;

beforeAll(async () => {
  server = createServer((req, res) => {
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => {
      lastRequest = {
        method: req.method,
        url: req.url,
        headers: req.headers,
        body,
      };

      if (req.url === '/timeout') {
        // Never respond — let client timeout
        return;
      }

      if (req.url === '/error') {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Internal Server Error' }));
        return;
      }

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
    });
  });

  await new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      serverPort = server.address().port;
      resolve();
    });
  });
});

afterAll(async () => {
  await new Promise((resolve) => server.close(resolve));
});

beforeEach(() => {
  lastRequest = null;
});

describe('HttpDestinationAdapter', () => {
  const adapter = new HttpDestinationAdapter();
  const baseContext = {
    deliveryId: 'del-123',
    pipelineId: 'pipe-abc',
    attempt: 1,
    headers: { 'x-webhook-source': 'github' },
  };

  it('returns type "http"', () => {
    expect(adapter.type).toBe('http');
  });

  it('successful POST returns success=true and statusCode=200', async () => {
    const result = await adapter.send(
      { event: 'push' },
      { url: `http://127.0.0.1:${serverPort}/ok` },
      baseContext,
    );

    expect(result.success).toBe(true);
    expect(result.statusCode).toBe(200);
    expect(result.responseBody).toBe(JSON.stringify({ ok: true }));
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
    expect(lastRequest.method).toBe('POST');
  });

  it('non-2xx response returns success=false with statusCode', async () => {
    const result = await adapter.send(
      { event: 'push' },
      { url: `http://127.0.0.1:${serverPort}/error` },
      baseContext,
    );

    expect(result.success).toBe(false);
    expect(result.statusCode).toBe(500);
    expect(result.responseBody).toBe(JSON.stringify({ error: 'Internal Server Error' }));
  });

  it('timeout returns success=false with abort/timeout error', async () => {
    const result = await adapter.send(
      { event: 'push' },
      { url: `http://127.0.0.1:${serverPort}/timeout`, timeout_ms: 100 },
      baseContext,
    );

    expect(result.success).toBe(false);
    expect(result.statusCode).toBe(0);
    expect(result.error).toMatch(/abort|timeout/i);
  });

  it('uses custom method (PUT)', async () => {
    const result = await adapter.send(
      { data: 'update' },
      { url: `http://127.0.0.1:${serverPort}/ok`, method: 'PUT' },
      baseContext,
    );

    expect(result.success).toBe(true);
    expect(lastRequest.method).toBe('PUT');
  });

  it('sends custom headers correctly', async () => {
    await adapter.send(
      { data: 1 },
      {
        url: `http://127.0.0.1:${serverPort}/ok`,
        headers: { 'X-Custom': 'my-value', 'X-Env': '${TEST_HEADER_VAL}' },
      },
      baseContext,
    );

    expect(lastRequest.headers['x-custom']).toBe('my-value');
  });

  it('interpolates ${ENV_VAR} in header values', async () => {
    process.env.TEST_HEADER_VAL = 'resolved-env';
    await adapter.send(
      { data: 1 },
      {
        url: `http://127.0.0.1:${serverPort}/ok`,
        headers: { 'X-Env': '${TEST_HEADER_VAL}' },
      },
      baseContext,
    );

    expect(lastRequest.headers['x-env']).toBe('resolved-env');
    delete process.env.TEST_HEADER_VAL;
  });

  it('renders body_template with Handlebars', async () => {
    await adapter.send(
      { event: 'push', repo: 'hookpipe' },
      {
        url: `http://127.0.0.1:${serverPort}/ok`,
        body_template: '{"event":"{{payload.event}}","repo":"{{payload.repo}}"}',
      },
      baseContext,
    );

    const parsed = JSON.parse(lastRequest.body);
    expect(parsed.event).toBe('push');
    expect(parsed.repo).toBe('hookpipe');
  });

  it('sets Content-Type: application/json by default', async () => {
    await adapter.send(
      { x: 1 },
      { url: `http://127.0.0.1:${serverPort}/ok` },
      baseContext,
    );

    expect(lastRequest.headers['content-type']).toBe('application/json');
  });

  it('allows overriding Content-Type via destConfig.headers', async () => {
    await adapter.send(
      { x: 1 },
      {
        url: `http://127.0.0.1:${serverPort}/ok`,
        headers: { 'Content-Type': 'text/plain' },
      },
      baseContext,
    );

    expect(lastRequest.headers['content-type']).toBe('text/plain');
  });
});
