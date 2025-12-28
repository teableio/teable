import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { ContractRouterClient } from '@orpc/contract';
import { onError } from '@orpc/server';
import { RPCHandler } from '@orpc/server/fetch';
import { CORSPlugin } from '@orpc/server/plugins';
import type { IV2BunTestContainerOptions } from '@teable/v2-container-bun-test';
import { createV2BunTestContainer } from '@teable/v2-container-bun-test';
import type { v2Contract } from '@teable/v2-contract-http';
import { createV2HttpClient } from '@teable/v2-contract-http-client';
import { createV2ExpressRouter } from '@teable/v2-contract-http-express';
import { createV2FastifyPlugin } from '@teable/v2-contract-http-fastify';
import { createV2HonoApp } from '@teable/v2-contract-http-hono';
import { createV2OrpcRouter } from '@teable/v2-contract-http-implementation';
import { NoopLogger, v2CoreTokens } from '@teable/v2-core';
import type { DependencyContainer } from '@teable/v2-di';
import express from 'express';
import fastify from 'fastify';

import { createV2RpcClient } from './rpc-client';

type IBunServer = {
  port: number;
  stop: (closeConnections?: boolean) => void;
};

type IBunServeOptions = {
  port?: number;
  hostname?: string;
  fetch: (request: Request) => Response | Promise<Response>;
};

type IBunRuntime = {
  serve: (options: IBunServeOptions) => IBunServer;
};

type IBunBenchClient = ContractRouterClient<typeof v2Contract>;

export type IBunBenchTarget = {
  name: string;
  client: IBunBenchClient;
  close: () => Promise<void>;
};

const getBunRuntime = (): IBunRuntime => {
  const bun = (globalThis as Record<string, unknown>)['Bun'] as IBunRuntime | undefined;
  if (!bun) {
    throw new Error('Bun runtime is required for v2 bun benchmarks.');
  }
  return bun;
};

const startBunServer = (container: DependencyContainer): IBunServer => {
  const orpcRouter = createV2OrpcRouter({
    createContainer: () => container,
  });
  const handler = new RPCHandler(orpcRouter, {
    plugins: [new CORSPlugin()],
    interceptors: [
      onError((error) => {
        console.error(error);
      }),
    ],
  });

  const bun = getBunRuntime();

  return bun.serve({
    port: 0,
    hostname: '127.0.0.1',
    async fetch(request: Request) {
      const { matched, response } = await handler.handle(request, {
        prefix: '/rpc',
        context: {},
      });

      if (matched) {
        return response;
      }

      return new Response('Not found', { status: 404 });
    },
  });
};

const createBunRpcTarget = (container: DependencyContainer): IBunBenchTarget => {
  const server = startBunServer(container);
  const baseUrl = `http://127.0.0.1:${server.port}/rpc`;
  const client = createV2RpcClient({ baseUrl });
  console.log(`[bun-bench] bun-rpc server ready at ${baseUrl}`);

  return {
    name: 'bun-rpc',
    client,
    close: async () => {
      server.stop();
    },
  };
};

const setupExpress = async (container: DependencyContainer): Promise<IBunBenchTarget> => {
  const app = express();
  app.use(
    createV2ExpressRouter({
      createContainer: () => container,
    })
  );

  const server = await new Promise<Server>((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });

  const address = server.address() as AddressInfo;
  const baseUrl = `http://127.0.0.1:${address.port}`;
  const client = createV2HttpClient({ baseUrl });
  console.log(`[bun-bench] express server ready at ${baseUrl}`);

  return {
    name: 'express',
    client,
    close: async () => {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
};

const setupFastify = async (container: DependencyContainer): Promise<IBunBenchTarget> => {
  const app = fastify();
  await app.register(
    createV2FastifyPlugin({
      createContainer: () => container,
    })
  );
  await app.listen({ port: 0, host: '127.0.0.1' });

  const address = app.server.address() as AddressInfo;
  const baseUrl = `http://127.0.0.1:${address.port}`;
  const client = createV2HttpClient({ baseUrl });
  console.log(`[bun-bench] fastify server ready at ${baseUrl}`);

  return {
    name: 'fastify',
    client,
    close: async () => {
      await app.close();
    },
  };
};

const setupHono = async (container: DependencyContainer): Promise<IBunBenchTarget> => {
  const app = createV2HonoApp({
    createContainer: () => container,
  });
  const bun = getBunRuntime();
  const server = bun.serve({ fetch: app.fetch, port: 0, hostname: '127.0.0.1' });
  const baseUrl = `http://127.0.0.1:${server.port}`;
  const client = createV2HttpClient({ baseUrl });
  console.log(`[bun-bench] hono server ready at ${baseUrl}`);

  return {
    name: 'hono',
    client,
    close: async () => {
      server.stop();
    },
  };
};

export type IBunBenchContext = {
  client: IBunBenchClient;
  baseId: string;
  dispose: () => Promise<void>;
};

export type IBunBenchTargetsContext = {
  baseId: string;
  targets: IBunBenchTarget[];
  dispose: () => Promise<void>;
};

export const createBunBenchContext = async (
  options: IV2BunTestContainerOptions = {}
): Promise<IBunBenchContext> => {
  console.log('[bun-bench] starting test container');
  const testContainer = await createV2BunTestContainer(options);
  testContainer.container.registerInstance(v2CoreTokens.logger, new NoopLogger());

  console.log('[bun-bench] test container ready');
  const bunTarget = createBunRpcTarget(testContainer.container);

  return {
    client: bunTarget.client,
    baseId: testContainer.baseId.toString(),
    dispose: async () => {
      console.log('[bun-bench] shutting down');
      try {
        await bunTarget.close();
      } finally {
        await testContainer.dispose();
      }
    },
  };
};

export const createBunBenchTargets = async (
  options: IV2BunTestContainerOptions = {}
): Promise<IBunBenchTargetsContext> => {
  console.log('[bun-bench] starting test container');
  const testContainer = await createV2BunTestContainer(options);
  testContainer.container.registerInstance(v2CoreTokens.logger, new NoopLogger());

  console.log('[bun-bench] test container ready');
  const bunTarget = createBunRpcTarget(testContainer.container);
  const expressTarget = await setupExpress(testContainer.container);
  const fastifyTarget = await setupFastify(testContainer.container);
  const honoTarget = await setupHono(testContainer.container);
  const targets = [bunTarget, expressTarget, fastifyTarget, honoTarget];

  return {
    baseId: testContainer.baseId.toString(),
    targets,
    dispose: async () => {
      console.log('[bun-bench] shutting down');
      try {
        for (const target of targets) {
          await target.close();
        }
      } finally {
        await testContainer.dispose();
      }
    },
  };
};
