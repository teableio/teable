import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import type {
  IV2BaseSchemaIntegrityRepairRo,
  IV2SchemaIntegrityFilterStatus,
  IV2SchemaIntegrityCheckResult,
  IV2SchemaIntegrityI18nMessage,
  IV2SchemaIntegrityManualRepairSchema,
  IV2SchemaIntegrityManualRepairSchemaProperty,
  IV2SchemaIntegrityRepairResult,
  IV2SchemaIntegrityRepairCapability,
  IV2SchemaIntegrityRepairRo,
} from '@teable/openapi';
import { v2PostgresDbTokens } from '@teable/v2-adapter-db-postgres-pg';
import {
  createSchemaChecker,
  createSchemaRepairer,
  PostgresSchemaIntrospector,
  type SchemaCheckResult,
  type SchemaRepairResult,
  type SchemaRuleRepairHint,
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
          manualRepairValues: repairRo.manualRepairValues,
          targetStatuses: repairRo.targetStatuses,
        }),
        repairRo.statuses
      );
    }

    if (repairRo.fieldId) {
      return this.decorateRepairStream(
        table,
        repairer.repairField(table, repairRo.fieldId, {
          dryRun: repairRo.dryRun,
          targetStatuses: repairRo.targetStatuses,
        }),
        repairRo.statuses
      );
    }

    return this.decorateRepairStream(
      table,
      repairer.repairTable(table, {
        dryRun: repairRo.dryRun,
        targetStatuses: repairRo.targetStatuses,
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
        repairer.repairTable(table, {
          dryRun: repairRo.dryRun,
          targetStatuses: repairRo.targetStatuses,
        }),
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
            missingItems: this.toMutableDetailItems(result.details.missingItems),
            extra: this.toMutableArray(result.details.extra),
            extraItems: this.toMutableDetailItems(result.details.extraItems),
          }
        : undefined,
      repair: result.repair ? this.toMutableRepairHint(result.repair) : undefined,
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
            missingItems: this.toMutableDetailItems(result.details.missingItems),
            extra: this.toMutableArray(result.details.extra),
            extraItems: this.toMutableDetailItems(result.details.extraItems),
            statementCount: result.details.statementCount,
          }
        : undefined,
      repair: result.repair ? this.toMutableRepairHint(result.repair) : undefined,
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

  private toMutableDetailItems(
    items?: ReadonlyArray<{
      code?: string;
      message: {
        key?: string;
        values?: Readonly<Record<string, string | number | boolean>>;
        fallback?: string;
      };
      description?: {
        key?: string;
        values?: Readonly<Record<string, string | number | boolean>>;
        fallback?: string;
      };
    }>
  ) {
    return items?.map((item) => ({
      code: item.code,
      message: {
        key: item.message.key,
        values: item.message.values ? { ...item.message.values } : undefined,
        fallback: item.message.fallback,
      },
      description: item.description
        ? {
            key: item.description.key,
            values: item.description.values ? { ...item.description.values } : undefined,
            fallback: item.description.fallback,
          }
        : undefined,
    }));
  }

  private toMutableRepairHint(result: SchemaRuleRepairHint) {
    const toMutableMessage = (message?: {
      key?: string;
      values?: Readonly<Record<string, string | number | boolean>>;
      fallback?: string;
    }): IV2SchemaIntegrityI18nMessage | undefined => {
      if (!message) {
        return undefined;
      }

      return {
        key: message.key,
        values: message.values ? { ...message.values } : undefined,
        fallback: message.fallback,
      };
    };

    const toMutableManualRepairProperty = (property: {
      type: 'string' | 'boolean';
      widget?: 'select' | 'text' | 'textarea' | 'checkbox';
      title?: {
        key?: string;
        values?: Readonly<Record<string, string | number | boolean>>;
        fallback?: string;
      };
      description?: {
        key?: string;
        values?: Readonly<Record<string, string | number | boolean>>;
        fallback?: string;
      };
      options?: ReadonlyArray<{
        value: string;
        label: {
          key?: string;
          values?: Readonly<Record<string, string | number | boolean>>;
          fallback?: string;
        };
        description?: {
          key?: string;
          values?: Readonly<Record<string, string | number | boolean>>;
          fallback?: string;
        };
      }>;
      defaultValue?: string | boolean;
    }): IV2SchemaIntegrityManualRepairSchemaProperty => ({
      type: property.type,
      widget: property.widget,
      title: toMutableMessage(property.title),
      description: toMutableMessage(property.description),
      options: property.options?.map((option) => ({
        value: option.value,
        label: {
          key: option.label.key,
          values: option.label.values ? { ...option.label.values } : undefined,
          fallback: option.label.fallback,
        },
        description: toMutableMessage(option.description),
      })),
      defaultValue: property.defaultValue,
    });

    const manualRepairSchema: IV2SchemaIntegrityManualRepairSchema | undefined =
      result.manualRepairSchema
        ? {
            type: result.manualRepairSchema.type,
            title: toMutableMessage(result.manualRepairSchema.title),
            description: toMutableMessage(result.manualRepairSchema.description),
            submitLabel: toMutableMessage(result.manualRepairSchema.submitLabel),
            required: result.manualRepairSchema.required
              ? [...result.manualRepairSchema.required]
              : undefined,
            properties: Object.fromEntries(
              Object.entries(result.manualRepairSchema.properties).map(([key, property]) => [
                key,
                toMutableManualRepairProperty(property),
              ])
            ),
          }
        : undefined;

    return {
      available: result.available,
      mode: result.mode,
      reason: toMutableMessage(result.reason),
      description: toMutableMessage(result.description),
      manualRepairSchema,
    } satisfies IV2SchemaIntegrityRepairCapability;
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
