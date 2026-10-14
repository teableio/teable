import { createHash, timingSafeEqual } from 'node:crypto';
import Fastify from 'fastify';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { processEvent } from './actions.js';
import type { IConfig } from './config.js';
import { runDigest } from './digest.js';
import type { IDigestRunResult } from './digest.js';
import { isRecordEvent, verifySignature } from './events.js';
import type { ILogger } from './logger.js';
import type { IMailer } from './mail.js';
import type { ITeableClient } from './teable.js';

export interface IServerContext {
  config: IConfig;
  logger: ILogger;
  teable: ITeableClient;
  mailer: IMailer;
}

export interface IDigestState {
  at: string;
  ok: boolean;
  recipients: string[];
  totalRecords: number;
  error?: string;
}

export interface IServerState {
  startedAt: string;
  lastDigest?: IDigestState;
}

type WithRawBody = FastifyRequest & { rawBody?: string };

const tokenMatches = (received: string, expected: string): boolean =>
  timingSafeEqual(
    createHash('sha256').update(received).digest(),
    createHash('sha256').update(expected).digest()
  );

export const buildServer = (
  ctx: IServerContext
): {
  app: FastifyInstance;
  state: IServerState;
  runDigestNow: (trigger: string) => Promise<IDigestRunResult>;
} => {
  const { config, logger, teable, mailer } = ctx;
  const app = Fastify({ logger: false, bodyLimit: 1024 * 1024 });
  const state: IServerState = { startedAt: new Date().toISOString() };

  // Keep the raw body around for HMAC verification of forwarded events.
  app.addContentTypeParser('application/json', { parseAs: 'string' }, (req, body, done) => {
    (req as WithRawBody).rawBody = typeof body === 'string' ? body : '';
    if (!body) {
      done(null, {});
      return;
    }
    try {
      done(null, JSON.parse(body as string));
    } catch (error) {
      done(error as Error);
    }
  });

  const requireInternalToken = async (
    request: FastifyRequest,
    reply: FastifyReply
  ): Promise<void> => {
    const expected = config.env.SSA_INTERNAL_TOKEN;
    const received = request.headers['x-ssa-token'];
    if (!expected) {
      await reply.code(503).send({ message: 'SSA_INTERNAL_TOKEN is not configured' });
      return;
    }
    if (typeof received !== 'string' || !tokenMatches(received, expected)) {
      await reply.code(403).send({ message: 'invalid token' });
      return;
    }
  };

  const runDigestNow = async (trigger: string): Promise<IDigestRunResult> => {
    logger.info('digest starting', { trigger });
    try {
      const result = await runDigest({ config, teable, mailer, logger });
      state.lastDigest = {
        at: new Date().toISOString(),
        ok: true,
        recipients: result.recipients,
        totalRecords: result.totalRecords,
      };
      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      state.lastDigest = {
        at: new Date().toISOString(),
        ok: false,
        recipients: [],
        totalRecords: 0,
        error: message,
      };
      logger.error('digest failed', { error: message });
      throw error;
    }
  };

  app.get('/healthz', async () => ({
    ok: true,
    startedAt: state.startedAt,
    rules: config.rules.length,
    digestSections: config.digest.sections.length,
    digestCron: config.env.SSA_DIGEST_CRON,
    digestTz: config.env.SSA_DIGEST_TZ,
    digestRecipients: config.env.SSA_DIGEST_RECIPIENTS.length,
    mailConfigured: mailer.isConfigured(),
    dryRun: config.env.SSA_DRY_RUN,
    lastDigest: state.lastDigest,
  }));

  app.post('/events', async (request, reply) => {
    const secret = config.env.SSA_EVENTS_WEBHOOK_SECRET;
    if (!secret) {
      return reply.code(503).send({ message: 'SSA_EVENTS_WEBHOOK_SECRET is not configured' });
    }

    const signature = request.headers['x-ssa-signature'];
    const rawBody = (request as WithRawBody).rawBody ?? '';
    if (typeof signature !== 'string' || !verifySignature(secret, rawBody, signature)) {
      logger.warn('rejected event with invalid signature', {
        remote: request.ip,
      });
      return reply.code(401).send({ message: 'invalid signature' });
    }

    if (!isRecordEvent(request.body)) {
      return reply.code(400).send({ message: 'not a record event' });
    }

    const fired = await processEvent(request.body, { config, teable, mailer, logger });
    return reply.code(202).send({ accepted: true, fired });
  });

  app.post('/digest/run', { preHandler: requireInternalToken }, async (_request, reply) => {
    try {
      const result = await runDigestNow('manual');
      return reply.code(200).send(result);
    } catch (error) {
      return reply
        .code(500)
        .send({ message: error instanceof Error ? error.message : String(error) });
    }
  });

  return { app, state, runDigestNow };
};
