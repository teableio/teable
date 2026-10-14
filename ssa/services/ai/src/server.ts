import { createHash, timingSafeEqual } from 'node:crypto';
import Fastify from 'fastify';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { runAgent } from './agent.js';
import type { IConfig } from './config.js';
import type { ILogger } from './logger.js';
import { createModelClient } from './openai.js';
import { createTeableToolClient, createToolExecutor, toolSpecs } from './tools.js';

export const chatBodySchema = z.object({
  messages: z
    .array(
      z.object({
        role: z.enum(['user', 'assistant']),
        content: z.string().min(1).max(8000),
      })
    )
    .min(1)
    .max(50),
  context: z
    .object({
      baseId: z.string().optional(),
      baseName: z.string().optional(),
      tableId: z.string().optional(),
      tableName: z.string().optional(),
      viewId: z.string().optional(),
    })
    .optional(),
  stream: z.boolean().optional(),
});

export type IChatBody = z.infer<typeof chatBodySchema>;

const tokenMatches = (received: string, expected: string): boolean =>
  timingSafeEqual(
    createHash('sha256').update(received).digest(),
    createHash('sha256').update(expected).digest()
  );

export interface IServerDeps {
  model?: ReturnType<typeof createModelClient>;
  tools?: ReturnType<typeof createToolExecutor>;
}

export const buildServer = (
  config: IConfig,
  logger: ILogger,
  deps: IServerDeps = {}
): FastifyInstance => {
  const app = Fastify({ logger: false, bodyLimit: 2 * 1024 * 1024 });

  const model =
    deps.model ??
    createModelClient(
      {
        baseUrl: config.env.SSA_AI_BASE_URL,
        apiKey: config.env.SSA_AI_API_KEY,
        model: config.env.SSA_AI_MODEL,
        temperature: config.env.SSA_AI_TEMPERATURE,
        timeoutMs: config.env.SSA_AI_REQUEST_TIMEOUT_MS,
      },
      logger
    );

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
    }
  };

  app.get('/healthz', async () => ({
    ok: true,
    enabled: config.env.SSA_AI_ENABLED,
    model: config.env.SSA_AI_MODEL,
    endpointHost: new URL(config.env.SSA_AI_BASE_URL).host,
    apiKeyConfigured: Boolean(config.env.SSA_AI_API_KEY),
    teableHost: new URL(config.env.SSA_TEABLE_BASE_URL).host,
    teableTokenConfigured: Boolean(config.env.SSA_TEABLE_API_TOKEN),
    tools: toolSpecs.map((spec) => spec.function.name),
  }));

  app.post('/chat', { preHandler: requireInternalToken }, async (request, reply) => {
    if (!config.env.SSA_AI_ENABLED) {
      return reply.code(503).send({ message: 'SSA assistant is disabled (SSA_AI_ENABLED=false)' });
    }

    const parsed = chatBodySchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ message: `invalid body: ${parsed.error.message}` });
    }
    const body = parsed.data;

    const toolClient = createTeableToolClient(
      { baseUrl: config.env.SSA_TEABLE_BASE_URL, token: config.env.SSA_TEABLE_API_TOKEN },
      logger
    );
    const tools =
      deps.tools ??
      createToolExecutor({
        client: toolClient,
        current: { baseId: body.context?.baseId, tableId: body.context?.tableId },
      });

    const agentParams = {
      history: body.messages,
      context: body.context,
      model,
      tools,
      logger,
      maxSteps: config.env.SSA_AI_MAX_STEPS,
      maxHistory: config.env.SSA_AI_MAX_HISTORY,
      systemPromptExtra: config.env.SSA_AI_SYSTEM_PROMPT || undefined,
    };

    if (body.stream === false) {
      let text = '';
      const activity: string[] = [];
      for await (const event of runAgent(agentParams)) {
        if (event.type === 'text') {
          text += event.text;
        } else if (event.type === 'tool') {
          activity.push(`${event.name}:${event.status}`);
        } else if (event.type === 'error') {
          return reply.code(502).send({ message: event.message, reply: text, activity });
        }
      }
      return reply.code(200).send({ reply: text, activity });
    }

    reply.raw.writeHead(200, {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
      'x-accel-buffering': 'no',
    });
    const send = (data: unknown) => {
      reply.raw.write(`data: ${JSON.stringify(data)}\n\n`);
    };

    try {
      for await (const event of runAgent(agentParams)) {
        send(event);
      }
    } catch (error) {
      logger.error('agent stream failed', {
        error: error instanceof Error ? error.message : String(error),
      });
      send({ type: 'error', message: error instanceof Error ? error.message : String(error) });
    } finally {
      reply.raw.write('data: [DONE]\n\n');
      reply.raw.end();
    }
    return reply;
  });

  return app;
};
