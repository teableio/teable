import type { OnModuleDestroy } from '@nestjs/common';
import { ConflictException, Injectable } from '@nestjs/common';
import { getMetaDatabaseUrl } from '@teable/db-data-prisma';
import { PrismaService } from '@teable/db-main-prisma';
import { V2PgTableSchemaCoordination } from '@teable/v2-adapter-db-postgres-pg';
import { ActorId } from '@teable/v2-core';
import { ClsService } from 'nestjs-cls';
import { Client } from 'pg';
import { DataDbRuntimeCacheService } from '../../global/data-db-runtime-cache.service';
import type { IClsStore } from '../../types/cls';

const actorColumns = [
  '__created_by_actor_type',
  '__created_by_actor_id',
  '__last_modified_by_actor_type',
  '__last_modified_by_actor_id',
];
const quoteIdent = (value: string) => `"${value.replaceAll('"', '""')}"`;
const physicalName = (value: string) => value.split('.').map(quoteIdent).join('.');

export interface IActorRoutingTransaction {
  $queryRawUnsafe<T>(sql: string, ...values: unknown[]): Promise<T>;
  $executeRawUnsafe(sql: string, ...values: unknown[]): Promise<number>;
}

export interface IActorRoutingLease {
  invalidateInTransaction(prisma: IActorRoutingTransaction): Promise<void>;
  assertInTransaction(prisma: IActorRoutingTransaction): Promise<void>;
  invalidateCaches(cacheKeys: readonly string[]): Promise<void>;
  release(): Promise<void>;
}

/** Used only after the existing relocation write gate is closed, never on CRUD's hot path. */
@Injectable()
export class ActorStorageRoutingService implements OnModuleDestroy {
  private readonly coordination = new V2PgTableSchemaCoordination({
    connectionString: getMetaDatabaseUrl(),
    maxConnections: 1,
    applicationName: 'teable-actor-routing',
  });

  constructor(
    private readonly prisma: PrismaService,
    private readonly cls: ClsService<IClsStore>,
    private readonly runtimeCache: DataDbRuntimeCacheService
  ) {}

  async onModuleDestroy(): Promise<void> {
    await this.coordination.destroy();
  }

  private async assertDestinationColumns(
    target: Client,
    dbTableNames: readonly string[]
  ): Promise<void> {
    const relations = dbTableNames.map(physicalName);
    // Prevent target DDL between the catalog proof and the binding commit.
    await target.query(`LOCK TABLE ${relations.join(', ')} IN ACCESS SHARE MODE`);
    const result = await target.query<{
      relation: string;
      name: string;
      plainText: boolean;
      nullable: boolean;
      defaultExpression: string | null;
      identityKind: string;
      generatedKind: string;
    }>(
      `
          SELECT a.attrelid::oid::text AS relation, a.attname AS name,
            a.atttypid = 'pg_catalog.text'::regtype AND a.atttypmod = -1 AS "plainText",
            NOT a.attnotnull AS nullable, pg_get_expr(d.adbin, d.adrelid) AS "defaultExpression",
            a.attidentity AS "identityKind", a.attgenerated AS "generatedKind"
          FROM pg_attribute a
          LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
          WHERE a.attrelid = ANY($1::regclass[]) AND a.attnum > 0 AND NOT a.attisdropped
            AND a.attname = ANY($2::text[])
        `,
      [relations, actorColumns]
    );
    const byRelation = new Map<string, Set<string>>();
    for (const column of result.rows) {
      if (
        !column.plainText ||
        !column.nullable ||
        column.identityKind !== '' ||
        column.generatedKind !== '' ||
        (column.defaultExpression !== null && column.defaultExpression !== 'NULL::text')
      ) {
        throw new ConflictException('Destination record attribution columns are incompatible');
      }
      const names = byRelation.get(column.relation) ?? new Set<string>();
      names.add(column.name);
      byRelation.set(column.relation, names);
    }
    if (
      byRelation.size !== relations.length ||
      [...byRelation.values()].some((names) => actorColumns.some((name) => !names.has(name)))
    ) {
      throw new ConflictException('Destination record attribution columns are missing');
    }
  }

  async acquire(tableIds: readonly string[], targetUrl: string): Promise<IActorRoutingLease> {
    const ids = [...new Set(tableIds)].sort();
    const actor = ActorId.create('system');
    if (actor.isErr()) throw new ConflictException('Unable to coordinate database routing');
    const acquired = await this.coordination.acquire({ actorId: actor.value }, ids, 'exclusive');
    if (acquired.isErr()) throw new ConflictException('Unable to acquire database routing lease');
    const lease = acquired.value;
    let target: Client | undefined;
    let targetFailed = false;
    try {
      if (ids.length && (!lease.fence || !lease.assertHeld)) {
        throw new ConflictException('Database routing requires a fenced schema lease');
      }
      // Never reuse a request/ancestry cache: an enable may have completed while we waited.
      const tables = await this.prisma.tableMeta.findMany({
        where: { id: { in: ids } },
        select: { id: true, baseId: true, dbTableName: true, actorStorageVersion: true },
      });
      if (
        tables.length !== ids.length ||
        tables.some((table) => table.actorStorageVersion !== 0 && table.actorStorageVersion !== 1)
      ) {
        throw new ConflictException('Table attribution metadata changed during database routing');
      }
      const enabled = tables.filter((table) => table.actorStorageVersion === 1);
      if (enabled.length) {
        target = new Client({ connectionString: targetUrl });
        target.on('error', () => {
          targetFailed = true;
        });
        await target.connect();
        await target.query('BEGIN');
        await this.assertDestinationColumns(
          target,
          enabled.map((table) => table.dbTableName)
        );
      }
      const assertInTransaction = async (prisma: IActorRoutingTransaction) => {
        if (!ids.length) return;
        if (targetFailed) throw new ConflictException('Destination catalog proof was lost');
        if (target) await target.query('SELECT 1');
        const held = await lease.assertHeld!();
        if (held.isErr()) throw new ConflictException('Database routing schema lease was lost');
        const proof = await prisma.$queryRawUnsafe<{ held: boolean }[]>(
          `
          SELECT NOT EXISTS (
            SELECT 1 FROM unnest($1::text[]) AS tables(table_id) WHERE NOT EXISTS (
              SELECT 1 FROM pg_stat_activity a JOIN pg_locks l ON l.pid = a.pid
              WHERE a.pid = $2 AND a.backend_xid::text = (($3::numeric % 4294967296)::bigint)::text
                AND a.state = 'idle in transaction' AND l.locktype = 'advisory'
                AND l.granted AND l.mode = 'ExclusiveLock' AND l.objsubid = 1
                AND l.classid::bigint = ((hashtextextended('teable.schema:table:' || tables.table_id, 0) >> 32) & 4294967295)
                AND l.objid::bigint = (hashtextextended('teable.schema:table:' || tables.table_id, 0) & 4294967295)
            )
          ) AS held
        `,
          ids,
          lease.fence!.backendPid,
          lease.fence!.transactionId
        );
        if (!proof[0]?.held) throw new ConflictException('Database routing schema lease was lost');
      };
      return {
        assertInTransaction,
        invalidateInTransaction: async (prisma) => {
          await assertInTransaction(prisma);
          if (!ids.length) return;
          await prisma.$executeRawUnsafe(
            `
            UPDATE schema_operation SET status = 'error', phase = 'error',
              last_error = 'Record attribution target changed; retry enable on the current database',
              locked_at = NULL, locked_by = NULL, last_modified_time = now()
            WHERE table_id = ANY($1::text[]) AND type = 'table.actor_columns.enable'
              AND status IN ('pending', 'running')
          `,
            ids
          );
        },
        invalidateCaches: async (cacheKeys) => {
          this.cls.get('dataDbRoutingCache')?.clear();
          const ancestry = this.cls.get('metaAncestryCache');
          for (const table of tables) {
            ancestry?.delete(`table:${table.id}`);
            ancestry?.delete(`base:${table.baseId}`);
          }
          // Writers reload capability under their shared lease; retire old routed runtimes too.
          for (const key of new Set(cacheKeys)) await this.runtimeCache.deleteByKey(key);
        },
        release: async () => {
          try {
            if (target) await target.end();
          } finally {
            await lease.release();
          }
        },
      };
    } catch (error) {
      try {
        if (target) await target.end();
      } finally {
        await lease.release();
      }
      throw error;
    }
  }
}
