import { coreInfo } from '@ai-erp/core';
import Fastify, { type FastifyInstance } from 'fastify';

/** Builds the HTTP app without listening, so tests can inject requests. */
export function buildApp(): FastifyInstance {
  const app = Fastify({ logger: false });

  app.get('/health', async () => ({ status: 'ok', ...coreInfo() }));

  return app;
}
