import { DestinationAdapter } from './interface.js';
import { renderTemplate } from '../templates/handlebars.js';

export class HttpDestinationAdapter extends DestinationAdapter {
  get type() {
    return 'http';
  }

  async send(payload, destConfig, context) {
    const {
      url,
      method = 'POST',
      headers: configHeaders = {},
      body_template,
      timeout_ms = 10000,
    } = destConfig;

    const body = body_template
      ? renderTemplate(body_template, { payload, headers: context.headers, context })
      : JSON.stringify(payload);

    const headers = { 'Content-Type': 'application/json' };

    for (const [key, value] of Object.entries(configHeaders)) {
      headers[key] = value.replace(/\$\{(\w+)\}/g, (_, envVar) => process.env[envVar] ?? '');
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout_ms);
    const start = Date.now();

    try {
      const response = await fetch(url, {
        method,
        headers,
        body,
        signal: controller.signal,
      });

      const responseBody = await response.text();
      const statusCode = response.status;

      return {
        success: statusCode >= 200 && statusCode < 300,
        statusCode,
        responseBody,
        durationMs: Date.now() - start,
      };
    } catch (err) {
      return {
        success: false,
        statusCode: 0,
        error: err.name === 'AbortError' ? 'Request timeout' : err.message,
        durationMs: Date.now() - start,
      };
    } finally {
      clearTimeout(timer);
    }
  }
}
