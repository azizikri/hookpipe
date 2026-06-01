# Hookpipe — Full Product Plan

> Pluggable, self-hosted webhook relay. Receives → validates → transforms → routes → retries. Config-as-code, no GUI, extensible via JS plugins. **Agent-native: ships skills via skills.sh + REST management API so AI agents can create pipelines, inspect deliveries, and react to events programmatically.**

---

## 1. Product Vision

A single Docker container that replaces the "webhook glue" layer in any self-hosted stack. Zero dependencies beyond Node.js and SQLite. Everything is a file — pipelines are YAML, transforms are JS, destinations are modules. Git-friendly, auditable, fast.

**Target users:** Self-hosters, indie devs, small teams who use n8n/Huginn just for webhook routing and hate the overhead. **AI agent developers** who need their agents to receive real-world events (GitHub pushes, payment confirmations, alerts) and react autonomously.

**Positioning:** "Nginx for webhooks" — sits in front of your services, handles the messy parts (validation, retry, fanout, logging), stays out of the way. Also the **event ingress layer for AI agents** — any webhook becomes a structured event an agent can subscribe to, query, and act on.

---

## 2. Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                        Hookpipe                              │
│                                                             │
│  ┌──────────┐   ┌──────────┐   ┌──────────┐   ┌────────┐  │
│  │  Ingress │──▶│ Pipeline │──▶│  Queue   │──▶│Delivery│  │
│  │  Server  │   │  Engine  │   │  (BullMQ)│   │Workers │  │
│  └──────────┘   └──────────┘   └──────────┘   └────────┘  │
│       │              │                              │        │
│       ▼              ▼                              ▼        │
│  ┌──────────┐   ┌──────────┐                 ┌────────┐    │
│  │  Auth /  │   │ Plugin   │                 │  SQLite │    │
│  │  HMAC    │   │ Sandbox  │                 │   Log   │    │
│  └──────────┘   └──────────┘                 └────────┘    │
│                                                             │
│  ┌──────────────────────────────────────────────────────┐   │
│  │              Destination Adapters                     │   │
│  │  HTTP │ Telegram │ Discord │ Slack │ SMTP │ File │…  │   │
│  └──────────────────────────────────────────────────────┘   │
│                                                             │
│  ┌──────────────────────────────────────────────────────┐   │
│  │              Agent Interface Layer                    │   │
│  │  REST Admin API │ SSE Stream │ Agent Queue │ Skills   │   │
│  └──────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
```

### Core components:

| Component | Responsibility |
|-----------|---------------|
| Ingress Server | Fastify HTTP server, receives POSTs at `/hook/:pipeline-id` |
| Auth Layer | HMAC validation (GitHub, Stripe, etc.), API key, IP allowlist |
| Pipeline Engine | Loads YAML configs, resolves transforms, applies routing rules |
| Plugin Sandbox | Loads and executes JS transform/filter plugins with VM2 isolation |
| Queue | BullMQ (Redis) for production, or in-process queue (SQLite-backed) for single-node |
| Delivery Workers | Pull from queue, call destination adapters, handle retries |
| SQLite Log | Immutable delivery log — every webhook received, every attempt made |
| Destination Adapters | Pluggable output modules — each implements `send(payload, config)` |
| Agent Interface | REST admin API, event streaming, agent queue, skills.sh distribution |

---

## 3. Directory Structure

```
hookpipe/
├── src/
│   ├── server.js              # Fastify app, route registration
│   ├── pipeline-loader.js     # Watches /pipelines, hot-reloads YAML
│   ├── plugin-loader.js       # Discovers and caches transform plugins
│   ├── auth/
│   │   ├── hmac.js            # GitHub, Stripe, generic HMAC
│   │   ├── basic.js           # Bearer token / API key
│   │   └── ip-allowlist.js
│   ├── queue/
│   │   ├── memory-queue.js    # SQLite-backed, no Redis needed
│   │   └── redis-queue.js     # BullMQ adapter for scale
│   ├── delivery/
│   │   ├── worker.js          # Pulls jobs, calls adapters, logs results
│   │   └── retry.js           # Exponential backoff + jitter logic
│   ├── destinations/
│   │   ├── http.js
│   │   ├── telegram.js
│   │   ├── discord.js
│   │   ├── slack.js
│   │   ├── smtp.js
│   │   ├── file.js            # Append to local file (JSONL)
│   │   └── index.js           # Auto-discovers all adapters
│   ├── db/
│   │   ├── schema.sql
│   │   ├── migrations/
│   │   └── queries.js         # Prepared statements
│   ├── cli/
│   │   ├── index.js           # Commander.js entry
│   │   ├── serve.js
│   │   ├── test.js
│   │   ├── replay.js
│   │   ├── logs.js
│   │   ├── validate.js
│   │   └── init.js
│   ├── agent/
│   │   ├── rest-api.js        # REST management API (CRUD pipelines, query logs)
│   │   ├── event-stream.js    # SSE endpoint for real-time event subscription
│   │   ├── agent-queue.js     # Per-agent inbox: hold events until agent polls
│   │   └── schemas.js         # JSON Schema for all agent-facing operations
│   ├── templates/
│   │   └── handlebars.js      # Template engine for destination formatting
│   └── utils/
│       ├── logger.js          # Pino
│       ├── config.js          # Env + hookpipe.config.yaml
│       └── crypto.js
├── pipelines/                 # User pipeline definitions (YAML)
│   └── examples/
│       ├── github-push.yaml
│       ├── stripe-payment.yaml
│       └── uptime-kuma-alert.yaml
├── plugins/                   # User transform plugins (JS)
│   └── examples/
│       ├── github/
│       │   ├── format-push.js
│       │   └── filter-branch.js
│       └── stripe/
│           └── format-payment.js
├── tests/
│   ├── unit/
│   ├── integration/
│   └── fixtures/              # Real webhook payloads for testing
├── docs/
│   ├── getting-started.md
│   ├── pipelines.md
│   ├── plugins.md
│   ├── destinations.md
│   ├── authentication.md
│   ├── deployment.md
│   └── api.md
├── docker/
│   ├── Dockerfile
│   └── docker-compose.yaml
├── hookpipe.config.yaml       # Global config (port, log level, queue backend)
├── package.json
├── LICENSE                    # MIT
└── README.md
```

---

## 4. Pipeline Config Spec

```yaml
# pipelines/github-push.yaml
id: github-push
name: "GitHub Push to Main"
description: "Notify Telegram + trigger deploy on push to main"

# Authentication
auth:
  type: hmac-sha256
  header: X-Hub-Signature-256
  secret: ${GITHUB_WEBHOOK_SECRET}  # env var interpolation

# Optional: only process if filter returns true
filter: github/filter-branch.js
filter_config:
  branches: [main, release/*]

# Transform the raw payload into a clean object
transform: github/format-push.js

# Where to send the transformed payload
destinations:
  - id: telegram-notify
    type: telegram
    chat_id: ${TELEGRAM_CHAT_ID}
    template: |
      🔨 *{{repo}}* → `{{branch}}`
      {{#each commits}}
      • {{message}} ({{author}})
      {{/each}}
    on_failure: log  # log | alert | dead-letter

  - id: deploy-trigger
    type: http
    method: POST
    url: http://coolify:8000/api/v1/deploy
    headers:
      Authorization: "Bearer ${COOLIFY_TOKEN}"
    body_template: |
      {"uuid": "{{deploy_uuid}}"}
    on_failure: retry

# Retry policy (per-pipeline, overrides global)
retry:
  max_attempts: 5
  backoff: exponential  # linear | exponential | fixed
  initial_delay_ms: 1000
  max_delay_ms: 60000

# Rate limiting
rate_limit:
  max_per_minute: 60
  burst: 10

# Conditions: only run pipeline if payload matches
conditions:
  - field: "ref"
    operator: starts_with
    value: "refs/heads/main"
```

---

## 5. Plugin API

### Transform Plugin

```js
// plugins/github/format-push.js

/**
 * @param {object} payload - Raw webhook body
 * @param {object} headers - Request headers
 * @param {object} config  - Pipeline-level config passed to this plugin
 * @returns {object|null}  - Transformed payload, or null to drop
 */
module.exports.transform = function (payload, headers, config) {
  return {
    repo: payload.repository.full_name,
    branch: payload.ref.replace('refs/heads/', ''),
    pusher: payload.pusher.name,
    commits: payload.commits.map(c => ({
      sha: c.id.slice(0, 7),
      message: c.message.split('\n')[0],
      author: c.author.name,
      url: c.url
    })),
    deploy_uuid: config.deploy_uuid || null,
    timestamp: new Date().toISOString()
  }
}

/**
 * Optional metadata for CLI --help and validation
 */
module.exports.meta = {
  name: 'github/format-push',
  description: 'Formats GitHub push events into a clean notification object',
  input_events: ['push'],
  output_schema: {
    repo: 'string',
    branch: 'string',
    pusher: 'string',
    commits: 'array'
  }
}
```

### Filter Plugin

```js
// plugins/github/filter-branch.js

module.exports.filter = function (payload, headers, config) {
  const branch = payload.ref.replace('refs/heads/', '')
  const allowed = config.branches || ['main']

  // Support glob patterns
  const match = allowed.some(pattern => {
    if (pattern.includes('*')) {
      const regex = new RegExp('^' + pattern.replace(/\*/g, '.*') + '$')
      return regex.test(branch)
    }
    return pattern === branch
  })

  return {
    pass: match,
    reason: match ? null : `branch "${branch}" not in allowlist`
  }
}
```

### Destination Adapter

```js
// src/destinations/telegram.js

const TELEGRAM_API = 'https://api.telegram.org/bot'

module.exports = {
  name: 'telegram',

  /**
   * @param {object} payload    - Transformed payload
   * @param {object} destConfig - Destination config from pipeline YAML
   * @param {object} context    - { pipelineId, deliveryId, attempt }
   * @returns {object}          - { success: bool, status_code, response_body, error }
   */
  async send(payload, destConfig, context) {
    const token = process.env.TELEGRAM_BOT_TOKEN || destConfig.token
    const text = destConfig._rendered_template // pre-rendered by template engine

    const res = await fetch(`${TELEGRAM_API}${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: destConfig.chat_id,
        text,
        parse_mode: 'Markdown',
        disable_web_page_preview: true
      })
    })

    const body = await res.json()
    return {
      success: res.ok,
      status_code: res.status,
      response_body: body,
      error: res.ok ? null : body.description
    }
  },

  // Schema for validation
  configSchema: {
    required: ['chat_id'],
    properties: {
      chat_id: { type: 'string' },
      token: { type: 'string', description: 'Override bot token per-destination' },
      template: { type: 'string' },
      parse_mode: { type: 'string', enum: ['Markdown', 'HTML'], default: 'Markdown' }
    }
  }
}
```

---

## 6. Database Schema

```sql
-- Delivery log
CREATE TABLE deliveries (
  id TEXT PRIMARY KEY,                    -- ulid
  pipeline_id TEXT NOT NULL,
  received_at INTEGER NOT NULL,           -- unix ms
  source_ip TEXT,
  raw_headers JSON,
  raw_payload JSON,
  transformed_payload JSON,
  filter_result TEXT,                     -- 'passed' | 'dropped' | null
  filter_reason TEXT,
  created_at INTEGER DEFAULT (unixepoch('subsec') * 1000)
);

-- Per-destination delivery attempts
CREATE TABLE delivery_attempts (
  id TEXT PRIMARY KEY,                    -- ulid
  delivery_id TEXT NOT NULL REFERENCES deliveries(id),
  destination_id TEXT NOT NULL,           -- from pipeline YAML
  destination_type TEXT NOT NULL,
  attempt_number INTEGER NOT NULL,
  status TEXT NOT NULL,                   -- 'pending' | 'success' | 'failed' | 'dead-letter'
  status_code INTEGER,
  response_body TEXT,
  error TEXT,
  attempted_at INTEGER,
  next_retry_at INTEGER,
  UNIQUE(delivery_id, destination_id, attempt_number)
);

-- Pipeline stats (materialized, updated by triggers)
CREATE TABLE pipeline_stats (
  pipeline_id TEXT PRIMARY KEY,
  total_received INTEGER DEFAULT 0,
  total_delivered INTEGER DEFAULT 0,
  total_failed INTEGER DEFAULT 0,
  total_dropped INTEGER DEFAULT 0,
  last_received_at INTEGER,
  last_delivered_at INTEGER
);

-- Dead letter queue
CREATE TABLE dead_letters (
  id TEXT PRIMARY KEY,
  delivery_id TEXT NOT NULL,
  destination_id TEXT NOT NULL,
  pipeline_id TEXT NOT NULL,
  payload JSON,
  last_error TEXT,
  attempts_exhausted INTEGER,
  created_at INTEGER DEFAULT (unixepoch('subsec') * 1000),
  resolved_at INTEGER,
  resolution TEXT                         -- 'replayed' | 'discarded' | null
);

-- Agent registry
CREATE TABLE agents (
  id TEXT PRIMARY KEY,                    -- ulid
  name TEXT NOT NULL UNIQUE,              -- human-readable agent name
  api_key_hash TEXT NOT NULL,             -- bcrypt hash of agent's API key
  scopes JSON,                            -- ["pipeline:github-push", "pipeline:*", "admin"]
  created_at INTEGER DEFAULT (unixepoch('subsec') * 1000),
  last_seen_at INTEGER,
  metadata JSON                           -- agent description, version, capabilities
);

-- Agent event queue (inbox per agent)
CREATE TABLE agent_events (
  id TEXT PRIMARY KEY,                    -- ulid
  agent_id TEXT NOT NULL REFERENCES agents(id),
  pipeline_id TEXT NOT NULL,
  delivery_id TEXT NOT NULL REFERENCES deliveries(id),
  payload JSON NOT NULL,                  -- transformed payload (what the agent receives)
  status TEXT NOT NULL DEFAULT 'pending', -- 'pending' | 'delivered' | 'acknowledged' | 'expired'
  queued_at INTEGER DEFAULT (unixepoch('subsec') * 1000),
  delivered_at INTEGER,
  acknowledged_at INTEGER,
  expires_at INTEGER                      -- TTL: auto-expire if agent never polls
);

-- Agent subscriptions (which pipelines an agent listens to)
CREATE TABLE agent_subscriptions (
  id TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL REFERENCES agents(id),
  pipeline_id TEXT NOT NULL,
  filter_expression TEXT,                 -- optional JSONPath/jq-like filter on transformed payload
  created_at INTEGER DEFAULT (unixepoch('subsec') * 1000),
  UNIQUE(agent_id, pipeline_id)
);

-- Agent-created pipelines (track which agent created what)
CREATE TABLE agent_pipelines (
  pipeline_id TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL REFERENCES agents(id),
  created_at INTEGER DEFAULT (unixepoch('subsec') * 1000),
  source TEXT DEFAULT 'rest'              -- 'rest' | 'cli' | 'internal'
);

-- Indexes
CREATE INDEX idx_deliveries_pipeline ON deliveries(pipeline_id, received_at DESC);
CREATE INDEX idx_attempts_status ON delivery_attempts(status, next_retry_at);
CREATE INDEX idx_dead_letters_unresolved ON dead_letters(resolved_at) WHERE resolved_at IS NULL;
CREATE INDEX idx_agent_events_pending ON agent_events(agent_id, status, queued_at) WHERE status = 'pending';
CREATE INDEX idx_agent_events_expiry ON agent_events(expires_at) WHERE status = 'pending';
CREATE INDEX idx_agent_subs ON agent_subscriptions(pipeline_id);
```

---

## 7. CLI

```
hookpipe <command> [options]

Commands:
  serve                    Start the server
  init                     Scaffold a new hookpipe project
  validate                 Validate all pipeline configs and plugins
  test <pipeline-id>       Replay last payload (or --file) through a pipeline (dry-run)
  replay <delivery-id>     Re-deliver a specific webhook
  logs                     Query delivery log
  stats                    Show pipeline statistics
  dead-letters             List/replay/discard dead-lettered deliveries
  plugins list             List discovered plugins
  plugins test <plugin>    Run a plugin against fixture data
  destinations list        List available destination types
  completions              Generate shell completions

Options:
  --config, -c             Path to hookpipe.config.yaml (default: ./hookpipe.config.yaml)
  --pipelines-dir          Path to pipelines directory (default: ./pipelines)
  --plugins-dir            Path to plugins directory (default: ./plugins)
  --port, -p               Server port (default: 3000)
  --log-level              pino log level (default: info)
  --version, -v            Show version
  --help, -h               Show help

Examples:
  hookpipe serve --port 8080
  hookpipe test github-push --file fixtures/push.json
  hookpipe logs --pipeline github-push --status failed --since 1h
  hookpipe replay 01J5KXYZ... --dry-run
  hookpipe dead-letters replay --all
  hookpipe stats --pipeline github-push
```

---

## 8. Global Config

```yaml
# hookpipe.config.yaml

server:
  port: 3000
  host: 0.0.0.0
  trust_proxy: true          # behind Traefik/nginx
  body_limit: "1mb"
  request_timeout_ms: 5000

queue:
  backend: memory            # memory (SQLite-backed) | redis
  redis_url: redis://localhost:6379
  concurrency: 5             # parallel delivery workers

database:
  path: ./data/hookpipe.db
  wal_mode: true
  max_log_age_days: 30       # auto-prune old deliveries

retry:
  # Global defaults (overridable per-pipeline)
  max_attempts: 3
  backoff: exponential
  initial_delay_ms: 1000
  max_delay_ms: 300000

plugins:
  sandbox: true              # Run transforms in VM2 isolate
  timeout_ms: 5000           # Max plugin execution time
  allow_network: false       # Plugins can't make HTTP calls (unless overridden)

destinations:
  telegram:
    bot_token: ${TELEGRAM_BOT_TOKEN}
  discord:
    # per-destination tokens go in pipeline YAML
  smtp:
    host: smtp.example.com
    port: 587
    user: ${SMTP_USER}
    pass: ${SMTP_PASS}

logging:
  level: info
  format: json               # json | pretty
  file: ./data/hookpipe.log  # null = stdout only

health:
  enabled: true
  path: /health
  include_stats: true        # include pipeline counts in health response

admin:
  enabled: false             # REST API for managing pipelines at runtime
  token: ${ADMIN_TOKEN}
  prefix: /admin

# Agent interface configuration
agent:
  enabled: true
  api:
    prefix: /api/v1
    cors: true
  sse:
    enabled: true
    path: /api/v1/events/stream
  events:
    queue_ttl_hours: 72                  # expire unpolled events after 72h
    max_queue_size: 1000                 # per-agent max pending events
    batch_size: 50                       # max events returned per poll
  auth:
    type: api_key                        # api_key | jwt | none (dev only)
    header: X-Agent-Key
  sandbox:
    allow_agent_transforms: true         # agents can POST transform code
    agent_transform_timeout_ms: 3000     # stricter timeout for agent-written code
    agent_transform_max_size: 10240      # 10KB max transform size
```

---

## 9. Features (Complete Product)

### Core
- [x] Receive webhooks at `/hook/:pipeline-id`
- [x] YAML pipeline definitions with env var interpolation
- [x] JS transform plugins with VM2 sandboxing
- [x] JS filter plugins with glob/regex support
- [x] Conditional routing (field matching in YAML)
- [x] Handlebars templating in destinations
- [x] Multiple destinations per pipeline (fanout)
- [x] SQLite delivery log with full audit trail
- [x] Retry with configurable backoff strategies
- [x] Dead letter queue with replay capability
- [x] Hot-reload pipelines and plugins (no restart)

### Agent Interface (REST + Skills)
- [x] REST Admin API (`/api/v1/`) — full CRUD for pipelines, deliveries, transforms
- [x] Event subscription system (subscribe, poll, acknowledge)
- [x] SSE real-time event stream
- [x] Agent queue with TTL and auto-expiry
- [x] Scoped API keys (`hookpipe key generate --scope "pipeline:github-*"`)
- [x] Agent-writable transforms (runtime upload, sandboxed)
- [x] Skills in repo under `/skills/` (`npx skills add hookpipe/hookpipe`)
- [x] `hookpipe init` prompts for skill installation (agent selection, auto-install)
- [x] Agent queue — per-agent inbox that buffers events when agent is offline
- [x] Agent authentication (API key per agent, scoped to specific pipelines)
- [x] Structured event format (consistent JSON envelope agents can parse without guessing)
- [x] Agent-writable transforms — agents can POST JS transform code at runtime
- [x] Webhook-to-agent bridge: new destination type `agent` that holds payload in queue until agent polls

### Authentication
- [x] HMAC-SHA256 (GitHub, Stripe, Shopify, generic)
- [x] HMAC-SHA1 (legacy services)
- [x] Bearer token / API key header
- [x] IP allowlist (CIDR notation)
- [x] Timestamp validation (reject stale webhooks)

### Destinations (built-in)
- [x] HTTP/HTTPS (arbitrary endpoint)
- [x] Telegram
- [x] Discord (webhook URL)
- [x] Slack (webhook URL + Bot API)
- [x] SMTP email
- [x] File (JSONL append)
- [x] Stdout (for piping to other tools)
- [x] Another Hookpipe instance (chaining)
- [x] Agent queue (holds payload until agent polls — async agent consumption)

### Observability
- [x] Structured JSON logging (Pino)
- [x] `/health` endpoint with pipeline stats
- [x] Prometheus metrics endpoint (`/metrics`)
- [x] Per-pipeline delivery success/failure counters
- [x] Latency histograms (ingress → delivery)
- [x] Alert destination on repeated failures

### CLI
- [x] `hookpipe serve` — run the server
- [x] `hookpipe init` — scaffold project structure
- [x] `hookpipe validate` — lint pipelines + plugins
- [x] `hookpipe test` — dry-run a pipeline with fixture data
- [x] `hookpipe replay` — re-deliver from log
- [x] `hookpipe logs` — query with filters
- [x] `hookpipe stats` — pipeline health overview
- [x] `hookpipe dead-letters` — manage failed deliveries
- [x] Shell completions (bash, zsh, fish)

### Security
- [x] VM2 sandbox for plugins (no fs/net access by default)
- [x] Plugin execution timeout (default 5s)
- [x] Request body size limit
- [x] Rate limiting per pipeline
- [x] Secrets never logged (redacted in delivery log)
- [x] Optional TLS termination (or rely on Traefik)

### Deployment
- [x] Single Docker image (~50MB, distroless)
- [x] Docker Compose with optional Redis
- [x] Helm chart for Kubernetes
- [x] Systemd unit file for bare metal
- [x] Coolify one-click deploy template
- [x] ARM64 support (Raspberry Pi)

### Developer Experience
- [x] `hookpipe init` scaffolds everything
- [x] Example pipelines for GitHub, Stripe, Uptime Kuma, Coolify
- [x] Example plugins with full JSDoc
- [x] Fixture files (real webhook payloads) for testing
- [x] TypeScript type definitions for plugin API
- [x] VS Code snippets for pipeline YAML
- [x] Comprehensive docs site (VitePress)

---

## 10. Tech Stack

| Layer | Choice | Why |
|-------|--------|-----|
| Runtime | Node.js 22+ | Native fetch, fast startup, huge ecosystem |
| HTTP | Fastify | Fastest Node framework, schema validation built-in |
| Queue | BullMQ (optional) / SQLite-backed in-process | Zero-dep default, Redis for scale |
| Database | better-sqlite3 | Synchronous, fast, zero config, WAL mode |
| Templating | Handlebars | Simple, safe, well-known |
| Sandbox | vm2 / isolated-vm | Plugin isolation without subprocess overhead |
| CLI | Commander.js | Standard, lightweight |
| Logging | Pino | Fastest structured logger for Node |
| Config | js-yaml + dotenv | YAML for structure, .env for secrets |
| Testing | Vitest | Fast, ESM-native, good DX |
| Docs | VitePress | Markdown → static site, minimal config |
| Container | Docker (distroless) | Small, secure |

---

## 11. Monetization (Optional)

**Open core model:**

| Tier | Price | What |
|------|-------|------|
| OSS (MIT) | Free | Everything above — full product |
| Hookpipe Cloud | $5/mo hobby, $20/mo pro | Hosted version — paste YAML, get URL, zero infra |
| Enterprise | $99/mo | Multi-tenant, SSO, audit export, SLA, priority support |

**Cloud features (not in OSS):**
- Managed infrastructure (no Docker needed)
- Web dashboard for delivery logs
- Team collaboration (shared pipelines)
- Webhook URL generation (no DNS/port forwarding needed)
- Uptime SLA + alerting

---

## 12. Roadmap

### v1.0 — Core (Week 1-2)
- Server, pipeline engine, plugin system
- HTTP + Telegram + Discord destinations
- SQLite log, retry, dead letters
- CLI (serve, test, logs, replay)
- Docker image
- Docs: getting started, pipeline reference

### v1.1 — Agent Layer (Week 3-4)
- REST Admin API (CRUD pipelines, query logs, replay)
- Agent registration + API key auth
- Agent event queue (subscribe, poll, acknowledge)
- SSE event stream for real-time push
- Agent-writable transforms (POST code at runtime)
- `agent` destination type
- Skills in repo (hookpipe-core, hookpipe-events, hookpipe-transforms)
- `hookpipe init` skill installation prompt
- Docs: agent integration guide

### v1.2 — Polish (Month 2)
- All built-in destinations (Slack, SMTP, File, Stdout)
- Prometheus metrics
- Rate limiting
- `hookpipe init` scaffolding
- Example pipelines for 5 common services
- CI/CD (GitHub Actions: test, build, publish)

### v1.3 — Scale (Month 3)
- Redis/BullMQ queue backend
- Horizontal scaling (multiple workers)
- Pipeline chaining (output of one → input of another)
- Webhook replay from external sources (import from Svix/Hookdeck logs)
- TypeScript plugin support (ts-node loader)
- Agent subscription filters (JSONPath expressions on payload)

### v1.4 — Ecosystem (Month 4)
- Plugin registry (community transforms)
- Destination registry (community adapters)
- Helm chart
- Coolify template
- VitePress docs site
- VS Code extension (YAML schema + snippets)
- Skills catalog expanded (hookpipe-monitoring, hookpipe-deploy)

### v2.0 — Cloud (Month 5+)
- Hosted multi-tenant version
- Web dashboard
- Webhook URL provisioning
- Usage-based billing
- Team/org support
- Agent marketplace (share agent pipeline configs)

---

## 13. Agent Interface — Skills-Based (via skills.sh)

Instead of an MCP server (heavy, requires running a separate process, yet another protocol), Hookpipe ships **agent skills** — markdown instruction files that any compatible agent (Claude Code, Cursor, Codex, Hermes, Copilot, etc.) can install via [skills.sh](https://www.skills.sh/). The agent learns how to interact with Hookpipe's REST API and CLI through the skill, not through a bespoke protocol.

### 13.1 Why Skills Over MCP

- **Zero runtime overhead** — no extra process, no stdio pipe, no SSE connection to maintain
- **Works with 20+ agents** — any agent that supports skills.sh (Claude Code, Cursor, Codex, Copilot, Windsurf, Hermes, etc.)
- **Declarative knowledge** — the skill teaches the agent what endpoints exist, what payloads look like, and what workflows are possible
- **No vendor lock-in** — skills are just markdown files in a git repo. Fork, modify, extend.
- **Composable** — install only the skills you need (core, monitoring, deploy, etc.)

### 13.2 Skill Distribution

Skills live in the Hookpipe repo itself under `/skills/`. Users install from GitHub:

```bash
# Install all Hookpipe skills
npx skills add hookpipe/hookpipe

# Install specific skills
npx skills add hookpipe/hookpipe hookpipe-core
npx skills add hookpipe/hookpipe hookpipe-monitoring
npx skills add hookpipe/hookpipe hookpipe-deploy
npx skills add hookpipe/hookpipe hookpipe-transforms
```

On `hookpipe init`, the CLI prompts:

```
? Install agent skills? (Y/n)
? Which agent are you using?
  ❯ Claude Code
    Cursor
    Codex / OpenAI
    Hermes
    Copilot
    Other (manual)

Installing skills via skills.sh...
✓ hookpipe-core installed
✓ hookpipe-monitoring installed
✓ hookpipe-deploy installed

Skills installed! Your agent now knows how to manage Hookpipe.
```

### 13.3 Skill Catalog

#### `hookpipe-core` — Pipeline Management

Teaches the agent:
- How to create/update/delete pipelines via REST API or CLI
- Pipeline YAML schema and all available options
- How to query delivery logs, replay failed deliveries
- How to test pipelines with dry-run payloads
- Authentication (API key in `X-Hookpipe-Key` header)
- Common patterns: fan-out, filter, conditional routing

```markdown
# hookpipe-core

## Trigger
When the user asks to create, modify, debug, or inspect webhook pipelines.

## API Base
`http://localhost:3000/api/v1` (or HOOKPIPE_URL env var)

## Authentication
All requests need `X-Hookpipe-Key: <key>` header.
Key is in `.env` or `hookpipe.config.yaml` under `admin.token`.

## Operations

### Create Pipeline
POST /api/v1/pipelines
Body: { "id": "slug", "config": "<yaml string>" }

### List Pipelines
GET /api/v1/pipelines?status=active|paused|all

### Get Pipeline
GET /api/v1/pipelines/:id

### Update Pipeline
PUT /api/v1/pipelines/:id
Body: { "config": "<yaml string>" }

### Delete Pipeline
DELETE /api/v1/pipelines/:id?keep_history=true

### Test Pipeline (dry-run)
POST /api/v1/pipelines/:id/test
Body: { "payload": {...}, "headers": {...} }

### Query Deliveries
GET /api/v1/deliveries?pipeline_id=X&status=failed&since=1h&limit=20

### Replay Delivery
POST /api/v1/deliveries/:id/replay
Body: { "destination_id": "optional", "dry_run": false }

### Dead Letters
GET /api/v1/dead-letters
POST /api/v1/dead-letters/:id/replay
POST /api/v1/dead-letters/:id/discard

## CLI Equivalents
hookpipe ls                          # list pipelines
hookpipe logs --pipeline X --status failed
hookpipe replay <delivery-id>
hookpipe test <pipeline-id> --payload '{"key":"val"}'

## Pipeline YAML Schema
[full schema reference here]

## Pitfalls
- Pipeline IDs must be URL-safe slugs (lowercase, hyphens, no spaces)
- YAML `secret` fields support ${ENV_VAR} interpolation
- Transforms must export a `transform(payload, headers)` function
- `dry_run: true` on test skips actual delivery but runs the full transform chain
```

#### `hookpipe-monitoring` — Observability & Alerts

Teaches the agent:
- How to check pipeline health and stats
- How to set up alert pipelines (Uptime Kuma → Hookpipe → Telegram)
- How to diagnose delivery failures
- How to read structured logs

```markdown
# hookpipe-monitoring

## Trigger
When the user asks about webhook delivery status, failures, health,
or wants to set up monitoring/alerting through Hookpipe.

## Stats
GET /api/v1/stats                    # global
GET /api/v1/stats/:pipeline_id       # per-pipeline
Query params: ?period=1h|24h|7d|30d

Response:
{
  "total_received": 1420,
  "total_delivered": 1389,
  "total_failed": 12,
  "total_dropped": 19,
  "avg_latency_ms": 45,
  "error_rate": 0.008,
  "last_received_at": "2026-06-01T..."
}

## Health Check
GET /health
Returns 200 + pipeline counts. Use for Uptime Kuma / external monitoring.

## Diagnosing Failures
1. GET /api/v1/deliveries?status=failed&since=1h
2. GET /api/v1/deliveries/:id  (full detail with attempts + errors)
3. Check last_error field for HTTP status, timeout, DNS failure
4. POST /api/v1/deliveries/:id/replay to retry

## Log Format (Pino JSON)
hookpipe logs are at ./data/hookpipe.log (JSON lines)
Key fields: level, pipeline_id, delivery_id, status, duration_ms, error

## Common Alert Pipeline Pattern
[example YAML for Uptime Kuma → Hookpipe → Telegram/Discord]
```

#### `hookpipe-deploy` — Deployment & Infrastructure

Teaches the agent:
- How to deploy Hookpipe (Docker, docker-compose, Coolify)
- How to configure reverse proxy (Traefik labels)
- How to backup/restore the SQLite database
- How to upgrade versions

```markdown
# hookpipe-deploy

## Trigger
When the user asks to deploy, update, backup, or configure Hookpipe infrastructure.

## Docker Compose
[full docker-compose.yml with Traefik labels, volumes, env]

## Coolify
[one-click deploy template reference]

## Backup
sqlite3 ./data/hookpipe.db ".backup ./data/hookpipe-backup.db"
# or: hookpipe backup --output ./backups/

## Upgrade
docker pull hookpipe/hookpipe:latest
docker compose up -d
# Migrations run automatically on startup

## Environment Variables
HOOKPIPE_PORT=3000
HOOKPIPE_ADMIN_TOKEN=<secret>
HOOKPIPE_DB_PATH=./data/hookpipe.db
TELEGRAM_BOT_TOKEN=<token>
[full list]
```

#### `hookpipe-transforms` — Writing Plugins

Teaches the agent:
- How to write transform plugins (JS)
- The plugin API (transform, validate, filter functions)
- How to upload transforms at runtime via API
- How to test transforms against sample payloads
- Sandbox constraints

```markdown
# hookpipe-transforms

## Trigger
When the user asks to create, modify, or debug webhook transform plugins.

## Plugin Structure
// plugins/<namespace>/<name>.js
module.exports = {
  // Required: reshape the payload
  transform(payload, headers) {
    return { /* new shape */ }
  },

  // Optional: reject before processing
  validate(payload, headers) {
    return { drop: false } // or { drop: true, reason: "..." }
  },

  // Optional: filter (return false to skip this destination)
  filter(transformedPayload, destination) {
    return true
  }
}

## Runtime Upload (agent-created transforms)
POST /api/v1/transforms
Body: {
  "name": "my-agent/format-order",
  "code": "module.exports.transform = ...",
  "test_payload": { ... }  // optional validation
}

## Sandbox Constraints
- 5s timeout (3s for agent-uploaded)
- 10KB max code size (agent-uploaded)
- No network access (no require('http'), no fetch)
- No filesystem access
- Only stdlib: JSON, Date, Math, String, Array, Object, RegExp

## Testing
hookpipe test <pipeline-id> --payload '{"test": true}'
# Shows: raw → transformed → destinations matched

POST /api/v1/pipelines/:id/test
# Same but via API

## Common Patterns
[examples for GitHub, Stripe, Shopify, Uptime Kuma, generic]
```

#### `hookpipe-events` — Event Subscription & Polling

Teaches the agent:
- How to subscribe to pipeline events
- How to poll for new events (agent inbox pattern)
- How to acknowledge processed events
- SSE streaming for real-time consumption
- The event envelope format

```markdown
# hookpipe-events

## Trigger
When the user wants their agent to react to incoming webhooks,
subscribe to events, or build event-driven agent workflows.

## Subscribe to a Pipeline
POST /api/v1/subscriptions
Body: {
  "pipeline_id": "github-push",
  "filter": "$.branch == 'main'"  // optional JSONPath filter
}

## Poll Events (Agent Inbox)
GET /api/v1/events/poll?limit=10&acknowledge=true
Returns pending events for this agent (identified by API key).

## Acknowledge Events
POST /api/v1/events/acknowledge
Body: { "event_ids": ["01JX9...", "01JX9..."] }

## SSE Stream (Real-time)
GET /api/v1/events/stream
Headers: X-Hookpipe-Key: <key>
Returns: Server-Sent Events, one per webhook received

## Event Envelope
{
  "id": "01JX9ABC...",
  "event_type": "webhook.received",
  "pipeline_id": "github-push",
  "delivery_id": "01JX9DEF...",
  "timestamp": "2026-06-01T14:30:00.000Z",
  "payload": { ... },  // transformed
  "metadata": {
    "source_ip": "...",
    "transform_applied": "github/format-push"
  }
}

## Agent Workflow Pattern
1. Install hookpipe-events skill
2. Agent subscribes to relevant pipelines on setup
3. Agent polls on cron schedule (or listens via SSE)
4. Agent processes events, takes action
5. Agent acknowledges processed events

## Queue Behavior
- Events expire after 72h if unpolled (configurable)
- Max 1000 pending events per agent (oldest dropped)
- acknowledge=true on poll auto-marks as delivered
- Unacknowledged events re-appear on next poll after 5min

## CLI
hookpipe events poll                 # poll as current agent
hookpipe events stream               # SSE stream to stdout
hookpipe events ack <event-id>       # acknowledge specific event
```

### 13.4 Installation Flow

When a user runs `hookpipe init` or `npm create hookpipe`:

```
┌─────────────────────────────────────────────┐
│  🪝 Hookpipe Setup                          │
├─────────────────────────────────────────────┤
│                                             │
│  ✓ Created hookpipe.config.yaml             │
│  ✓ Created pipelines/ directory             │
│  ✓ Created plugins/ directory               │
│  ✓ Created example pipeline                 │
│                                             │
│  ? Install agent skills? (Y/n) Y            │
│                                             │
│  ? Select skills to install:                │
│    ◉ hookpipe-core (pipeline management)    │
│    ◉ hookpipe-events (event subscription)   │
│    ◉ hookpipe-transforms (plugin authoring) │
│    ◯ hookpipe-monitoring (observability)    │
│    ◯ hookpipe-deploy (infrastructure)       │
│                                             │
│  Installing via skills.sh...                │
│  $ npx skills add hookpipe/hookpipe         │
│  ✓ 3 skills installed                       │
│                                             │
│  ? Generate admin API key? (Y/n) Y          │
│  ✓ Key: hp_sk_a1b2c3...                     │
│    (saved to .env)                          │
│                                             │
│  Ready! Run: hookpipe serve                 │
└─────────────────────────────────────────────┘
```

### 13.5 How Agents Use It (No MCP Required)

An agent with the skills installed just uses `curl` / HTTP calls through its terminal tool:

```bash
# Agent creates a pipeline (using knowledge from hookpipe-core skill)
curl -s -X POST http://localhost:3000/api/v1/pipelines \
  -H "X-Hookpipe-Key: $HOOKPIPE_KEY" \
  -H "Content-Type: application/json" \
  -d '{"id":"github-push","config":"id: github-push\nauth:\n  type: hmac-sha256\n  secret: ${GITHUB_SECRET}\ntransform: github/format-push.js\ndestinations:\n  - type: telegram\n    chat_id: \"-100123\""}'

# Agent polls for events (using knowledge from hookpipe-events skill)
curl -s http://localhost:3000/api/v1/events/poll?limit=5 \
  -H "X-Hookpipe-Key: $HOOKPIPE_KEY"

# Agent uploads a transform at runtime (using hookpipe-transforms skill)
curl -s -X POST http://localhost:3000/api/v1/transforms \
  -H "X-Hookpipe-Key: $HOOKPIPE_KEY" \
  -H "Content-Type: application/json" \
  -d '{"name":"my/filter","code":"module.exports.transform = (p) => ({repo: p.repository.name, branch: p.ref})"}'
```

No MCP server. No stdio pipe. No special protocol. The agent just knows the API because the skill taught it.

### 13.6 Skill Repo Structure

Skills live alongside the main code in the repo:

```
hookpipe/
├── src/
├── plugins/
├── skills/
│   ├── hookpipe-core/
│   │   └── SKILL.md
│   ├── hookpipe-events/
│   │   └── SKILL.md
│   ├── hookpipe-transforms/
│   │   └── SKILL.md
│   ├── hookpipe-monitoring/
│   │   └── SKILL.md
│   └── hookpipe-deploy/
│       └── SKILL.md
├── package.json
└── ...
```

### 13.7 Security (Same as Before, Simpler)

- Admin API key required for all mutations (`X-Hookpipe-Key` header)
- Key generated on `hookpipe init` or `hookpipe key generate`
- Scoped keys possible: `hookpipe key generate --scope "pipeline:github-*,read"`
- Agent-uploaded transforms sandboxed (3s timeout, 10KB, no network)
- Rate limiting per key (configurable)
- All mutations logged to audit trail

---

## 14. Competitive Landscape

| Tool | Problem |
|------|---------| 
| n8n | Overkill for webhook routing, heavy, GUI-first, no agent skills |
| Huginn | Ruby, complex, unmaintained feel, no agent API |
| Svix | Webhook sending (outbound), not receiving/routing |
| Hookdeck | SaaS-only, no self-host |
| Pipedream | SaaS, vendor lock-in |
| Custom scripts | No retry, no logging, no fanout, breaks silently |
| MCP servers (generic) | Extra process, extra protocol, stateless — no event persistence or queuing |

**Hookpipe's gap:** Self-hosted, config-as-code, plugin-extensible, lightweight — AND the only webhook tool with agent skills on skills.sh (REST + event queue + composable knowledge). The "Caddy of webhooks" that agents already know how to use.

---

## 15. Success Metrics

- GitHub: 500+ stars in first month (realistic for a well-positioned tool)
- Docker Hub: 1k+ pulls/month
- Community: 10+ contributed plugins/destinations within 3 months
- Cloud waitlist: 100+ signups before launch
- Agent adoption: skills.sh install count 5k+ within 2 months (indexed from GitHub repo)
- Integration: at least 2 agent frameworks (Hermes, Claude Code, Codex) ship example configs
