import Fastify from 'fastify';
import { ulid } from 'ulid';
import { verifyWebhookAuth } from './auth/hmac.js';
import { insertDelivery, incrementStat } from './db/queries.js';

function getPluginPath(pluginConfig) {
  return typeof pluginConfig === 'string' ? pluginConfig : pluginConfig.path;
}

function getPluginConfig(pluginConfig) {
  return typeof pluginConfig === 'string' ? undefined : pluginConfig.config;
}

function getPipelineDestinations(pipeline) {
  if (Array.isArray(pipeline.destinations)) {
    return pipeline.destinations;
  }
  return pipeline.destination ? [pipeline.destination] : [];
}

function getMaxAttempts(pipeline) {
  return pipeline.retry?.maxAttempts ?? pipeline.retry?.max_attempts ?? 3;
}

export function createServer(deps) {
  const { pipelineLoader, pluginLoader, queue, db, logger } = deps;
  const server = Fastify({ logger: false });

  server.addContentTypeParser('application/json', { parseAs: 'buffer' }, (req, body, done) => {
    req.rawBody = body;
    try {
      done(null, JSON.parse(body));
    } catch (error) {
      done(error);
    }
  });

  server.get('/health', async () => ({
    status: 'ok',
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
  }));

  server.post('/hook/:pipelineId', async (request, reply) => {
    try {
      const { pipelineId } = request.params;
      const pipeline = await pipelineLoader.get(pipelineId);

      if (!pipeline) {
        return reply.code(404).send({ error: 'Pipeline not found' });
      }

      if (pipeline.auth) {
        const authResult = verifyWebhookAuth(request.rawBody ?? request.raw.rawBody, request.headers, pipeline.auth);
        if (!authResult.valid) {
          return reply.code(401).send({
            error: 'Authentication failed',
            details: authResult.error,
          });
        }
      }

      let payload = request.body;

      if (pipeline.filter) {
        const filter = await pluginLoader.loadFilter(getPluginPath(pipeline.filter));
        const filterResult = await filter(payload, request.headers, pipeline.filter_config || getPluginConfig(pipeline.filter) || {});
        if (filterResult?.pass === false) {
          incrementStat(db, pipeline.id ?? pipelineId, 'total_filtered');
          return reply.code(200).send({
            status: 'filtered',
            reason: filterResult.reason,
          });
        }
      }

      if (pipeline.transform) {
        const transform = await pluginLoader.loadTransform(getPluginPath(pipeline.transform));
        const transformed = await transform(payload, request.headers, pipeline.filter_config || getPluginConfig(pipeline.transform) || {});
        if (transformed === null) {
          incrementStat(db, pipeline.id ?? pipelineId, 'total_filtered');
          return reply.code(200).send({
            status: 'filtered',
            reason: 'Transform returned null',
          });
        }
        payload = transformed;
      }

      const deliveryId = ulid();
      const resolvedPipelineId = pipeline.id ?? pipelineId;
      const headers = request.headers;

      insertDelivery(db, {
        id: deliveryId,
        pipelineId: resolvedPipelineId,
        payload,
        headers,
        sourceIp: request.ip,
        status: 'queued',
      });

      for (const destination of getPipelineDestinations(pipeline)) {
        await queue.enqueue({
          deliveryId,
          destinationId: destination.id,
          pipelineId: resolvedPipelineId,
          payload,
          headers,
          maxAttempts: getMaxAttempts(pipeline),
        });
      }

      incrementStat(db, resolvedPipelineId, 'total_received');

      return reply.code(200).send({ status: 'accepted', deliveryId });
    } catch (error) {
      logger?.error?.(error, 'Webhook ingestion failed');
      return reply.code(500).send({ error: 'Internal server error' });
    }
  });

  return server;
}
