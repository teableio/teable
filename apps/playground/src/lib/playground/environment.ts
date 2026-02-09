import { useRouterState } from '@tanstack/react-router';

import {
  PLAYGROUND_ACTOR_ID,
  PLAYGROUND_BASE_ID,
  PLAYGROUND_BASE_ID_STORAGE_KEY,
  PLAYGROUND_BASE_NAME,
  PLAYGROUND_SPACE_ID,
  PLAYGROUND_TABLE_ID_STORAGE_KEY,
  SANDBOX_ACTOR_ID,
  SANDBOX_BASE_ID,
  SANDBOX_BASE_ID_STORAGE_KEY,
  SANDBOX_BASE_NAME,
  SANDBOX_PGLITE_CONNECTION_STRING,
  SANDBOX_SPACE_ID,
  SANDBOX_TABLE_ID_STORAGE_KEY,
} from './constants';

const remoteEnvironment = {
  kind: 'remote',
  routes: {
    index: '/',
    base: '/$baseId',
    table: '/$baseId/$tableId',
    record: '/$baseId/$tableId/$recordId',
  },
  storageKeys: {
    baseId: PLAYGROUND_BASE_ID_STORAGE_KEY,
    tableId: PLAYGROUND_TABLE_ID_STORAGE_KEY,
  },
  defaults: {
    baseId: PLAYGROUND_BASE_ID,
    baseName: PLAYGROUND_BASE_NAME,
    spaceId: PLAYGROUND_SPACE_ID,
    actorId: PLAYGROUND_ACTOR_ID,
  },
} as const;

const sandboxEnvironment = {
  kind: 'sandbox',
  routes: {
    index: '/sandbox',
    base: '/sandbox/$baseId',
    table: '/sandbox/$baseId/$tableId',
    record: '/sandbox/$baseId/$tableId/$recordId',
  },
  storageKeys: {
    baseId: SANDBOX_BASE_ID_STORAGE_KEY,
    tableId: SANDBOX_TABLE_ID_STORAGE_KEY,
  },
  defaults: {
    baseId: SANDBOX_BASE_ID,
    baseName: SANDBOX_BASE_NAME,
    spaceId: SANDBOX_SPACE_ID,
    actorId: SANDBOX_ACTOR_ID,
  },
  pgliteConnectionString: SANDBOX_PGLITE_CONNECTION_STRING,
} as const;

export type PlaygroundEnvironment = typeof remoteEnvironment | typeof sandboxEnvironment;

export const resolvePlaygroundEnvironment = (pathname?: string | null): PlaygroundEnvironment => {
  if (pathname && pathname.startsWith('/sandbox')) {
    return sandboxEnvironment;
  }
  return remoteEnvironment;
};

export const usePlaygroundEnvironment = (): PlaygroundEnvironment => {
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  return resolvePlaygroundEnvironment(pathname);
};

export const resolveBaseName = (env: PlaygroundEnvironment, baseId: string): string => {
  return baseId === env.defaults.baseId ? env.defaults.baseName : baseId;
};
