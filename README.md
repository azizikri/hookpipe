# hookpipe

Self-hosted webhook relay with transform pipelines. Receive webhooks, authenticate, filter, transform, and deliver to one or more destinations. Built for self-hosted environments where you control the infrastructure.

## Quick Start — Docker

```bash
docker build -t hookpipe -f docker/Dockerfile .
docker run -p 3000:3000 -v ./pipelines:/app/pipelines -v ./data:/app/data hookpipe
```

## Quick Start — Bare Metal

```bash
npm install
cp .env.example .env
mkdir -p pipelines data
node src/cli/index.js serve
```

Webhooks are received at `POST /hook/:pipeline-id`.

## Pipeline YAML Schema

Pipelines are YAML files in the `pipelines/` directory. Each file defines one pipeline.

### Required Fields

| Field | Type | Description |
|-------|------|-------------|
| `id` | string | Unique pipeline identifier (must match filename) |
| `destinations` | array | One or more delivery targets |

Each destination requires:

| Field | Type | Description |
|-------|------|-------------|
| `id` | string | Unique destination identifier within the pipeline |
| `type` | string | Destination type (`http`) |
| `url` | string | Target URL |

### Optional Fields

| Field | Type | Description |
|-------|------|-------------|
| `name` | string | Human-readable pipeline name |
| `description` | string | Pipeline description |
| `auth` | object | Authentication configuration |
| `filter` | string | Filter plugin name |
| `filter_config` | object | Config passed to the filter plugin |
| `transform` | string | Transform plugin name |
| `retry` | object | Retry policy override |

### Auth Configuration

| Field | Type | Description |
|-------|------|-------------|
| `type` | string | `hmac-sha256` or `hmac-sha1` |
| `secret` | string | HMAC secret (supports `${ENV_VAR}` interpolation) |
| `header` | string | Header containing the signature |

### Destination Options

| Field | Type | Description |
|-------|------|-------------|
| `method` | string | HTTP method (default: `POST`) |
| `headers` | object | Additional headers to send |
| `body_template` | string | Handlebars template for the request body |
| `timeout_ms` | number | Request timeout in milliseconds |
| `on_failure` | string | Failure behavior (`retry` or `log`) |

### Complete Example

```yaml
id: github-deploy
name: GitHub Deploy Notifications
description: Forward GitHub push events to deploy service

auth:
  type: hmac-sha256
  secret: ${GITHUB_WEBHOOK_SECRET}
  header: x-hub-signature-256

filter: github-event-filter
filter_config:
  events:
    - push
    - release

transform: extract-commit-info

destinations:
  - id: deploy-service
    type: http
    url: https://deploy.internal/api/trigger
    method: POST
    headers:
      authorization: Bearer ${DEPLOY_TOKEN}
    timeout_ms: 10000
    on_failure: retry

  - id: slack-notify
    type: http
    url: https://hooks.slack.com/services/T00/B00/xxx
    body_template: |
      {"text": "Deploy triggered by {{payload.pusher.name}} on {{payload.ref}}"}
    on_failure: log

retry:
  maxAttempts: 5
  backoff: exponential
  initialDelayMs: 2000
  maxDelayMs: 300000
```

## Plugin API

Plugins are CommonJS modules loaded via `createRequire` (the project itself is ESM). Place them in the `plugins/` directory.

### Transform Plugin

```js
// plugins/extract-commit-info.cjs
module.exports.transform = function (payload, headers, config) {
  // Return transformed payload object
  // Return null to drop the webhook entirely
  return {
    ref: payload.ref,
    commits: payload.commits.map(c => c.message),
    pusher: payload.pusher.name,
  };
};
```

**Signature:** `transform(payload, headers, config) → object | null`

- `payload` — parsed JSON body of the incoming webhook
- `headers` — request headers (lowercased keys)
- `config` — the pipeline's `filter_config` object (shared namespace)
- Returns the transformed payload, or `null` to drop the webhook

### Filter Plugin

```js
// plugins/github-event-filter.cjs
module.exports.filter = function (payload, headers, config) {
  const event = headers['x-github-event'];
  if (config.events.includes(event)) {
    return { pass: true };
  }
  return { pass: false, reason: `Event '${event}' not in allowed list` };
};
```

**Signature:** `filter(payload, headers, config) → { pass: boolean, reason?: string }`

- Return `{ pass: true }` to continue processing
- Return `{ pass: false, reason: "..." }` to reject the webhook

## CLI Reference

```
hookpipe <command> [options]
```

### `hookpipe serve`

Start the webhook server.

| Flag | Description |
|------|-------------|
| `-p, --port <number>` | Port to listen on |
| `-H, --host <string>` | Host to bind to |
| `-c, --config <path>` | Config file path |
| `--pipelines <dir>` | Pipelines directory |
| `--plugins <dir>` | Plugins directory |

### `hookpipe test <pipeline-id>`

Dry-run a webhook through a pipeline without delivering.

| Flag | Description |
|------|-------------|
| `-f, --file <path>` | JSON file to use as payload |
| `-d, --data <json>` | Inline JSON payload |
| `--header <header>` | Custom header (repeatable, format: `Key: Value`) |
| `--skip-auth` | Skip HMAC authentication check |
| `-c, --config <path>` | Config file path |

### `hookpipe logs`

Query delivery logs.

| Flag | Description |
|------|-------------|
| `--pipeline <id>` | Filter by pipeline ID |
| `--status <status>` | Filter by status (success, failed, pending) |
| `--since <duration>` | Show logs since duration (e.g. `1h`, `7d`) |
| `--limit <n>` | Max number of entries (default: 50) |
| `--json` | Output as JSON |

### `hookpipe replay <delivery-id>`

Re-enqueue a previous delivery for reprocessing.

| Flag | Description |
|------|-------------|
| `--dry-run` | Show what would be replayed without enqueuing |
| `-c, --config <path>` | Config file path |

## Configuration

hookpipe loads configuration from a YAML file, environment variables, and CLI flags.

**Precedence** (highest wins): CLI flags > environment variables > YAML file > defaults

### Config File

By default, hookpipe looks for `hookpipe.yaml` in the working directory. Override with `--config` or `HOOKPIPE_CONFIG`.

```yaml
host: 0.0.0.0
port: 3000

db:
  path: ./data/hookpipe.db

log:
  level: info

pipelines:
  dir: ./pipelines

plugins:
  dir: ./plugins

retry:
  maxAttempts: 3
  backoff: exponential
  initialDelayMs: 1000
  maxDelayMs: 300000

queue:
  pollIntervalMs: 1000
  concurrency: 5
```

### Environment Variables

| Variable | Maps to | Default |
|----------|---------|---------|
| `HOOKPIPE_PORT` | `port` | `3000` |
| `HOOKPIPE_HOST` | `host` | `0.0.0.0` |
| `HOOKPIPE_DB_PATH` | `db.path` | `./data/hookpipe.db` |
| `HOOKPIPE_LOG_LEVEL` | `log.level` | `info` |
| `HOOKPIPE_PIPELINES_DIR` | `pipelines.dir` | `./pipelines` |
| `HOOKPIPE_PLUGINS_DIR` | `plugins.dir` | `./plugins` |
| `HOOKPIPE_CONFIG` | config file path | `hookpipe.yaml` |

Pipeline YAML values support `${ENV_VAR}` interpolation for secrets.

## Trust Model

hookpipe v1.0 has **no sandbox**. Plugins are loaded as plain Node.js modules with full access to the process, filesystem, and network.

This is by design for self-hosted environments where you control what code runs on your infrastructure. The tradeoff is simplicity and zero overhead in exchange for requiring trust in your plugins.

**Guidelines:**

- Only load plugins you wrote or audited
- Do not accept plugin uploads from untrusted sources
- Run hookpipe with least-privilege OS permissions
- Use Docker to limit blast radius if needed

v1.1 will add optional isolation for plugins.

## Tech Stack

| Component | Role |
|-----------|------|
| Node.js 22+ | Runtime |
| Fastify | HTTP server |
| better-sqlite3 | Delivery queue and log storage |
| Commander.js | CLI framework |
| Pino | Structured logging |
| Handlebars | Body templates |
| chokidar | Pipeline hot-reload (file watching) |

## Roadmap

### v1.0 — Core (current)
- Fastify HTTP server, YAML pipelines, env var interpolation
- HMAC-SHA256/SHA1/Stripe authentication
- JS transform + filter plugins (CJS, no sandbox)
- HTTP destination adapter with Handlebars templates
- SQLite delivery log, retry with exponential backoff, dead letter queue
- Pipeline hot-reload via chokidar
- CLI: serve, test, logs, replay
- Docker image

### v1.1 — Agent Layer
- REST Admin API (CRUD pipelines, query logs, replay)
- Agent registration + scoped API keys
- Agent event queue (subscribe, poll, acknowledge)
- SSE real-time event stream
- Agent-writable transforms (runtime upload, sandboxed)
- Plugin sandbox (isolated-vm)
- Skills distribution via skills.sh

### v1.2 — Polish
- Destinations: Telegram, Discord, Slack, SMTP, File
- Prometheus metrics endpoint
- Rate limiting per pipeline
- `hookpipe init` scaffolding
- `hookpipe validate` pipeline linting

### v1.3 — Scale
- Redis/BullMQ queue backend
- Horizontal scaling (multiple workers)
- Pipeline chaining
- TypeScript plugin support

## License

MIT
