/* eslint-disable @typescript-eslint/naming-convention */
// OTel semantic-convention attribute names, not application identifiers.

import type { IPgPoolSnapshot } from '@teable/db-main-prisma';

/**
 * Metric identity shared by the pool gauges and the queue-wait histogram.
 *
 * This module deliberately has no runtime dependency on `@teable/db-main-prisma`: importing
 * `PgPoolRegistry` loads `pg` before instrumentation is registered, which would disable the
 * `pg-pool.connect` spans that own the existing all-acquire histogram.
 */
export type DatabaseClientPoolMetricAttributes = {
  'db.namespace': string;
  'server.address': string;
  'db.client.application.name': string;
  'teable.database.pool.name': string;
  'server.port'?: number;
};

export const databaseClientPoolAttributes = (
  snapshot: IPgPoolSnapshot
): DatabaseClientPoolMetricAttributes => ({
  'db.namespace': snapshot.database,
  'server.address': snapshot.host,
  'db.client.application.name': snapshot.applicationName,
  'teable.database.pool.name': snapshot.poolName ?? 'shared',
  ...(snapshot.port ? { 'server.port': snapshot.port } : {}),
});
