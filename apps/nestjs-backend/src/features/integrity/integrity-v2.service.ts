import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import * as Sentry from '@sentry/nestjs';
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
import { v2DataDbTokens } from '@teable/v2-adapter-db-postgres-pg';
import {
  checkTableMetaWithTables,
  createMetaRepairer,
  createSchemaChecker,
  createSchemaRepairer,
  getMetaIssueDetails,
  getMetaRepairHint,
  getMetaRuleId,
  isMetaRuleId,
  metaRuleDescription,
  PostgresSchemaIntrospector,
  type MetaValidationIssue,
  type SchemaCheckResult,
  type SchemaRepairResult,
  type SchemaRuleRepairHint,
} from '@teable/v2-adapter-table-repository-postgres';
import {
  BaseId,
  TeableSpanAttributes,
  TableByBaseIdSpec,
  TableByIdSpec,
  TableId,
  v2CoreTokens,
  type IBaseRepository,
  type ITracer,
  type ITableRepository,
  type Table,
} from '@teable/v2-core';
import { V2ContainerService } from '../v2/v2-container.service';
import { V2ExecutionContextFactory } from '../v2/v2-execution-context.factory';

type ISchemaIntegrityDb = Parameters<typeof createSchemaChecker>[0]['db'];
type IRepairTelemetryScope = 'table' | 'base';
type IRepairTelemetryKind = 'result_error' | 'stream_exception';

const schemaIntegrityRepairFeatureTag = 'schema-integrity-repair';
const teableBaseIdAttribute = 'teable.base_id';
const integrityScopeAttribute = 'teable.integrity.scope';
const integrityTargetIdAttribute = 'teable.integrity.target_id';
const integrityFailureKindAttribute = 'teable.integrity.failure_kind';
const integrityRuleIdAttribute = 'teable.integrity.rule_id';
const integrityOutcomeAttribute = 'teable.integrity.outcome';
const integrityRequiredAttribute = 'teable.integrity.required';

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
    const { table, tables, db, schema } = await this.resolveSchemaTarget(tableId, {
      includeBaseTables: true,
    });
    const checker = createSchemaChecker({
      db,
      introspector: new PostgresSchemaIntrospector(db),
      schema,
    });

    return this.streamTableChecks(table, tables, checker, statuses);
  }

  async createRepairStream(
    tableId: string,
    repairRo: IV2SchemaIntegrityRepairRo
  ): Promise<AsyncGenerator<IV2SchemaIntegrityRepairResult, void, unknown>> {
    const { table, tables, db, schema, context } = await this.resolveSchemaTarget(tableId, {
      includeBaseTables: true,
    });

    const repairer = createSchemaRepairer({
      db,
      introspector: new PostgresSchemaIntrospector(db),
      schema,
    });
    const metaRepairer = createMetaRepairer({ db });

    if (repairRo.fieldId && isMetaRuleId(repairRo.ruleId)) {
      return this.decorateRepairStream(
        table,
        metaRepairer.repairRule(table, tables, repairRo.fieldId, repairRo.ruleId, {
          dryRun: repairRo.dryRun,
          targetStatuses: repairRo.targetStatuses,
        }),
        repairRo.statuses,
        {
          tracer: context.tracer,
          scope: 'table',
          targetId: tableId,
        }
      );
    }

    if (repairRo.fieldId && repairRo.ruleId) {
      return this.decorateRepairStream(
        table,
        repairer.repairRule(table, repairRo.fieldId, repairRo.ruleId, {
          dryRun: repairRo.dryRun,
          manualRepairValues: repairRo.manualRepairValues,
          targetStatuses: repairRo.targetStatuses,
        }),
        repairRo.statuses,
        {
          tracer: context.tracer,
          scope: 'table',
          targetId: tableId,
        }
      );
    }

    if (repairRo.fieldId) {
      return this.decorateRepairStream(
        table,
        this.combineRepairStreams(
          repairer.repairField(table, repairRo.fieldId, {
            dryRun: repairRo.dryRun,
            targetStatuses: repairRo.targetStatuses,
          }),
          metaRepairer.repairField(table, tables, repairRo.fieldId, {
            dryRun: repairRo.dryRun,
            targetStatuses: repairRo.targetStatuses,
          })
        ),
        repairRo.statuses,
        {
          tracer: context.tracer,
          scope: 'table',
          targetId: tableId,
        }
      );
    }

    return this.decorateRepairStream(
      table,
      this.combineRepairStreams(
        repairer.repairTable(table, {
          dryRun: repairRo.dryRun,
          targetStatuses: repairRo.targetStatuses,
        }),
        metaRepairer.repairTable(table, tables, {
          dryRun: repairRo.dryRun,
          targetStatuses: repairRo.targetStatuses,
        })
      ),
      repairRo.statuses,
      {
        tracer: context.tracer,
        scope: 'table',
        targetId: tableId,
      }
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
    const { tables, db, schema, context } = await this.resolveBaseTarget(baseId);
    const repairer = createSchemaRepairer({
      db,
      introspector: new PostgresSchemaIntrospector(db),
      schema,
    });
    const metaRepairer = createMetaRepairer({ db });

    return this.streamBaseRepairs(tables, repairer, metaRepairer, repairRo, {
      tracer: context.tracer,
      scope: 'base',
      targetId: baseId,
    });
  }

  private async resolveSchemaTarget(
    tableId: string,
    options?: {
      includeBaseTables?: boolean;
    }
  ) {
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

    const db = container.resolve<ISchemaIntegrityDb>(v2DataDbTokens.db);
    const table = tableResult.value;
    let tables: ReadonlyArray<Table> = [table];

    if (options?.includeBaseTables) {
      const tablesResult = await tableRepository.find(
        context,
        TableByBaseIdSpec.create(table.baseId())
      );

      if (tablesResult.isErr()) {
        throw new HttpException(tablesResult.error.message, HttpStatus.INTERNAL_SERVER_ERROR);
      }

      tables = tablesResult.value;
    }

    return {
      table,
      tables,
      db,
      schema: table.baseId().toString(),
      context,
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

    const db = container.resolve<ISchemaIntegrityDb>(v2DataDbTokens.db);
    const tables = [...tablesResult.value].sort((left, right) =>
      left.name().toString().localeCompare(right.name().toString())
    );

    return {
      tables,
      db,
      schema: parsedBaseId.value.toString(),
      context,
    };
  }

  private async *streamTableChecks(
    table: Table,
    allTables: ReadonlyArray<Table>,
    checker: ReturnType<typeof createSchemaChecker>,
    statuses?: IV2SchemaIntegrityFilterStatus[]
  ): AsyncGenerator<IV2SchemaIntegrityCheckResult, void, unknown> {
    yield* this.decorateCheckStream(table, checker.checkTable(table), statuses);
    yield* this.decorateMetaCheckStream(
      table,
      checkTableMetaWithTables(table, table.baseId(), allTables),
      statuses
    );
  }

  private async *streamBaseChecks(
    tables: ReadonlyArray<Table>,
    checker: ReturnType<typeof createSchemaChecker>,
    statuses?: IV2SchemaIntegrityFilterStatus[]
  ): AsyncGenerator<IV2SchemaIntegrityCheckResult, void, unknown> {
    for (const table of tables) {
      yield* this.streamTableChecks(table, tables, checker, statuses);
    }
  }

  private async *streamBaseRepairs(
    tables: ReadonlyArray<Table>,
    repairer: ReturnType<typeof createSchemaRepairer>,
    metaRepairer: ReturnType<typeof createMetaRepairer>,
    repairRo: IV2BaseSchemaIntegrityRepairRo,
    telemetry: {
      tracer?: ITracer;
      scope: IRepairTelemetryScope;
      targetId: string;
    }
  ): AsyncGenerator<IV2SchemaIntegrityRepairResult, void, unknown> {
    for (const table of tables) {
      yield* this.decorateRepairStream(
        table,
        this.combineRepairStreams(
          repairer.repairTable(table, {
            dryRun: repairRo.dryRun,
            targetStatuses: repairRo.targetStatuses,
          }),
          metaRepairer.repairTable(table, tables, {
            dryRun: repairRo.dryRun,
            targetStatuses: repairRo.targetStatuses,
          })
        ),
        repairRo.statuses,
        telemetry
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
    statuses?: IV2SchemaIntegrityFilterStatus[],
    telemetry?: {
      tracer?: ITracer;
      scope: IRepairTelemetryScope;
      targetId: string;
    }
  ): AsyncGenerator<IV2SchemaIntegrityRepairResult, void, unknown> {
    const statusFilter = this.createStatusFilterSet(statuses);
    try {
      for await (const result of stream) {
        const serialized = this.serializeRepairResult(table, result);
        if (serialized.status === 'error' && telemetry) {
          await this.captureRepairFailure(
            table,
            result,
            new Error(result.message),
            telemetry,
            'result_error'
          );
        }

        if (!this.shouldIncludeResult(serialized.status, statusFilter)) {
          continue;
        }

        yield serialized;
      }
    } catch (error) {
      if (telemetry) {
        await this.captureRepairFailure(table, undefined, error, telemetry, 'stream_exception');
      }
      throw error;
    }
  }

  private async *combineRepairStreams(
    ...streams: ReadonlyArray<AsyncGenerator<SchemaRepairResult, void, unknown>>
  ): AsyncGenerator<SchemaRepairResult, void, unknown> {
    for (const stream of streams) {
      yield* stream;
    }
  }

  private async captureRepairFailure(
    table: Table,
    result: SchemaRepairResult | undefined,
    error: unknown,
    telemetry: {
      tracer?: ITracer;
      scope: IRepairTelemetryScope;
      targetId: string;
    },
    kind: IRepairTelemetryKind
  ): Promise<void> {
    const err = error instanceof Error ? error : new Error(String(error));
    const tableId = table.id().toString();
    const baseId = table.baseId().toString();
    const spanAttributes: Record<string, string | number | boolean> = {
      [TeableSpanAttributes.VERSION]: 'v2',
      [TeableSpanAttributes.COMPONENT]: 'service',
      [TeableSpanAttributes.OPERATION]: 'integrity.repair.failure',
      [TeableSpanAttributes.TABLE_ID]: tableId,
      [teableBaseIdAttribute]: baseId,
      [integrityScopeAttribute]: telemetry.scope,
      [integrityTargetIdAttribute]: telemetry.targetId,
      [integrityFailureKindAttribute]: kind,
    };

    if (result?.fieldId && result.fieldId !== '__system__') {
      spanAttributes[TeableSpanAttributes.FIELD_ID] = result.fieldId;
    }
    if (result?.ruleId) {
      spanAttributes[integrityRuleIdAttribute] = result.ruleId;
    }
    if (result?.outcome) {
      spanAttributes[integrityOutcomeAttribute] = result.outcome;
    }
    if (result?.required != null) {
      spanAttributes[integrityRequiredAttribute] = result.required;
    }

    const reportToSentry = () => {
      Sentry.withScope((scope) => {
        scope.setLevel?.('error');
        scope.setTag('feature', schemaIntegrityRepairFeatureTag);
        scope.setTag('integrity.scope', telemetry.scope);
        scope.setTag('integrity.target_id', telemetry.targetId);
        scope.setTag('integrity.failure_kind', kind);
        scope.setTag('base.id', baseId);
        scope.setTag('table.id', tableId);

        if (result?.ruleId) {
          scope.setTag('integrity.rule_id', result.ruleId);
        }
        if (result?.fieldId && result.fieldId !== '__system__') {
          scope.setTag('field.id', result.fieldId);
        }

        scope.setContext('schema-integrity-repair', {
          baseId,
          tableId,
          tableName: table.name().toString(),
          scope: telemetry.scope,
          targetId: telemetry.targetId,
          failureKind: kind,
          resultId: result?.id,
          fieldId: result?.fieldId,
          fieldName: result?.fieldName,
          ruleId: result?.ruleId,
          ruleDescription: result?.ruleDescription,
          outcome: result?.outcome,
          required: result?.required,
          details: result?.details,
        });

        Sentry.captureException(err);
      });
    };

    const tracer = telemetry.tracer;
    if (!tracer) {
      reportToSentry();
      return;
    }

    const span = tracer.startSpan('teable.IntegrityV2Service.reportRepairFailure', spanAttributes);
    try {
      span.recordError(err.message);
      await tracer.withSpan(span, async () => {
        reportToSentry();
      });
    } finally {
      span.end();
    }
  }

  private async *decorateMetaCheckStream(
    table: Table,
    stream: AsyncGenerator<MetaValidationIssue, void, unknown>,
    statuses?: IV2SchemaIntegrityFilterStatus[]
  ): AsyncGenerator<IV2SchemaIntegrityCheckResult, void, unknown> {
    const statusFilter = this.createStatusFilterSet(statuses);

    for await (const issue of stream) {
      const status = this.toMetaCheckStatus(issue.severity);
      if (!status || !this.shouldIncludeResult(status, statusFilter)) {
        continue;
      }

      yield {
        id: this.createScopedResultId(table, `${issue.fieldId}:${getMetaRuleId(issue)}`),
        baseId: table.baseId().toString(),
        tableId: table.id().toString(),
        tableName: table.name().toString(),
        fieldId: issue.fieldId,
        fieldName: issue.fieldName,
        ruleId: getMetaRuleId(issue),
        ruleDescription: metaRuleDescription,
        status,
        message: issue.message,
        details: this.toMutableDetails(getMetaIssueDetails(issue)),
        repair:
          status === 'error' || status === 'warn'
            ? this.toMutableRepairHint(getMetaRepairHint(issue))
            : undefined,
        required: true,
        timestamp: Date.now(),
        dependencies: [],
        depth: 0,
      };
    }
  }

  private serializeCheckResult(
    table: Table,
    result: SchemaCheckResult
  ): IV2SchemaIntegrityCheckResult {
    return {
      id: this.createScopedResultId(table, result.id),
      baseId: table.baseId().toString(),
      tableId: table.id().toString(),
      tableName: table.name().toString(),
      fieldId: result.fieldId,
      fieldName: result.fieldName,
      ruleId: result.ruleId,
      ruleDescription: result.ruleDescription,
      status: result.status,
      message: result.message,
      details: this.toMutableDetails(result.details),
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
      baseId: table.baseId().toString(),
      tableId: table.id().toString(),
      tableName: table.name().toString(),
      fieldId: result.fieldId,
      fieldName: result.fieldName,
      ruleId: result.ruleId,
      ruleDescription: result.ruleDescription,
      status: result.status,
      outcome: result.outcome,
      message: result.message,
      details: this.toMutableDetails(result.details),
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

  private toMutableDetails(details?: SchemaRepairResult['details']) {
    return details
      ? {
          missing: this.toMutableArray(details.missing),
          missingItems: this.toMutableDetailItems(details.missingItems),
          extra: this.toMutableArray(details.extra),
          extraItems: this.toMutableDetailItems(details.extraItems),
          statementCount: details.statementCount,
          statements: details.statements?.map((statement) => ({
            sql: statement.sql,
            parameters: [...statement.parameters],
          })),
        }
      : undefined;
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

  private toMetaCheckStatus(
    severity: MetaValidationIssue['severity']
  ): IV2SchemaIntegrityCheckResult['status'] | undefined {
    if (severity === 'error') return 'error';
    if (severity === 'warning') return 'warn';
    return undefined;
  }
}
