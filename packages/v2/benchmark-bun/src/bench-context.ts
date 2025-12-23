import { onError } from '@orpc/server';
import { RPCHandler } from '@orpc/server/fetch';
import { CORSPlugin } from '@orpc/server/plugins';
import type { IV2BunTestContainerOptions } from '@teable/v2-container-bun-test';
import { createV2BunTestContainer } from '@teable/v2-container-bun-test';
import { createV2OrpcRouter } from '@teable/v2-contract-http-implementation';
import { NoopLogger, v2CoreTokens } from '@teable/v2-core';
import type { DependencyContainer } from '@teable/v2-di';

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

export type IBunBenchContext = {
  client: ReturnType<typeof createV2RpcClient>;
  baseId: string;
  dispose: () => Promise<void>;
};

export const createBunBenchContext = async (
  options: IV2BunTestContainerOptions = {}
): Promise<IBunBenchContext> => {
  console.log('[bun-bench] starting test container');
  const testContainer = await createV2BunTestContainer(options);
  testContainer.container.registerInstance(v2CoreTokens.logger, new NoopLogger());

  console.log('[bun-bench] test container ready');
  const server = startBunServer(testContainer.container);
  const baseUrl = `http://127.0.0.1:${server.port}/rpc`;
  const client = createV2RpcClient({ baseUrl });
  console.log(`[bun-bench] bun server ready at ${baseUrl}`);

  return {
    client,
    baseId: testContainer.baseId.toString(),
    dispose: async () => {
      console.log('[bun-bench] shutting down');
      try {
        server.stop();
      } finally {
        await testContainer.dispose();
      }
    },
  };
};
