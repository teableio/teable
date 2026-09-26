import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { IDsn } from '@teable/core';
import { DriverClient, HttpErrorCode, parseDsn } from '@teable/core';
import { PrismaService, getDatabaseUrl } from '@teable/db-main-prisma';
import { ActorId, type IExecutionContext } from '@teable/v2-core';
import {
  TableQueryObservationWindow,
  type TableQueryExecutionShape,
} from '@teable/v2-table-query-ops';
import { Knex } from 'knex';
import { InjectModel } from 'nest-knexjs';
import { CustomHttpException } from '../../custom.exception';
import {
  DatabaseRouter,
  type IDataPrismaQueryExecutor,
} from '../../global/database-router.service';
import { DATA_KNEX } from '../../global/knex';
import { TableQueryObservationRuntimeService } from '../v2/table-query-observation-runtime.service';
import { resolveBoolean } from '../v2/v2-config-parsers';
import { BASE_READ_ONLY_ROLE_PREFIX } from './const';
import {
  buildBaseSqlQueryObservationShape,
  type BaseSqlParsedQuery,
  type BaseSqlFieldObservationTarget,
  type BaseSqlTableObservationTarget,
} from './sql-query-observation';
import { checkTableAccess, validateRoleOperations } from './utils';

/** Room reserved inside the transaction budget for the `SET` round trips and the COMMIT. */
const STATEMENT_TIMEOUT_MARGIN_MS = 1_000;

@Injectable()
export class BaseSqlExecutorService {
  private readonly dsn: IDsn;
  readonly driver: DriverClient;
  private readonly observationContext: IExecutionContext = {
    actorId: ActorId.create('system')._unsafeUnwrap(),
  };
  constructor(
    private readonly prismaService: PrismaService,
    private readonly databaseRouter: DatabaseRouter,
    private readonly configService: ConfigService,
    @InjectModel(DATA_KNEX) private readonly knex: Knex,
    @Inject(TableQueryObservationRuntimeService)
    private readonly tableQueryObservationRuntime: TableQueryObservationRuntimeService
  ) {
    this.dsn = parseDsn(this.getDatabaseUrl());
    this.driver = this.dsn.driver as DriverClient;
  }

  private getDatabaseUrl() {
    return (
      this.configService.get<string>('PRISMA_DATABASE_URL_FOR_SQL_EXECUTOR') ||
      getDatabaseUrl('meta')
    );
  }

  private tableQueryOpsEnabled(): boolean {
    return resolveBoolean(this.configService.get('V2_TABLE_QUERY_OPS_ENABLED'), false);
  }

  private getReadOnlyRoleName(baseId: string) {
    return `${BASE_READ_ONLY_ROLE_PREFIX}${baseId}`;
  }

  private async dataPrismaForBase(baseId: string) {
    return await this.databaseRouter.dataPrismaExecutorForBase(baseId);
  }

  private async createReadOnlyRoleWithPrisma(baseId: string, dataPrisma: IDataPrismaQueryExecutor) {
    const roleName = this.getReadOnlyRoleName(baseId);
    await dataPrisma.$executeRawUnsafe(
      this.knex
        .raw(
          `CREATE ROLE ?? WITH NOLOGIN NOSUPERUSER NOINHERIT NOCREATEDB NOCREATEROLE NOREPLICATION`,
          [roleName]
        )
        .toQuery()
    );
    await dataPrisma.$executeRawUnsafe(
      this.knex.raw(`GRANT USAGE ON SCHEMA ?? TO ??`, [baseId, roleName]).toQuery()
    );
    await dataPrisma.$executeRawUnsafe(
      this.knex.raw(`GRANT SELECT ON ALL TABLES IN SCHEMA ?? TO ??`, [baseId, roleName]).toQuery()
    );
    await dataPrisma.$executeRawUnsafe(
      this.knex
        .raw(`ALTER DEFAULT PRIVILEGES IN SCHEMA ?? GRANT SELECT ON TABLES TO ??`, [
          baseId,
          roleName,
        ])
        .toQuery()
    );
  }

  async createReadOnlyRole(baseId: string) {
    const dataPrisma = await this.dataPrismaForBase(baseId);
    await this.createReadOnlyRoleWithPrisma(baseId, dataPrisma);
  }

  async dropReadOnlyRole(baseId: string) {
    const roleName = this.getReadOnlyRoleName(baseId);
    const dataPrisma = await this.dataPrismaForBase(baseId);
    await dataPrisma.$executeRawUnsafe(
      this.knex.raw(`REVOKE USAGE ON SCHEMA ?? FROM ??`, [baseId, roleName]).toQuery()
    );
    await dataPrisma.$executeRawUnsafe(
      this.knex
        .raw(`REVOKE SELECT ON ALL TABLES IN SCHEMA ?? FROM ??`, [baseId, roleName])
        .toQuery()
    );
    await dataPrisma.$executeRawUnsafe(
      this.knex
        .raw(`ALTER DEFAULT PRIVILEGES IN SCHEMA ?? REVOKE ALL ON TABLES FROM ??`, [
          baseId,
          roleName,
        ])
        .toQuery()
    );
    await dataPrisma.$executeRawUnsafe(
      this.knex.raw(`DROP ROLE IF EXISTS ??`, [roleName]).toQuery()
    );
  }

  async grantReadOnlyRole(baseId: string) {
    const roleName = this.getReadOnlyRoleName(baseId);
    const dataPrisma = await this.dataPrismaForBase(baseId);
    await dataPrisma.$executeRawUnsafe(
      this.knex.raw(`GRANT USAGE ON SCHEMA ?? TO ??`, [baseId, roleName]).toQuery()
    );
    await dataPrisma.$executeRawUnsafe(
      this.knex.raw(`GRANT SELECT ON ALL TABLES IN SCHEMA ?? TO ??`, [baseId, roleName]).toQuery()
    );
    await dataPrisma.$executeRawUnsafe(
      this.knex
        .raw(`ALTER DEFAULT PRIVILEGES IN SCHEMA ?? GRANT SELECT ON TABLES TO ??`, [
          baseId,
          roleName,
        ])
        .toQuery()
    );
  }

  private async roleExists(role: string, dataPrisma: IDataPrismaQueryExecutor): Promise<boolean> {
    const roleExists = await dataPrisma.$queryRawUnsafe<{ count: bigint }[]>(
      this.knex.raw('SELECT count(*) FROM pg_roles WHERE rolname = ?', [role]).toQuery()
    );
    return Boolean(roleExists[0].count);
  }

  private async roleCheckAndCreate(baseId: string): Promise<boolean> {
    if (this.driver !== DriverClient.Pg) {
      return false;
    }
    const resolvedDataDb = await this.databaseRouter.getDataDatabaseForBase(baseId);
    if (!resolvedDataDb.isMetaFallback) {
      return false;
    }
    const roleName = this.getReadOnlyRoleName(baseId);
    const dataPrisma = await this.dataPrismaForBase(baseId);
    if (await this.roleExists(roleName, dataPrisma)) {
      return true;
    }
    await this.databaseRouter.dataPrismaTransactionForBase(baseId, async (dataPrisma) => {
      await dataPrisma.$executeRawUnsafe(
        this.knex.raw('SELECT pg_advisory_xact_lock(hashtextextended(?, 0))', [roleName]).toQuery()
      );
      if (!(await this.roleExists(roleName, dataPrisma))) {
        await this.createReadOnlyRoleWithPrisma(baseId, dataPrisma);
      }
    });
    return true;
  }

  private async setLocalRole(
    prisma: { $executeRawUnsafe(query: string): Promise<unknown> },
    baseId: string
  ) {
    const roleName = this.getReadOnlyRoleName(baseId);
    await prisma.$executeRawUnsafe(this.knex.raw(`SET LOCAL ROLE ??`, [roleName]).toQuery());
  }

  private async setTransactionReadOnly(prisma: {
    $executeRawUnsafe(query: string): Promise<unknown>;
  }) {
    await prisma.$executeRawUnsafe('SET TRANSACTION READ ONLY');
  }

  private async setLocalStatementTimeout(prisma: {
    $executeRawUnsafe(query: string): Promise<unknown>;
  }) {
    const timeoutMs = this.getQueryStatementTimeout();
    await prisma.$executeRawUnsafe(
      this.knex.raw(`SET LOCAL statement_timeout = ?`, [timeoutMs]).toQuery()
    );
  }

  /**
   * Postgres has to cancel the statement before Prisma abandons the transaction it
   * runs in, otherwise the statement keeps burning server time with nobody waiting
   * for its result and the connection stays pinned. So the guard is derived from the
   * transaction budget rather than set independently, leaving room for the `SET`
   * round trips and the COMMIT. The floor keeps a deliberately small budget usable
   * instead of collapsing the statement timeout to zero.
   *
   * The query runs against the data database, whose budget is deliberately kept in
   * step with the meta one, so reading it off either service is equivalent.
   */
  private getQueryStatementTimeout() {
    const txTimeout = this.prismaService['defaultTxTimeout'];
    return Math.max(txTimeout - STATEMENT_TIMEOUT_MARGIN_MS, Math.ceil(txTimeout / 2));
  }

  /**
   * check sql is safe
   * 1. role operations validation
   * 2. parse sql to valid table names
   * 3. read only role check table access
   */
  private async safeCheckSql(
    baseId: string,
    sql: string,
    opts?: { projectionTableDbNames?: string[]; projectionTableIds?: string[] }
  ): Promise<SqlObservationCheck> {
    const { projectionTableDbNames = [], projectionTableIds = [] } = opts ?? {};
    const observe = this.tableQueryOpsEnabled();
    // 1. role operations keywords validation, only pg support
    if (this.driver == DriverClient.Pg) {
      validateRoleOperations(sql);
    }

    let tables: ReadonlyArray<TableMetaObservationRow> = [];
    let tableNames = projectionTableDbNames;
    if (!projectionTableDbNames.length || observe) {
      // Exclude archived tables: their physical tables remain until permanent
      // deletion, and reading them would bypass the table|trash_read permission.
      const rows = await this.prismaService.tableMeta.findMany({
        where: {
          baseId,
          deletedTime: null,
          ...(projectionTableDbNames.length ? { dbTableName: { in: projectionTableDbNames } } : {}),
          ...(projectionTableIds.length ? { id: { in: projectionTableIds } } : {}),
        },
        select: observe
          ? {
              dbTableName: true,
              id: true,
              baseId: true,
              base: { select: { spaceId: true } },
            }
          : { dbTableName: true },
      });
      tables = rows;
      if (!projectionTableDbNames.length) {
        tableNames = tables.map((table) => table.dbTableName);
      }
    }

    // 2. parse sql to valid table names
    const access = checkTableAccess(sql, {
      tableNames,
      database: this.driver,
      collectDetails: observe,
    });
    // TODO: need read only db connection for better security
    if (!observe) return { parsed: access, targets: [] };

    return { parsed: access, targets: await this.resolveObservationTargets(access, tables) };
  }

  private async resolveObservationTargets(
    parsed: BaseSqlParsedQuery,
    tables: ReadonlyArray<TableMetaObservationRow>
  ): Promise<ReadonlyArray<BaseSqlTableObservationTarget>> {
    const physicalNames = new Set(
      parsed.tableNames.map((name) => name.split('::').slice(1).join('.'))
    );
    const referencedTables = tables
      .filter((table) => physicalNames.has(table.dbTableName) && table.id && table.baseId)
      .map((table) => ({
        tableId: table.id!,
        baseId: table.baseId!,
        dbTableName: table.dbTableName,
        spaceId: table.base?.spaceId,
      }));
    const fieldsByTable = await this.readObservationFields(
      referencedTables.map((table) => table.tableId)
    );
    return referencedTables.map((table) => ({
      ...table,
      fields: fieldsByTable.get(table.tableId) ?? [],
    }));
  }

  private async readObservationFields(tableIds: string[]) {
    const fieldsByTable = new Map<string, BaseSqlFieldObservationTarget[]>();
    if (!tableIds.length) return fieldsByTable;
    try {
      const fields = await this.prismaService.field.findMany({
        where: { tableId: { in: tableIds }, deletedTime: null },
        select: { id: true, tableId: true, dbFieldName: true, type: true },
      });
      for (const field of fields) {
        const tableFields = fieldsByTable.get(field.tableId);
        if (tableFields) tableFields.push(field);
        else fieldsByTable.set(field.tableId, [field]);
      }
    } catch {
      // Field diagnostics are optional; authorization already succeeded.
    }
    return fieldsByTable;
  }

  async executeQuerySql<T = unknown>(
    baseId: string,
    sql: string,
    opts?: {
      projectionTableDbNames?: string[];
      projectionTableIds?: string[];
    }
  ) {
    const checked = await this.safeCheckSql(baseId, sql, opts);
    const startedAt = Date.now();
    let sqlTimedOut = false;
    try {
      const shouldSetLocalRole = await this.roleCheckAndCreate(baseId);
      const result = await this.databaseRouter.dataPrismaTransactionForBase(
        baseId,
        async (prisma) => {
          try {
            await this.setLocalStatementTimeout(prisma);
            await this.setTransactionReadOnly(prisma);
            if (shouldSetLocalRole) {
              await this.setLocalRole(prisma, baseId);
            }
            return await prisma.$queryRawUnsafe<T>(sql);
          } catch (error: unknown) {
            sqlTimedOut = isSqlTimeout(error);
            const message = getSqlErrorMessage(error);
            throw new CustomHttpException(
              `execute query sql failed: ${message}`,
              HttpErrorCode.VALIDATION_ERROR,
              {
                localization: {
                  i18nKey: 'httpErrors.baseSqlExecutor.executeQuerySqlFailed',
                  context: { message },
                },
              }
            );
          }
        }
      );
      this.publishSqlObservation(checked, Date.now() - startedAt, result);
      return result;
    } catch (error: unknown) {
      this.publishSqlObservation(checked, Date.now() - startedAt, undefined, error, sqlTimedOut);
      throw error;
    }
  }

  private publishSqlObservation(
    checked: SqlObservationCheck,
    durationMs: number,
    result?: unknown,
    error?: unknown,
    statementTimedOut = false
  ): void {
    if (!this.tableQueryOpsEnabled() || checked.targets.length === 0) return;
    const timedOut = error !== undefined && (statementTimedOut || isSqlTimeout(error));
    const executionShape: TableQueryExecutionShape = {
      durationMs,
      timedOut,
      ...(error !== undefined ? { errorKind: timedOut ? 'timeout' : 'db_error' } : {}),
      ...(result !== undefined ? { resultCountBucket: resultCountBucket(result) } : {}),
    };
    const windowStart = floorObservationWindow(new Date());
    for (const target of checked.targets) {
      this.publishTargetObservation(checked.parsed, target, executionShape, windowStart);
    }
  }

  private publishTargetObservation(
    parsed: BaseSqlParsedQuery,
    target: BaseSqlTableObservationTarget,
    executionShape: TableQueryExecutionShape,
    windowStart: Date
  ): void {
    try {
      const observation = buildBaseSqlQueryObservationShape({
        parsed,
        target,
        executionShape,
      }).andThen(({ shape, diagnostic }) =>
        TableQueryObservationWindow.create({
          spaceId: target.spaceId,
          baseId: target.baseId,
          tableId: target.tableId,
          windowStart,
          windowSizeSeconds: 300,
          shape,
          requestCount: 1,
          slowCount: Number(executionShape.durationMs >= 3_000),
          timeoutCount: Number(executionShape.timedOut),
          dbErrorCount: Number(executionShape.errorKind === 'db_error'),
          totalDurationMs: executionShape.durationMs,
          maxDurationMs: executionShape.durationMs,
          sqlDiagnostics: [diagnostic],
        })
      );
      if (observation.isOk())
        this.tableQueryObservationRuntime.publish(this.observationContext, observation.value);
    } catch {
      // Observation construction and publication must not change the SQL result.
    }
  }
}
type TableMetaObservationRow = {
  readonly id?: string;
  readonly baseId?: string;
  readonly dbTableName: string;
  readonly base?: { readonly spaceId?: string };
};

type SqlObservationCheck = {
  readonly parsed: BaseSqlParsedQuery;
  readonly targets: ReadonlyArray<BaseSqlTableObservationTarget>;
};

const getSqlErrorMessage = (error: unknown): string => {
  if (!error || typeof error !== 'object') return String(error);
  const typed = error as {
    readonly meta?: { readonly message?: unknown };
    readonly message?: unknown;
  };
  if (typeof typed.meta?.message === 'string') return typed.meta.message;
  return typeof typed.message === 'string' ? typed.message : String(error);
};

const isSqlTimeout = (error: unknown): boolean => hasSqlTimeoutCode(error);

const hasSqlTimeoutCode = (error: unknown, seen = new Set<object>()): boolean => {
  if (!error || typeof error !== 'object') return false;
  if (seen.has(error)) return false;
  seen.add(error);
  const typed = error as {
    readonly code?: unknown;
    readonly sqlState?: unknown;
    readonly sqlstate?: unknown;
    readonly meta?: {
      readonly code?: unknown;
      readonly sqlState?: unknown;
      readonly sqlstate?: unknown;
    };
    readonly cause?: unknown;
    readonly originalError?: unknown;
  };
  if (
    [
      typed.code,
      typed.sqlState,
      typed.sqlstate,
      typed.meta?.code,
      typed.meta?.sqlState,
      typed.meta?.sqlstate,
    ].some((value) => value === '57014')
  ) {
    return true;
  }
  return hasSqlTimeoutCode(typed.cause, seen) || hasSqlTimeoutCode(typed.originalError, seen);
};

const resultCountBucket = (result: unknown): 'none' | 'small' | 'medium' | 'large' => {
  if (!Array.isArray(result) || result.length === 0) return 'none';
  if (result.length <= 100) return 'small';
  if (result.length <= 1_000) return 'medium';
  return 'large';
};

const floorObservationWindow = (date: Date): Date =>
  new Date(Math.floor(date.getTime() / (5 * 60 * 1_000)) * (5 * 60 * 1_000));
