const PLAYGROUND_DB_URL_STORAGE_KEY = 'teable.playground.dbUrl';
const PLAYGROUND_DB_CONNECTIONS_STORAGE_KEY = 'teable.playground.dbConnections';
const PLAYGROUND_DB_URL_HEADER = 'x-playground-db-url';
const PLAYGROUND_DB_URL_QUERY_PARAM = 'dbUrl';

export interface PlaygroundDbConnection {
  id: string;
  name: string;
  description?: string;
  url: string;
  pinned?: boolean;
  createdAt?: number;
  lastUsedAt?: number;
}

const parseStoredValue = (raw: string): string | null => {
  try {
    const parsed = JSON.parse(raw);
    if (typeof parsed === 'string') return parsed.trim() || null;
    if (parsed === null || parsed === undefined) return null;
  } catch {
    return raw.trim() || null;
  }
  return null;
};

export const readPlaygroundDbUrl = (): string | null => {
  if (typeof window === 'undefined') return null;
  const raw = window.localStorage.getItem(PLAYGROUND_DB_URL_STORAGE_KEY);
  if (!raw) return null;
  return parseStoredValue(raw);
};

export const resolvePlaygroundDbUrl = (storedDbUrl?: string | null): string | null => {
  if (storedDbUrl && storedDbUrl.trim()) return storedDbUrl;
  if (typeof storedDbUrl !== 'undefined') {
    return readPlaygroundDbUrlFromEnv();
  }
  return readPlaygroundDbUrl() ?? readPlaygroundDbUrlFromEnv();
};

export const readPlaygroundDbUrlFromEnv = (): string | null => {
  if (typeof import.meta === 'undefined') return null;
  const envUrl = import.meta.env?.VITE_PLAYGROUND_DB_URL ?? import.meta.env?.VITE_DATABASE_URL;
  if (!envUrl) return null;
  const trimmed = envUrl.trim();
  return trimmed.length > 0 ? trimmed : null;
};

export const maskPlaygroundDbUrl = (value: string): string => {
  try {
    const url = new URL(value);
    if (url.password) {
      url.password = '';
    }
    return url.toString().replace(/:@/, '@');
  } catch {
    return value.replace(/\/\/([^:/?#]+):([^@/]+)@/, '//$1@');
  }
};

export const writePlaygroundDbUrl = (value: string | null): void => {
  if (typeof window === 'undefined') return;
  if (!value) {
    window.localStorage.removeItem(PLAYGROUND_DB_URL_STORAGE_KEY);
    return;
  }
  window.localStorage.setItem(PLAYGROUND_DB_URL_STORAGE_KEY, JSON.stringify(value));
};

export const isValidPlaygroundDbUrl = (value: string): boolean => {
  try {
    const url = new URL(value);
    return url.protocol === 'postgres:' || url.protocol === 'postgresql:';
  } catch {
    return false;
  }
};

export const formatPlaygroundDbUrlLabel = (value: string): string => {
  try {
    const url = new URL(value);
    const host = url.hostname + (url.port ? `:${url.port}` : '');
    const dbName = url.pathname.replace(/^\//, '');
    if (!dbName) return host;
    return `${host}/${dbName}`;
  } catch {
    return 'Custom database';
  }
};

export const normalizePlaygroundDbUrl = (value: string): string => value.trim();

export const findPlaygroundDbConnectionByUrl = (
  connections: PlaygroundDbConnection[],
  dbUrl: string | null
): PlaygroundDbConnection | null => {
  if (!dbUrl) return null;
  const normalized = normalizePlaygroundDbUrl(dbUrl);
  if (!normalized) return null;
  return (
    connections.find((connection) => normalizePlaygroundDbUrl(connection.url) === normalized) ??
    null
  );
};

export const resolvePlaygroundDbStorageKey = (
  baseKey: string,
  options: { connectionId?: string | null; dbUrl?: string | null }
): string => {
  if (options.connectionId) {
    return `${baseKey}:${options.connectionId}`;
  }
  if (options.dbUrl) {
    const normalized = normalizePlaygroundDbUrl(options.dbUrl);
    if (normalized) {
      return `${baseKey}:url:${encodeURIComponent(normalized)}`;
    }
  }
  return baseKey;
};

const parseStoredConnections = (raw: string): PlaygroundDbConnection[] => {
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const connections: PlaygroundDbConnection[] = [];
    for (const item of parsed) {
      if (!item || typeof item !== 'object') continue;
      const record = item as Partial<PlaygroundDbConnection>;
      if (!record.id || !record.name || !record.url) continue;
      connections.push({
        id: String(record.id),
        name: String(record.name),
        description: record.description ? String(record.description) : undefined,
        url: String(record.url),
        pinned: Boolean(record.pinned),
        createdAt: typeof record.createdAt === 'number' ? record.createdAt : undefined,
        lastUsedAt: typeof record.lastUsedAt === 'number' ? record.lastUsedAt : undefined,
      });
    }
    return connections;
  } catch {
    return [];
  }
};

export const readPlaygroundDbConnections = (): PlaygroundDbConnection[] => {
  if (typeof window === 'undefined') return [];
  const raw = window.localStorage.getItem(PLAYGROUND_DB_CONNECTIONS_STORAGE_KEY);
  if (!raw) return [];
  return parseStoredConnections(raw);
};

export const writePlaygroundDbConnections = (connections: PlaygroundDbConnection[]): void => {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(PLAYGROUND_DB_CONNECTIONS_STORAGE_KEY, JSON.stringify(connections));
};

export const createPlaygroundDbConnectionId = (): string => {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }
  return `db-${Date.now()}-${Math.random().toString(16).slice(2)}`;
};

export const sortPlaygroundDbConnections = (
  connections: PlaygroundDbConnection[]
): PlaygroundDbConnection[] =>
  [...connections].sort((left, right) => {
    const pinnedDiff = Number(!!right.pinned) - Number(!!left.pinned);
    if (pinnedDiff !== 0) return pinnedDiff;
    const lastUsedDiff = (right.lastUsedAt ?? 0) - (left.lastUsedAt ?? 0);
    if (lastUsedDiff !== 0) return lastUsedDiff;
    return left.name.localeCompare(right.name);
  });

export {
  PLAYGROUND_DB_URL_HEADER,
  PLAYGROUND_DB_URL_QUERY_PARAM,
  PLAYGROUND_DB_URL_STORAGE_KEY,
  PLAYGROUND_DB_CONNECTIONS_STORAGE_KEY,
};
