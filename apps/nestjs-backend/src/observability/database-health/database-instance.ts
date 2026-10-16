import { createHash } from 'node:crypto';

/**
 * Opaque per-database-instance identity.
 *
 * The external collector derives the same id from the same inputs, so the derivation
 * below is a wire contract and must stay byte-identical:
 *
 *   instanceId = 'dbh_' + sha256hex('teable.db.instance.v1|' + host.toLowerCase() + '|' + port).slice(0, 20)
 *
 * Only the endpoint goes in, and it comes out hashed: no host, port, database, user or
 * password text can leak into a metric label or a diagnostic record, while the id still
 * joins per-instance operation metrics, pool gauges and trace aggregates together.
 * Several customer projects may share one pooler endpoint, so the id identifies the
 * endpoint only — `teable.database.connection.id` disambiguates them.
 */
export const DATABASE_INSTANCE_ID_NAMESPACE = 'teable.db.instance.v1';
export const DATABASE_INSTANCE_ID_PREFIX = 'dbh_';
export const DATABASE_INSTANCE_ID_LENGTH = 20;
export const DEFAULT_DATABASE_PORT = 5432;
/** Documented fallback for observations with no endpoint at all (never a hash of ''). */
export const UNKNOWN_DATABASE_INSTANCE_ID = 'dbh_unknown';

/** Which Teable role talks to an endpoint; `unknown` when a span carries no database name. */
export type DatabaseHealthRole = 'meta' | 'data' | 'unknown';
export const UNKNOWN_DATABASE_ROLE: DatabaseHealthRole = 'unknown';

const normalizeDatabasePort = (port: unknown): number => {
  if (typeof port === 'number') {
    return Number.isInteger(port) && port > 0 ? port : DEFAULT_DATABASE_PORT;
  }
  if (typeof port === 'string' && port.trim()) {
    const parsed = Number.parseInt(port, 10);
    if (Number.isInteger(parsed) && parsed > 0) {
      return parsed;
    }
  }
  return DEFAULT_DATABASE_PORT;
};

export const resolveDatabaseInstanceId = (connection: {
  host?: unknown;
  port?: unknown;
}): string => {
  const host = typeof connection.host === 'string' ? connection.host.trim().toLowerCase() : '';
  if (!host) {
    return UNKNOWN_DATABASE_INSTANCE_ID;
  }
  const digest = createHash('sha256')
    .update(`${DATABASE_INSTANCE_ID_NAMESPACE}|${host}|${normalizeDatabasePort(connection.port)}`)
    .digest('hex');
  return `${DATABASE_INSTANCE_ID_PREFIX}${digest.slice(0, DATABASE_INSTANCE_ID_LENGTH)}`;
};

/**
 * Endpoint attributes as emitted by instrumentation-pg. Stable semconv (`server.*`) and
 * legacy semconv (`net.peer.*`) are both accepted: a rolling deploy has mixed pods.
 */
export const resolveDatabaseInstanceFromSpanAttributes = (
  attributes: Record<string, unknown> | undefined
): string =>
  resolveDatabaseInstanceId({
    host: attributes?.['server.address'] ?? attributes?.['net.peer.name'],
    port: attributes?.['server.port'] ?? attributes?.['net.peer.port'],
  });
