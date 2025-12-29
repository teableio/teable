import type { ILogger } from '@teable/v2-core';
import { v2CoreTokens } from '@teable/v2-core';
import type { DependencyContainer } from '@teable/v2-di';
import ShareDb from 'sharedb';
import type PubSubClass from 'sharedb/lib/pubsub';
import memoryPubSubModule from 'sharedb/lib/pubsub/memory';
import { WebSocketServer } from 'ws';

import {
  ShareDbBackendPublisher,
  ShareDbWebSocketServer,
  registerV2ShareDbRealtime,
} from '@teable/v2-adapter-realtime-sharedb';

const PubSub = ((memoryPubSubModule as { default?: unknown }).default ??
  memoryPubSubModule) as new () => PubSubClass;

const DEFAULT_SHAREDB_PORT = 3101;

type ShareDbRuntime = {
  backend: ShareDb;
  pubsub: PubSubClass;
  wsServer: WebSocketServer;
  port: number;
};

let runtimePromise: Promise<ShareDbRuntime> | undefined;
let globalRuntimePromise: Promise<ShareDbRuntime> | undefined;

const resolveGlobalRuntime = (): Promise<ShareDbRuntime> | undefined => {
  const globalScope = globalThis as { __playgroundShareDbRuntimePromise?: Promise<ShareDbRuntime> };
  return globalScope.__playgroundShareDbRuntimePromise;
};

const registerGlobalRuntime = (promise: Promise<ShareDbRuntime>): void => {
  const globalScope = globalThis as { __playgroundShareDbRuntimePromise?: Promise<ShareDbRuntime> };
  globalScope.__playgroundShareDbRuntimePromise = promise;
  globalRuntimePromise = promise;
};

const resolveShareDbPort = (): number => {
  const fromEnv = process.env.PLAYGROUND_SHAREDB_PORT ?? process.env.SHAREDB_PORT;
  const parsed = fromEnv ? Number(fromEnv) : NaN;
  if (!Number.isNaN(parsed) && parsed > 0) {
    return parsed;
  }
  return DEFAULT_SHAREDB_PORT;
};

const startShareDbRuntime = async (logger?: ILogger): Promise<ShareDbRuntime> => {
  const pubsub = new PubSub();
  const backend = new ShareDb({ pubsub });
  const port = resolveShareDbPort();
  const wsServer = new WebSocketServer({ port, path: '/socket' });
  const shareDbWebSocket = new ShareDbWebSocketServer(backend, logger);
  shareDbWebSocket.attach(wsServer);
  return { backend, pubsub, wsServer, port };
};

export const ensureShareDbRuntime = async (logger?: ILogger): Promise<ShareDbRuntime> => {
  if (!runtimePromise) {
    const existing = globalRuntimePromise ?? resolveGlobalRuntime();
    runtimePromise = existing ?? startShareDbRuntime(logger);
    if (!existing) {
      registerGlobalRuntime(runtimePromise);
    }
  }
  return runtimePromise;
};

export const registerPlaygroundShareDbRealtime = async (
  container: DependencyContainer
): Promise<void> => {
  const logger = container.resolve<ILogger>(v2CoreTokens.logger);
  const runtime = await ensureShareDbRuntime(logger);
  registerV2ShareDbRealtime(container, {
    publisher: new ShareDbBackendPublisher(runtime.backend, logger),
  });
};
