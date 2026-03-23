import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import type {
  IV2BaseSchemaIntegrityRepairRo,
  IV2SchemaIntegrityFilterStatus,
  IV2SchemaIntegrityCheckResult,
  IV2SchemaIntegrityRepairResult,
  IV2SchemaIntegrityRepairRo,
} from '@teable/openapi';
import { v2PostgresDbTokens } from '@teable/v2-adapter-db-postgres-pg';
import {
  createSchemaChecker,
  createSchemaRepairer,
  PostgresSchemaIntrospector,
  type SchemaCheckResult,
  type SchemaRepairResult,
} from '@teable/v2-adapter-table-repository-postgres';
import {
  BaseId,
  TableByBaseIdSpec,
  TableByIdSpec,
  TableId,
  v2CoreTokens,
  type IBaseRepository,
  type ITableRepository,
  type Table,
} from '@teable/v2-core';
import { V2ContainerService } from '../v2/v2-container.service';
import { V2ExecutionContextFactory } from '../v2/v2-execution-context.factory';

type ISchemaIntegrityDb = Parameters<typeof createSchemaChecker>[0]['db'];

@Injectable()
export class IntegrityV2Service {
  constructor(
    private readonly v2ContainerService: V2ContainerService,
    private readonly v2ContextFactory: V2ExecutionContextFactory
  ) {}

  async createCheckStream(
    tableId: string,
    statuses?: IV2SchemaIntegrityFilterStatus[]
  ): Promise<AsyncGenerator<IV2SchemaIntegrityCheckResult, void, unknown>> {
    const { table, db, schema } = await this.resolveSchemaTarget(tableId);
    const checker = createSchemaChecker({
      db,
      introspector: new PostgresSchemaIntrospector(db),
      schema,
    });

    return this.decorateCheckStream(table, checker.checkTable(table), statuses);
  }

  async createRepairStream(
    tableId: string,
    repairRo: IV2SchemaIntegrityRepairRo
  ): Promise<AsyncGenerator<IV2SchemaIntegrityRepairResult, void, unknown>> {
    const { table, db, schema } = await this.resolveSchemaTarget(tableId);

    const repairer = createSchemaRepairer({
      db,
      introspector: new PostgresSchemaIntrospector(db),
      schema,
    });

    if (repairRo.fieldId && repairRo.ruleId) {
      return this.decorateRepairStream(
        table,
        repairer.repairRule(table, repairRo.fieldId, repairRo.ruleId, {
          dryRun: repairRo.dryRun,
        }),
        repairRo.statuses
      );
    }

    if (repairRo.fieldId) {
      return this.decorateRepairStream(
        table,
        repairer.repairField(table, repairRo.fieldId, {
          dryRun: repairRo.dryRun,
        }),
        repairRo.statuses
      );
    }

    return this.decorateRepairStream(
      table,
      repairer.repairTable(table, {
        dryRun: repairRo.dryRun,
      }),
      repairRo.statuses
    );
  }

  async createBaseCheckStream(
    baseId: string,
    statuses?: IV2SchemaIntegrityFilterStatus[]
  ): Promise<AsyncGenerator<IV2SchemaIntegrityCheckResult, void, unknown>> {
    const { tables, db, schema } = await this.resolveBaseTarget(baseId);
    const checker = createSchemaChecker({
      db,
      introspector: new PostgresSchemaIntrospector(db),
      schema,
    });

    return this.streamBaseChecks(tables, checker, statuses);
  }

  async createBaseRepairStream(
    baseId: string,
    repairRo: IV2BaseSchemaIntegrityRepairRo
  ): Promise<AsyncGenerator<IV2SchemaIntegrityRepairResult, void, unknown>> {
    const { tables, db, schema } = await this.resolveBaseTarget(baseId);
    const repairer = createSchemaRepairer({
      db,
      introspector: new PostgresSchemaIntrospector(db),
      schema,
    });

    return this.streamBaseRepairs(tables, repairer, repairRo);
  }

  private async resolveSchemaTarget(tableId: string) {
    const parsedTableId = TableId.create(tableId);
    if (parsedTableId.isErr()) {
      throw new HttpException(parsedTableId.error.message, HttpStatus.BAD_REQUEST);
    }

    const container = await this.v2ContainerService.getContainer();
    const tableRepository = container.resolve<ITableRepository>(v2CoreTokens.tableRepository);
    const context = await this.v2ContextFactory.createContext();
    const tableResult = await tableRepository.findOne(
      context,
      TableByIdSpec.create(parsedTableId.value)
    );

    if (tableResult.isErr()) {
      throw new HttpException(tableResult.error.message, HttpStatus.NOT_FOUND);
    }

    const db = container.resolve<ISchemaIntegrityDb>(v2PostgresDbTokens.db);
    const table = tableResult.value;

    return {
      table,
      db,
      schema: table.baseId().toString(),
    };
  }

  private async resolveBaseTarget(baseId: string) {
    const parsedBaseId = BaseId.create(baseId);
    if (parsedBaseId.isErr()) {
      throw new HttpException(parsedBaseId.error.message, HttpStatus.BAD_REQUEST);
    }

    const container = await this.v2ContainerService.getContainer();
    const tableRepository = container.resolve<ITableRepository>(v2CoreTokens.tableRepository);
    const baseRepository = container.resolve<IBaseRepository>(v2CoreTokens.baseRepository);
    const context = await this.v2ContextFactory.createContext();
    const baseResult = await baseRepository.findOne(context, parsedBaseId.value);

    if (baseResult.isErr()) {
      throw new HttpException(baseResult.error.message, HttpStatus.NOT_FOUND);
    }

    if (!baseResult.value) {
      throw new HttpException('Base not found', HttpStatus.NOT_FOUND);
    }

    const tablesResult = await tableRepository.find(
      context,
      TableByBaseIdSpec.create(parsedBaseId.value)
    );

    if (tablesResult.isErr()) {
      throw new HttpException(tablesResult.error.message, HttpStatus.INTERNAL_SERVER_ERROR);
    }

    const db = container.resolve<ISchemaIntegrityDb>(v2PostgresDbTokens.db);
    const tables = [...tablesResult.value].sort((left, right) =>
      left.name().toString().localeCompare(right.name().toString())
    );

    return {
      tables,
      db,
      schema: parsedBaseId.value.toString(),
    };
  }

  private async *streamBaseChecks(
    tables: ReadonlyArray<Table>,
    checker: ReturnType<typeof createSchemaChecker>,
    statuses?: IV2SchemaIntegrityFilterStatus[]
  ): AsyncGenerator<IV2SchemaIntegrityCheckResult, void, unknown> {
    for (const table of tables) {
      yield* this.decorateCheckStream(table, checker.checkTable(table), statuses);
    }
  }

  private async *streamBaseRepairs(
    tables: ReadonlyArray<Table>,
    repairer: ReturnType<typeof createSchemaRepairer>,
    repairRo: IV2BaseSchemaIntegrityRepairRo
  ): AsyncGenerator<IV2SchemaIntegrityRepairResult, void, unknown> {
    for (const table of tables) {
      yield* this.decorateRepairStream(
        table,
        repairer.repairTable(table, { dryRun: repairRo.dryRun }),
        repairRo.statuses
      );
    }
  }

  private async *decorateCheckStream(
    table: Table,
    stream: AsyncGenerator<SchemaCheckResult, void, unknown>,
    statuses?: IV2SchemaIntegrityFilterStatus[]
  ): AsyncGenerator<IV2SchemaIntegrityCheckResult, void, unknown> {
    const statusFilter = this.createStatusFilterSet(statuses);
    for await (const result of stream) {
      const serialized = this.serializeCheckResult(table, result);
      if (!this.shouldIncludeResult(serialized.status, statusFilter)) {
        continue;
      }

      yield serialized;
    }
  }

  private async *decorateRepairStream(
    table: Table,
    stream: AsyncGenerator<SchemaRepairResult, void, unknown>,
    statuses?: IV2SchemaIntegrityFilterStatus[]
  ): AsyncGenerator<IV2SchemaIntegrityRepairResult, void, unknown> {
    const statusFilter = this.createStatusFilterSet(statuses);
    for await (const result of stream) {
      const serialized = this.serializeRepairResult(table, result);
      if (!this.shouldIncludeResult(serialized.status, statusFilter)) {
        continue;
      }

      yield serialized;
    }
  }

  private serializeCheckResult(
    table: Table,
    result: SchemaCheckResult
  ): IV2SchemaIntegrityCheckResult {
    return {
      id: this.createScopedResultId(table, result.id),
      tableId: table.id().toString(),
      tableName: table.name().toString(),
      fieldId: result.fieldId,
      fieldName: result.fieldName,
      ruleId: result.ruleId,
      ruleDescription: result.ruleDescription,
      status: result.status,
      message: result.message,
      details: result.details
        ? {
            missing: this.toMutableArray(result.details.missing),
            extra: this.toMutableArray(result.details.extra),
          }
        : undefined,
      required: result.required,
      timestamp: result.timestamp,
      dependencies: result.dependencies.map((depId) => this.createScopedResultId(table, depId)),
      depth: result.depth,
    };
  }

  private serializeRepairResult(
    table: Table,
    result: SchemaRepairResult
  ): IV2SchemaIntegrityRepairResult {
    return {
      id: this.createScopedResultId(table, result.id),
      tableId: table.id().toString(),
      tableName: table.name().toString(),
      fieldId: result.fieldId,
      fieldName: result.fieldName,
      ruleId: result.ruleId,
      ruleDescription: result.ruleDescription,
      status: result.status,
      outcome: result.outcome,
      message: result.message,
      details: result.details
        ? {
            missing: this.toMutableArray(result.details.missing),
            extra: this.toMutableArray(result.details.extra),
            statementCount: result.details.statementCount,
          }
        : undefined,
      required: result.required,
      timestamp: result.timestamp,
      dependencies: result.dependencies.map((depId) => this.createScopedResultId(table, depId)),
      depth: result.depth,
    };
  }

  private createScopedResultId(table: Table, id: string): string {
    return `${table.id().toString()}:${id}`;
  }

  private toMutableArray(values?: ReadonlyArray<string>): string[] | undefined {
    return values ? [...values] : undefined;
  }

  private createStatusFilterSet(statuses?: IV2SchemaIntegrityFilterStatus[]) {
    return statuses?.length ? new Set(statuses) : undefined;
  }

  private shouldIncludeResult(
    status: IV2SchemaIntegrityCheckResult['status'] | IV2SchemaIntegrityRepairResult['status'],
    statusFilter?: ReadonlySet<IV2SchemaIntegrityFilterStatus>
  ) {
    if (!statusFilter?.size) {
      return true;
    }

    return statusFilter.has(status as IV2SchemaIntegrityFilterStatus);
  }
}
