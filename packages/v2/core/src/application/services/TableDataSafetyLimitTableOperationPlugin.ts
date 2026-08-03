import { err, ok } from 'neverthrow';
import type { Result } from 'neverthrow';

import type { BaseId } from '../../domain/base/BaseId';
import type { IDomainContext } from '../../domain/shared/DomainContext';
import type { DomainError } from '../../domain/shared/DomainError';
import {
  ensureWithinTableDataSafetyLimit,
  resolveTableDataSafetyLimits,
  type ResolvedTableDataSafetyLimitConfig,
} from '../../domain/shared/TableDataSafetyLimits';
import { Table } from '../../domain/table/Table';
import { getDomainContext, type IExecutionContext } from '../../ports/ExecutionContext';
import type {
  ITableOperationPlugin,
  TableOperationPluginContext,
} from '../../ports/TableOperationPlugin';
import { TableOperationKind } from '../../ports/TableOperationPlugin';
import type { ITableRepository } from '../../ports/TableRepository';
import { ensureTableDataSafetyFieldLimits } from './TableDataSafetyLimitFieldOperationPlugin';
import { ensureTableDataSafetyViewConfigLimits } from './TableDataSafetyLimitViewOperationPlugin';
import { TableDataSafetyLimitComposer } from './TableDataSafetyLimitComposer';

type PreparedTableDataSafetyOperationLimitState = {
  readonly domainContext: IDomainContext | undefined;
  readonly limits: ResolvedTableDataSafetyLimitConfig;
};

const tableNameLength = (context: TableOperationPluginContext): number => {
  switch (context.kind) {
    case TableOperationKind.read:
      return 0;
    case TableOperationKind.create:
    case TableOperationKind.duplicate:
    case TableOperationKind.importCsv:
    case TableOperationKind.rename:
      return context.payload.tableName.toString().length;
    case TableOperationKind.createMany:
      return Math.max(
        0,
        ...context.payload.tables.map((table) => table.tableName.toString().length)
      );
  }
};

export class TableDataSafetyLimitTableOperationPlugin
  implements ITableOperationPlugin<PreparedTableDataSafetyOperationLimitState>
{
  readonly name = 'table-data-safety-table-operation-limit';
  readonly enforce = 'post' as const;

  constructor(
    private readonly tableRepository: ITableRepository,
    private readonly limitComposer: TableDataSafetyLimitComposer
  ) {}

  supports(operation: TableOperationKind): boolean {
    return operation !== TableOperationKind.read;
  }

  async prepare(
    context: TableOperationPluginContext
  ): Promise<Result<PreparedTableDataSafetyOperationLimitState, DomainError>> {
    const configResult = await this.limitComposer.compose(context.executionContext);
    if (configResult.isErr()) return err(configResult.error);
    return ok({
      domainContext: getDomainContext(context.executionContext),
      limits: resolveTableDataSafetyLimits(configResult.value),
    });
  }

  async guard(
    context: TableOperationPluginContext,
    preparedState: PreparedTableDataSafetyOperationLimitState | undefined
  ): Promise<Result<void, DomainError>> {
    const limits = preparedState?.limits ?? resolveTableDataSafetyLimits();

    const nameResult = ensureWithinTableDataSafetyLimit(
      'validation.limit.name_max_length',
      tableNameLength(context),
      limits.displayText.maxNameLength,
      { target: 'table.name' }
    );
    if (nameResult.isErr()) return nameResult;

    switch (context.kind) {
      case TableOperationKind.read:
        return ok(undefined);
      case TableOperationKind.create: {
        const tableCountResult = await this.ensureTablesPerBaseLimit(
          context.executionContext,
          context.payload.baseId,
          1,
          limits
        );
        if (tableCountResult.isErr()) return tableCountResult;
        return this.ensureCreatePayloadLimits(
          context.payload,
          limits,
          preparedState?.domainContext
        );
      }
      case TableOperationKind.createMany: {
        const tableCountResult = await this.ensureTablesPerBaseLimit(
          context.executionContext,
          context.payload.baseId,
          context.payload.tables.length,
          limits
        );
        if (tableCountResult.isErr()) return tableCountResult;

        for (const table of context.payload.tables) {
          const result = this.ensureCreatePayloadLimits(
            table,
            limits,
            preparedState?.domainContext
          );
          if (result.isErr()) return result;
        }
        return ok(undefined);
      }
      case TableOperationKind.duplicate: {
        const tableCountResult = await this.ensureTablesPerBaseLimit(
          context.executionContext,
          context.payload.baseId,
          1,
          limits
        );
        if (tableCountResult.isErr()) return tableCountResult;
        if (!context.payload.table) return ok(undefined);
        return this.ensureTableStructureLimits(
          context.payload.table,
          limits,
          preparedState?.domainContext
        );
      }
      case TableOperationKind.importCsv: {
        const tableCountResult = await this.ensureTablesPerBaseLimit(
          context.executionContext,
          context.payload.baseId,
          1,
          limits
        );
        if (tableCountResult.isErr()) return tableCountResult;
        return this.ensureImportCsvPayloadLimits(
          context.payload,
          limits,
          preparedState?.domainContext
        );
      }
      case TableOperationKind.rename:
        return ok(undefined);
    }
  }

  private ensureCreatePayloadLimits(
    payload: {
      readonly fieldCount: number;
      readonly viewCount: number;
      readonly recordCount: number;
      readonly viewNames: ReadonlyArray<string>;
      readonly table?: Table;
    },
    limits: ResolvedTableDataSafetyLimitConfig,
    domainContext: IDomainContext | undefined
  ): Result<void, DomainError> {
    const fieldsResult = ensureWithinTableDataSafetyLimit(
      'validation.limit.create_table_fields_max',
      payload.fieldCount,
      limits.tableSchema.maxCreateTableFields,
      { target: 'table.fields' }
    );
    if (fieldsResult.isErr()) return fieldsResult;

    const fieldsPerTableResult = this.ensureFieldsPerTableLimit(payload.fieldCount, limits);
    if (fieldsPerTableResult.isErr()) return fieldsPerTableResult;

    const viewsResult = ensureWithinTableDataSafetyLimit(
      'validation.limit.create_table_views_max',
      payload.viewCount,
      limits.tableSchema.maxCreateTableViews,
      { target: 'table.views' }
    );
    if (viewsResult.isErr()) return viewsResult;

    const viewsPerTableResult = ensureWithinTableDataSafetyLimit(
      'validation.limit.views_per_table_max',
      payload.viewCount > 0 ? payload.viewCount : 1,
      limits.tableSchema.maxViewsPerTable,
      { target: 'table.views' }
    );
    if (viewsPerTableResult.isErr()) return viewsPerTableResult;

    const recordsResult = ensureWithinTableDataSafetyLimit(
      'validation.limit.create_table_records_max',
      payload.recordCount,
      limits.tableSchema.maxCreateTableRecords,
      { target: 'table.records' }
    );
    if (recordsResult.isErr()) return recordsResult;

    for (const [index, viewName] of payload.viewNames.entries()) {
      const viewNameResult = ensureWithinTableDataSafetyLimit(
        'validation.limit.name_max_length',
        viewName.length,
        limits.displayText.maxNameLength,
        {
          target: 'view.name',
          viewIndex: index,
        }
      );
      if (viewNameResult.isErr()) return viewNameResult;
    }

    if (payload.table) {
      return this.ensureTableStructureLimits(payload.table, limits, domainContext);
    }

    return ok(undefined);
  }

  private ensureTableStructureLimits(
    table: Table,
    limits: ResolvedTableDataSafetyLimitConfig,
    domainContext: IDomainContext | undefined
  ): Result<void, DomainError> {
    const fieldsPerTableResult = this.ensureFieldsPerTableLimit(table.getFields().length, limits);
    if (fieldsPerTableResult.isErr()) return fieldsPerTableResult;

    const viewsPerTableResult = ensureWithinTableDataSafetyLimit(
      'validation.limit.views_per_table_max',
      table.views().length > 0 ? table.views().length : 1,
      limits.tableSchema.maxViewsPerTable,
      { target: 'table.views' }
    );
    if (viewsPerTableResult.isErr()) return viewsPerTableResult;

    for (const field of table.getFields()) {
      const fieldResult = ensureTableDataSafetyFieldLimits(field, domainContext, limits);
      if (fieldResult.isErr()) return fieldResult;
    }

    for (const view of table.views()) {
      const queryDefaultsResult = view.queryDefaults();
      const queryDefaults = queryDefaultsResult.isOk() ? queryDefaultsResult.value.toDto() : {};
      const viewResult = ensureTableDataSafetyViewConfigLimits(
        {
          name: view.name().toString(),
          filter: queryDefaults.filter,
          sort: queryDefaults.sort,
          group: queryDefaults.group,
          options: view.options(),
        },
        limits
      );
      if (viewResult.isErr()) return viewResult;
    }

    return ok(undefined);
  }

  private ensureFieldsPerTableLimit(
    fieldCount: number,
    limits: ResolvedTableDataSafetyLimitConfig
  ): Result<void, DomainError> {
    return ensureWithinTableDataSafetyLimit(
      'validation.limit.fields_per_table_max',
      fieldCount,
      limits.tableSchema.maxFieldsPerTable,
      { target: 'table.fields' }
    );
  }

  private ensureImportCsvPayloadLimits(
    payload: {
      readonly fieldCount: number;
      readonly viewCount: number;
      readonly recordCount: number;
      readonly table?: Table;
    },
    limits: ResolvedTableDataSafetyLimitConfig,
    domainContext: IDomainContext | undefined
  ): Result<void, DomainError> {
    return this.ensureCreatePayloadLimits(
      {
        fieldCount: payload.fieldCount,
        viewCount: payload.viewCount,
        recordCount: payload.recordCount,
        viewNames: [],
        table: payload.table,
      },
      limits,
      domainContext
    );
  }

  private async ensureTablesPerBaseLimit(
    context: IExecutionContext,
    baseId: BaseId,
    addedTableCount: number,
    limits: ResolvedTableDataSafetyLimitConfig
  ): Promise<Result<void, DomainError>> {
    const whereSpec = Table.specs(baseId).byBaseId().build();
    if (whereSpec.isErr()) return err(whereSpec.error);
    const existingTableCountResult = this.tableRepository.count
      ? await this.tableRepository.count(context, whereSpec.value, { state: 'active' })
      : await (async () => {
          const existingTablesResult = await this.tableRepository.find(context, whereSpec.value, {
            state: 'active',
          });
          return existingTablesResult.map((tables) => tables.length);
        })();
    if (existingTableCountResult.isErr()) return err(existingTableCountResult.error);
    const existingTableCount = existingTableCountResult.value;

    return ensureWithinTableDataSafetyLimit(
      'validation.limit.tables_per_base_max',
      existingTableCount + addedTableCount,
      limits.tableSchema.maxTablesPerBase,
      {
        baseId: baseId.toString(),
        currentTableCount: existingTableCount,
        addedTableCount,
      }
    );
  }
}
