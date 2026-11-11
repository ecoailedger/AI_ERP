import type { Core } from '@ai-erp/core';
import { FIGURE_IDS, isIsoDate, RECORD_TYPES, type FigureId, type IsoDate, type RecordType } from '@ai-erp/domain';
import Fastify, { type FastifyInstance, type FastifyReply } from 'fastify';

type Query = Record<string, string | undefined>;

/** Builds the HTTP app over a core, without listening, so tests can inject requests. */
export function buildApp(core: Core): FastifyInstance {
  const app = Fastify({ logger: false });
  const { range } = core.master();

  /** Reads a date from the query. Missing means the latest date; out of range is pulled into range. */
  const dateParam = (value: string | undefined, fallback: IsoDate, reply: FastifyReply): IsoDate | null => {
    if (value === undefined) return fallback;
    if (!isIsoDate(value)) {
      void reply.code(400).send({ error: `"${value}" is not a date. Use YYYY-MM-DD.` });
      return null;
    }
    return core.clamp(value);
  };

  app.get('/health', async () => ({ status: 'ok', source: core.master().source, range }));

  app.get('/master', async () => core.master());

  app.get<{ Querystring: Query }>('/state', async (request, reply) => {
    const at = dateParam(request.query.at, range.end, reply);
    if (at === null) return reply;
    return core.state(at);
  });

  app.get<{ Querystring: Query }>('/events', async (request, reply) => {
    const to = dateParam(request.query.to, range.end, reply);
    if (to === null) return reply;
    const from = dateParam(request.query.from, to, reply);
    if (from === null) return reply;
    return { from, to, events: core.events(from, to) };
  });

  app.get<{ Params: { type: string; id: string }; Querystring: Query }>('/records/:type/:id', async (request, reply) => {
    const { type, id } = request.params;
    if (!(RECORD_TYPES as readonly string[]).includes(type)) {
      return reply.code(400).send({ error: `Unknown record type "${type}".` });
    }
    const at = dateParam(request.query.at, range.end, reply);
    if (at === null) return reply;
    const card = core.record({ type: type as RecordType, id }, at);
    if (!card) return reply.code(404).send({ error: `No ${type} ${id} on ${at}.` });
    return card;
  });

  app.get<{ Params: { name: string }; Querystring: Query }>('/figures/:name/records', async (request, reply) => {
    const { name } = request.params;
    if (!(FIGURE_IDS as readonly string[]).includes(name)) {
      return reply.code(400).send({ error: `Unknown figure "${name}".` });
    }
    const at = dateParam(request.query.at, range.end, reply);
    if (at === null) return reply;
    return core.figureRecords(name as FigureId, at);
  });

  return app;
}
