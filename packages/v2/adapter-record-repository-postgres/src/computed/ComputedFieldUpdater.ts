import {
  domainError,
  type DomainError,
  type IExecutionContext,
  type ILogger,
  type ITableRepository,
  type LinkField,
  LinkRelationship,
  Table,
  TableId,
  v2CoreTokens,
} from '@teable/v2-core';
import { inject, injectable } from '@teable/v2-di';
import type { V1TeableDatabase } from '@teable/v2-postgres-schema';
import type { InsertQueryBuilder, Kysely, Transaction } from 'kysely';
import { sql } from 'kysely';
import { err, ok, safeTry } from 'neverthrow';
import type { Result } from 'neverthrow';

import { v2RecordRepositoryPostgresTokens } from '../di/tokens';
import type { DynamicDB, QB } from '../query-builder';
import { ComputedTableRecordQueryBuilder, COMPUTED_TABLE_ALIAS } from '../query-builder/computed';
import type {
  ComputedDependencyEdge,
  ComputedUpdatePlan,
  UpdateStep,
} from './ComputedUpdatePlanner';
import { UpdateFromSelectBuilder } from './UpdateFromSelectBuilder';

const DIRTY_TABLE = 'tmp_computed_dirty';
const DIRTY_TABLE_ID_COL = 'table_id';
const DIRTY_RECORD_ID_COL = 'record_id';

/**
 * Statistics about dirty record propagation for tracing purposes.
 */
export interface DirtyRecordStats {
  tableId: string;
  recordCount: number;
}

/**
 * Trace information for a single update step execution.
 */
interface StepTraceInfo {
  tableId: string;
  level: number;
  fieldIds: string[];
  sql: string;
  parameterCount: number;
}

export type PreparedDirtyState = {
  db: Kysely<DynamicDB>;
  tableById: Map<string, Table>;
  dirtyStats: ReadonlyArray<DirtyRecordStats>;
  totalDirtyRecords: number;
};

/**
 * Execute computed field update plans using UPDATE...FROM.
 *
 * Example
 * ```typescript
 * const result = await updater.execute(plan, context);
 * if (result.isErr()) logger.error(result.error.message);
 * ```
 */
@injectable()
export class ComputedFieldUpdater {
  constructor(
    @inject(v2CoreTokens.tableRepository)
    private readonly tableRepository: ITableRepository,
    @inject(v2CoreTokens.logger)
    private readonly logger: ILogger,
    @inject(v2RecordRepositoryPostgresTokens.db)
    private readonly db: Kysely<V1TeableDatabase>
  ) {}

  async execute(
    plan: ComputedUpdatePlan,
    context: IExecutionContext
  ): Promise<Result<void, DomainError>> {
    if (
      plan.steps.length === 0 ||
      (plan.seedRecordIds.length === 0 && plan.extraSeedRecords.length === 0)
    ) {
      return ok(undefined);
    }

    // Start main span for the entire computed update execution
    const mainSpan = context.tracer?.startSpan('teable.ComputedFieldUpdater.execute', {
      'computed.baseId': plan.baseId.toString(),
      'computed.seedTableId': plan.seedTableId.toString(),
      'computed.seedRecordCount': plan.seedRecordIds.length,
      'computed.stepCount': plan.steps.length,
      'computed.edgeCount': plan.edges.length,
      'computed.estimatedComplexity': plan.estimatedComplexity,
      'computed.changeType': plan.changeType,
    });

    // Log plan summary for structured logging
    this.logger.debug('computed:plan', {
      baseId: plan.baseId.toString(),
      seedTableId: plan.seedTableId.toString(),
      seedRecordIds: plan.seedRecordIds.map((r) => r.toString()),
      steps: plan.steps.map((s) => ({
        tableId: s.tableId.toString(),
        level: s.level,
        fieldIds: s.fieldIds.map((f) => f.toString()),
      })),
      edges: plan.edges.map((e) => ({
        from: `${e.fromTableId.toString()}.${e.fromFieldId.toString()}`,
        to: `${e.toTableId.toString()}.${e.toFieldId.toString()}`,
        linkFieldId: e.linkFieldId?.toString(),
        order: e.order,
      })),
    });

    try {
      return await safeTry<void, DomainError>(
        async function* (this: ComputedFieldUpdater) {
          const prepared = yield* await this.prepareDirtyState(plan, context);
          mainSpan?.setAttribute('computed.totalDirtyRecords', prepared.totalDirtyRecords);
          mainSpan?.setAttribute('computed.affectedTableCount', prepared.dirtyStats.length);

          this.logger.debug('computed:dirtyStats', {
            totalDirtyRecords: prepared.totalDirtyRecords,
            affectedTables: prepared.dirtyStats,
          });

          const stepTraces = yield* await this.executePreparedSteps(plan, context, prepared);
          mainSpan?.setAttribute('computed.executedStepCount', stepTraces.length);

          return ok(undefined);
        }.bind(this)
      );
    } finally {
      mainSpan?.end();
    }
  }

  /**
   * Prepare dirty table state (seed + propagate) and return dirty stats.
   *
   * Example
   * ```typescript
   * const prepared = await updater.prepareDirtyState(plan, context);
   * if (prepared.isOk()) console.log(prepared.value.dirtyStats);
   * ```
   */
  async prepareDirtyState(
    plan: ComputedUpdatePlan,
    context: IExecutionContext
  ): Promise<Result<PreparedDirtyState, DomainError>> {
    if (
      plan.steps.length === 0 ||
      (plan.seedRecordIds.length === 0 && plan.extraSeedRecords.length === 0)
    ) {
      const db = resolvePostgresDb(this.db, context) as unknown as Kysely<DynamicDB>;
      return ok({
        db,
        tableById: new Map(),
        dirtyStats: [],
        totalDirtyRecords: 0,
      });
    }

    const db = resolvePostgresDb(this.db, context) as unknown as Kysely<DynamicDB>;

    return safeTry<PreparedDirtyState, DomainError>(
      async function* (this: ComputedFieldUpdater) {
        const loadTablesSpan = context.tracer?.startSpan('teable.ComputedFieldUpdater.loadTables');
        const tables = yield* await this.loadTables(plan, context);
        const tableById = new Map(tables.map((table) => [table.id().toString(), table]));
        loadTablesSpan?.setAttribute('tableCount', tables.length);
        loadTablesSpan?.end();

        const resetSpan = context.tracer?.startSpan('teable.ComputedFieldUpdater.resetDirtyTable');
        yield* await resetDirtyTable(db);
        resetSpan?.end();

        const seedSpan = context.tracer?.startSpan('teable.ComputedFieldUpdater.seedDirtyRecords');
        yield* await seedDirtyRecords(db, plan.seedTableId, plan.seedRecordIds);
        yield* await seedExtraDirtyRecords(db, plan.extraSeedRecords);
        seedSpan?.setAttribute('seedCount', plan.seedRecordIds.length);
        seedSpan?.setAttribute('extraSeedCount', plan.extraSeedRecords.length);
        seedSpan?.end();

        const propagateSpan = context.tracer?.startSpan(
          'teable.ComputedFieldUpdater.propagateDirtyRecords'
        );
        yield* await propagateDirtyRecords(db, plan.edges, tableById, context);
        propagateSpan?.setAttribute('edgeCount', plan.edges.length);
        propagateSpan?.end();

        const statsSpan = context.tracer?.startSpan(
          'teable.ComputedFieldUpdater.collectDirtyStats'
        );
        const dirtyStats = yield* await this.collectDirtyRecordStats(db);
        const totalDirtyRecords = dirtyStats.reduce((sum, s) => sum + s.recordCount, 0);
        statsSpan?.setAttribute('totalDirtyRecords', totalDirtyRecords);
        statsSpan?.setAttribute('affectedTableCount', dirtyStats.length);
        statsSpan?.end();

        return ok({
          db,
          tableById,
          dirtyStats,
          totalDirtyRecords,
        });
      }.bind(this)
    );
  }

  /**
   * Execute selected steps using a prepared dirty table state.
   *
   * Example
   * ```typescript
   * const prepared = await updater.prepareDirtyState(plan, context);
   * await updater.executePreparedSteps(plan, context, prepared.value, plan.steps);
   * ```
   */
  async executePreparedSteps(
    plan: ComputedUpdatePlan,
    context: IExecutionContext,
    prepared: PreparedDirtyState,
    steps: ReadonlyArray<UpdateStep> = plan.steps
  ): Promise<Result<ReadonlyArray<StepTraceInfo>, DomainError>> {
    if (steps.length === 0) return ok([]);

    const updateBuilder = new UpdateFromSelectBuilder(prepared.db);
    const stepTraces: StepTraceInfo[] = [];

    return safeTry<ReadonlyArray<StepTraceInfo>, DomainError>(
      async function* (this: ComputedFieldUpdater) {
        for (let i = 0; i < steps.length; i++) {
          const step = steps[i];
          const stepResult = yield* await this.executeStep(
            prepared.db,
            updateBuilder,
            step,
            prepared.tableById,
            context,
            i
          );
          stepTraces.push(stepResult);
        }
        return ok(stepTraces);
      }.bind(this)
    );
  }

  /**
   * Execute a single update step with tracing.
   */
  private async executeStep(
    db: Kysely<DynamicDB>,
    updateBuilder: UpdateFromSelectBuilder,
    step: UpdateStep,
    tableById: Map<string, Table>,
    context: IExecutionContext,
    stepIndex: number
  ): Promise<Result<StepTraceInfo, DomainError>> {
    const stepSpan = context.tracer?.startSpan('teable.ComputedFieldUpdater.step', {
      'step.index': stepIndex,
      'step.tableId': step.tableId.toString(),
      'step.level': step.level,
      'step.fieldCount': step.fieldIds.length,
      'step.fieldIds': step.fieldIds.map((f) => f.toString()).join(','),
    });

    try {
      return await safeTry<StepTraceInfo, DomainError>(
        async function* (this: ComputedFieldUpdater) {
          const table = tableById.get(step.tableId.toString());
          if (!table) {
            return err(
              domainError.notFound({
                message: `Missing table for computed update: ${step.tableId.toString()}`,
              })
            );
          }

          const builder = new ComputedTableRecordQueryBuilder(db).from(table).select(step.fieldIds);
          yield* await builder.prepare({
            context,
            tableRepository: this.tableRepository,
          });
          const selectQuery = yield* builder.build();
          const filteredSelect = applyDirtyFilter(db, selectQuery, step.tableId);

          const compiled = yield* updateBuilder.build({
            table,
            fieldIds: step.fieldIds,
            selectQuery: filteredSelect,
          });

          // Record SQL on span
          stepSpan?.setAttribute('step.sql', compiled.sql);
          stepSpan?.setAttribute('step.parameterCount', compiled.parameters.length);

          this.logger.debug(
            `computed:update:table=${step.tableId.toString()}:level=${step.level}:sql:\n${compiled.sql}`,
            { parameters: compiled.parameters }
          );

          await db.executeQuery(compiled);

          const traceInfo: StepTraceInfo = {
            tableId: step.tableId.toString(),
            level: step.level,
            fieldIds: step.fieldIds.map((f) => f.toString()),
            sql: compiled.sql,
            parameterCount: compiled.parameters.length,
          };

          return ok(traceInfo);
        }.bind(this)
      );
    } finally {
      stepSpan?.end();
    }
  }

  /**
   * Collect statistics about dirty records per table for tracing.
   */
  private async collectDirtyRecordStats(
    db: Kysely<DynamicDB>
  ): Promise<Result<DirtyRecordStats[], DomainError>> {
    try {
      const result = await db
        .selectFrom(DIRTY_TABLE)
        .select([
          sql.ref(DIRTY_TABLE_ID_COL).as('tableId'),
          sql<number>`count(*)`.as('recordCount'),
        ])
        .groupBy(DIRTY_TABLE_ID_COL)
        .execute();

      return ok(
        result.map((row) => ({
          tableId: String(row.tableId),
          recordCount: Number(row.recordCount),
        }))
      );
    } catch (error) {
      // Non-critical: return empty stats if query fails
      this.logger.warn('computed:dirtyStats:failed', { error: describeError(error) });
      return ok([]);
    }
  }

  private async loadTables(
    plan: ComputedUpdatePlan,
    context: IExecutionContext
  ): Promise<Result<ReadonlyArray<Table>, DomainError>> {
    return safeTry<ReadonlyArray<Table>, DomainError>(
      async function* (this: ComputedFieldUpdater) {
        const tableIds = new Map<string, TableId>();
        tableIds.set(plan.seedTableId.toString(), plan.seedTableId);
        for (const step of plan.steps) {
          tableIds.set(step.tableId.toString(), step.tableId);
        }
        for (const edge of plan.edges) {
          tableIds.set(edge.fromTableId.toString(), edge.fromTableId);
          tableIds.set(edge.toTableId.toString(), edge.toTableId);
        }

        if (tableIds.size === 0) return ok([]);

        const spec = yield* Table.specs(plan.baseId)
          .withoutBaseId()
          .byIds([...tableIds.values()])
          .build();
        const tables = yield* await this.tableRepository.find(context, spec);

        return ok(tables);
      }.bind(this)
    );
  }
}

const applyDirtyFilter = (db: Kysely<DynamicDB>, query: QB, tableId: TableId) => {
  const dirtyIds = db
    .selectFrom(`${DIRTY_TABLE} as d`)
    .select(sql.ref(`d.${DIRTY_RECORD_ID_COL}`).as(DIRTY_RECORD_ID_COL))
    .where(sql.ref(`d.${DIRTY_TABLE_ID_COL}`), '=', tableId.toString());

  return query.where(`${COMPUTED_TABLE_ALIAS}.__id`, 'in', dirtyIds);
};

const resetDirtyTable = async (db: Kysely<DynamicDB>): Promise<Result<void, DomainError>> => {
  try {
    await db.executeQuery(sql`drop table if exists ${sql.table(DIRTY_TABLE)}`.compile(db));
    await db.executeQuery(
      sql`create temporary table ${sql.table(DIRTY_TABLE)} (
        ${sql.raw(DIRTY_TABLE_ID_COL)} text not null,
        ${sql.raw(DIRTY_RECORD_ID_COL)} text not null,
        primary key (${sql.raw(DIRTY_TABLE_ID_COL)}, ${sql.raw(DIRTY_RECORD_ID_COL)})
      ) on commit drop`.compile(db)
    );
    return ok(undefined);
  } catch (error) {
    return err(
      domainError.infrastructure({
        message: `Failed to create dirty table: ${describeError(error)}`,
      })
    );
  }
};

const seedDirtyRecords = async (
  db: Kysely<DynamicDB>,
  tableId: TableId,
  recordIds: ReadonlyArray<{ toString(): string }>
): Promise<Result<void, DomainError>> => {
  if (recordIds.length === 0) return ok(undefined);

  try {
    const values = recordIds.map((recordId) => ({
      [DIRTY_TABLE_ID_COL]: tableId.toString(),
      [DIRTY_RECORD_ID_COL]: recordId.toString(),
    }));
    const batchSize = 500;
    for (let i = 0; i < values.length; i += batchSize) {
      await db
        .insertInto(DIRTY_TABLE)
        .values(values.slice(i, i + batchSize))
        .onConflict((oc) => oc.columns([DIRTY_TABLE_ID_COL, DIRTY_RECORD_ID_COL]).doNothing())
        .execute();
    }
    return ok(undefined);
  } catch (error) {
    return err(
      domainError.infrastructure({
        message: `Failed to seed dirty records: ${describeError(error)}`,
      })
    );
  }
};

const seedExtraDirtyRecords = async (
  db: Kysely<DynamicDB>,
  extraSeedRecords: ReadonlyArray<{
    tableId: TableId;
    recordIds: ReadonlyArray<{ toString(): string }>;
  }>
): Promise<Result<void, DomainError>> => {
  for (const group of extraSeedRecords) {
    if (group.recordIds.length === 0) continue;
    const result = await seedDirtyRecords(db, group.tableId, group.recordIds);
    if (result.isErr()) return err(result.error);
  }
  return ok(undefined);
};

const propagateDirtyRecords = async (
  db: Kysely<DynamicDB>,
  edges: ReadonlyArray<ComputedDependencyEdge>,
  tableById: Map<string, Table>,
  context?: IExecutionContext
): Promise<Result<void, DomainError>> => {
  try {
    for (let i = 0; i < edges.length; i++) {
      const edge = edges[i];
      const edgeSpan = context?.tracer?.startSpan('teable.ComputedFieldUpdater.propagateEdge', {
        'edge.index': i,
        'edge.fromTableId': edge.fromTableId.toString(),
        'edge.toTableId': edge.toTableId.toString(),
        'edge.fromFieldId': edge.fromFieldId.toString(),
        'edge.toFieldId': edge.toFieldId.toString(),
        'edge.linkFieldId': edge.linkFieldId?.toString() ?? '',
        'edge.order': edge.order,
      });

      try {
        const insertResult = buildPropagationInsert(db, edge, tableById);
        if (insertResult.isErr()) {
          edgeSpan?.recordError(insertResult.error.message);
          return err(insertResult.error);
        }

        const compiled = insertResult.value.compile();
        edgeSpan?.setAttribute('edge.sql', compiled.sql);
        await db.executeQuery(compiled);
      } finally {
        edgeSpan?.end();
      }
    }
    return ok(undefined);
  } catch (error) {
    return err(
      domainError.infrastructure({
        message: `Failed to propagate dirty records: ${describeError(error)}`,
      })
    );
  }
};

const buildPropagationInsert = (
  db: Kysely<DynamicDB>,
  edge: ComputedDependencyEdge,
  tableById: Map<string, Table>
): Result<InsertQueryBuilder<DynamicDB, string, unknown>, DomainError> => {
  return safeTry(function* () {
    if (!edge.linkFieldId) return err(domainError.validation({ message: 'Missing linkFieldId' }));

    const targetTable = tableById.get(edge.toTableId.toString());
    if (!targetTable) {
      return err(
        domainError.notFound({
          message: `Missing target table ${edge.toTableId.toString()}`,
        })
      );
    }
    const sourceTable = tableById.get(edge.fromTableId.toString());
    if (!sourceTable) {
      return err(
        domainError.notFound({
          message: `Missing source table ${edge.fromTableId.toString()}`,
        })
      );
    }

    const linkField = yield* targetTable.getField((field): field is LinkField =>
      field.id().equals(edge.linkFieldId!)
    );

    if (!linkField.foreignTableId().equals(edge.fromTableId)) {
      return err(
        domainError.validation({
          message: `Link field ${edge.linkFieldId.toString()} does not reference table ${edge.fromTableId.toString()}`,
        })
      );
    }

    const sourceDbName = yield* sourceTable.dbTableName().andThen((name) => name.value());
    const targetDbName = yield* targetTable.dbTableName().andThen((name) => name.value());

    const relationship = linkField.relationship();
    const insertQuery = yield* buildDirtyInsertQuery({
      db,
      relationship,
      linkField,
      sourceTableName: sourceDbName,
      targetTableName: targetDbName,
      sourceTableId: edge.fromTableId.toString(),
      targetTableId: edge.toTableId.toString(),
    });

    return ok(insertQuery);
  });
};

type DirtyInsertParams = {
  db: Kysely<DynamicDB>;
  relationship: LinkRelationship;
  linkField: LinkField;
  sourceTableName: string;
  targetTableName: string;
  sourceTableId: string;
  targetTableId: string;
};

const buildDirtyInsertQuery = (
  params: DirtyInsertParams
): Result<InsertQueryBuilder<DynamicDB, string, unknown>, DomainError> => {
  return safeTry(function* () {
    const {
      db,
      relationship,
      linkField,
      sourceTableName,
      targetTableName,
      sourceTableId,
      targetTableId,
    } = params;

    if (
      relationship.equals(LinkRelationship.manyOne()) ||
      relationship.equals(LinkRelationship.oneOne())
    ) {
      const foreignKey = yield* linkField.foreignKeyNameString();
      const select = db
        .selectFrom(`${targetTableName} as t`)
        .innerJoin(`${DIRTY_TABLE} as d`, `d.${DIRTY_RECORD_ID_COL}`, `t.${foreignKey}`)
        .where(`d.${DIRTY_TABLE_ID_COL}`, '=', sourceTableId)
        .select([
          sql.lit(targetTableId).as(DIRTY_TABLE_ID_COL),
          sql.ref('t.__id').as(DIRTY_RECORD_ID_COL),
        ])
        .distinct();

      return ok(
        db
          .insertInto(DIRTY_TABLE)
          .columns([DIRTY_TABLE_ID_COL, DIRTY_RECORD_ID_COL])
          .expression(select)
          .onConflict((oc) => oc.columns([DIRTY_TABLE_ID_COL, DIRTY_RECORD_ID_COL]).doNothing())
      );
    }

    if (relationship.equals(LinkRelationship.oneMany())) {
      const selfKey = yield* linkField.selfKeyNameString();
      const select = db
        .selectFrom(`${sourceTableName} as f`)
        .innerJoin(`${DIRTY_TABLE} as d`, `d.${DIRTY_RECORD_ID_COL}`, 'f.__id')
        .where(`d.${DIRTY_TABLE_ID_COL}`, '=', sourceTableId)
        .where(sql.ref(`f.${selfKey}`), 'is not', null)
        .select([
          sql.lit(targetTableId).as(DIRTY_TABLE_ID_COL),
          sql.ref(`f.${selfKey}`).as(DIRTY_RECORD_ID_COL),
        ])
        .distinct();

      return ok(
        db
          .insertInto(DIRTY_TABLE)
          .columns([DIRTY_TABLE_ID_COL, DIRTY_RECORD_ID_COL])
          .expression(select)
          .onConflict((oc) => oc.columns([DIRTY_TABLE_ID_COL, DIRTY_RECORD_ID_COL]).doNothing())
      );
    }

    const fkHostTableName = yield* linkField.fkHostTableNameString();
    const selfKey = yield* linkField.selfKeyNameString();
    const foreignKey = yield* linkField.foreignKeyNameString();
    const select = db
      .selectFrom(`${fkHostTableName} as j`)
      .innerJoin(`${DIRTY_TABLE} as d`, `d.${DIRTY_RECORD_ID_COL}`, `j.${foreignKey}`)
      .where(`d.${DIRTY_TABLE_ID_COL}`, '=', sourceTableId)
      .select([
        sql.lit(targetTableId).as(DIRTY_TABLE_ID_COL),
        sql.ref(`j.${selfKey}`).as(DIRTY_RECORD_ID_COL),
      ])
      .distinct();

    return ok(
      db
        .insertInto(DIRTY_TABLE)
        .columns([DIRTY_TABLE_ID_COL, DIRTY_RECORD_ID_COL])
        .expression(select)
        .onConflict((oc) => oc.columns([DIRTY_TABLE_ID_COL, DIRTY_RECORD_ID_COL]).doNothing())
    );
  });
};

interface PostgresTransactionContext<DB> {
  kind: 'unitOfWorkTransaction';
  db: Transaction<DB>;
}

const getPostgresTransaction = <DB>(context: IExecutionContext): Transaction<DB> | null => {
  const transaction = context.transaction as Partial<PostgresTransactionContext<DB>> | undefined;
  if (transaction?.kind === 'unitOfWorkTransaction' && transaction.db) {
    return transaction.db as Transaction<DB>;
  }
  return null;
};

const resolvePostgresDb = <DB>(
  db: Kysely<DB>,
  context: IExecutionContext
): Kysely<DB> | Transaction<DB> => {
  return getPostgresTransaction<DB>(context) ?? db;
};

const describeError = (error: unknown): string => {
  if (error instanceof Error) return error.message ? `${error.name}: ${error.message}` : error.name;
  if (typeof error === 'string') return error;
  try {
    const json = JSON.stringify(error);
    return json ?? String(error);
  } catch {
    return String(error);
  }
};
