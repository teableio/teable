import { context, createContextKey, SpanStatusCode } from '@opentelemetry/api';
import type { Span } from '@opentelemetry/api';
import { LRUCache } from 'lru-cache';

type IEnv = Record<string, string | undefined>;

export type ITraceDbRole = 'meta' | 'data';

export type ITraceDbConnection = {
  database?: string;
  host?: string;
  port?: number | string;
  user?: string;
};

export type ITraceDbContext = {
  role: ITraceDbRole;
  url: string;
  source: string;
};

export type ITraceDbSpan = {
  setAttribute(key: string, value: string): void;
};

const REDACT_PG_PARAMETER_VALUES = createContextKey('teable.redact-pg-parameter-values');
const REDACTED_PG_ERROR_MESSAGE = 'PostgreSQL query failed (details redacted)';

export const withPgParameterRedaction = <T>(callback: () => T): T =>
  context.with(context.active().setValue(REDACT_PG_PARAMETER_VALUES, true), callback);

export const redactTeablePgQuerySpan = (
  span: Pick<Span, 'setAttribute' | 'setStatus' | 'recordException'>
) => {
  if (context.active().getValue(REDACT_PG_PARAMETER_VALUES) !== true) return;

  span.setAttribute('db.postgresql.values', '[REDACTED]');

  // instrumentation-pg 0.74 calls requestHook before execution; responseHook is success-only.
  // Every failure path records an exception, sets the raw error status, then ends the span.
  // Intercept those writes on this span only, including callbacks outside the active context.
  const { setStatus, recordException } = span;
  span.setStatus = (status) =>
    setStatus.call(
      span,
      status.code === SpanStatusCode.ERROR
        ? { code: SpanStatusCode.ERROR, message: REDACTED_PG_ERROR_MESSAGE }
        : status
    );
  span.recordException = (exception, time) => {
    // The installed instrumentation passes this sanitized string, not the original PG error.
    // Accept only its SQLSTATE field; never forward its error name, arbitrary text or stack.
    const sqlState =
      typeof exception === 'string'
        ? /^PostgreSQL error of type '[^']*' occurred \(code: ([0-9A-Z]{5})\)$/.exec(exception)?.[1]
        : undefined;
    span.setAttribute('error.type', sqlState ?? 'PostgreSQLError');
    recordException.call(
      span,
      { name: 'PostgreSQLError', message: REDACTED_PG_ERROR_MESSAGE },
      time
    );
  };
};

const META_DATABASE_URL_KEYS = ['PRISMA_META_DATABASE_URL', 'PRISMA_DATABASE_URL', 'DATABASE_URL'];

const normalizeDatabaseName = (value?: string) => value?.replace(/^\//, '') || undefined;

const normalizePort = (value?: string | number) => {
  if (value == null || value === '') {
    return 5432;
  }

  const port = Number(value);
  return Number.isFinite(port) ? port : 5432;
};

const normalizeConnection = (connection: ITraceDbConnection) => ({
  database: normalizeDatabaseName(connection.database),
  host: connection.host?.toLowerCase(),
  port: normalizePort(connection.port),
  user: connection.user,
});

type ParsedDatabaseUrl = {
  database: string | undefined;
  host: string;
  port: number;
  user: string | undefined;
  url: string;
};

export const parseDatabaseUrlCache = new LRUCache<string, ParsedDatabaseUrl>({ max: 100 });

export const parseDatabaseUrl = (url: string | undefined): ParsedDatabaseUrl | undefined => {
  if (!url) {
    return;
  }

  const cached = parseDatabaseUrlCache.get(url);
  if (cached) {
    return cached;
  }

  try {
    const parsed = new URL(url);
    const userPart = parsed.username ? `${decodeURIComponent(parsed.username)}@` : '';
    const port = normalizePort(parsed.port);
    const database = normalizeDatabaseName(parsed.pathname);

    const result = {
      database,
      host: parsed.hostname.toLowerCase(),
      port,
      user: parsed.username ? decodeURIComponent(parsed.username) : undefined,
      url: `${parsed.protocol}//${userPart}${parsed.hostname}${parsed.port ? `:${parsed.port}` : ''}${database ? `/${database}` : ''}`,
    };
    parseDatabaseUrlCache.set(url, result);
    return result;
  } catch {
    return undefined;
  }
};

const findMatchingDatabaseUrl = (
  connection: ReturnType<typeof normalizeConnection>,
  keys: string[],
  env: IEnv
) => {
  for (const key of keys) {
    const candidate = parseDatabaseUrl(env[key]);
    if (!candidate) {
      continue;
    }

    if (
      candidate.host === connection.host &&
      candidate.port === connection.port &&
      candidate.database === connection.database
    ) {
      return { key, url: candidate.url };
    }
  }
};

const buildConnectionUrl = (connection: ReturnType<typeof normalizeConnection>) => {
  const userPart = connection.user ? `${connection.user}@` : '';
  const host = connection.host || 'unknown-host';
  const databasePart = connection.database ? `/${connection.database}` : '';
  return `postgresql://${userPart}${host}:${connection.port}${databasePart}`;
};

export const resolveTeableDbTraceContext = (
  connection: ITraceDbConnection,
  env: IEnv = process.env
): ITraceDbContext => {
  const normalized = normalizeConnection(connection);
  const metaMatch = findMatchingDatabaseUrl(normalized, META_DATABASE_URL_KEYS, env);
  if (metaMatch) {
    return {
      role: 'meta',
      url: metaMatch.url,
      source: metaMatch.key,
    };
  }

  return {
    role: 'data',
    url: buildConnectionUrl(normalized),
    source: 'inferred.non_meta_postgres',
  };
};

export const setTeableDbSpanAttributes = (
  span: ITraceDbSpan,
  connection: ITraceDbConnection,
  env: IEnv = process.env
) => {
  const context = resolveTeableDbTraceContext(connection, env);
  span.setAttribute('teable.db.role', context.role);
  span.setAttribute('teable.db.url', context.url);
  span.setAttribute('teable.db.source', context.source);
};

export const setTeableDbSpanAttributesFromSpan = (
  span: ITraceDbSpan & { attributes?: Record<string, unknown> },
  env: IEnv = process.env
) => {
  const attributes = span.attributes ?? {};
  const host = attributes['net.peer.name'] ?? attributes['server.address'];
  const port = attributes['net.peer.port'] ?? attributes['server.port'];
  const database = attributes['db.name'] ?? attributes['db.namespace'];
  const user = attributes['db.user'] ?? attributes['db.user.name'];

  if (!host && !database) {
    return;
  }

  setTeableDbSpanAttributes(
    span,
    {
      database: typeof database === 'string' ? database : undefined,
      host: typeof host === 'string' ? host : undefined,
      port: typeof port === 'string' || typeof port === 'number' ? port : undefined,
      user: typeof user === 'string' ? user : undefined,
    },
    env
  );
};
