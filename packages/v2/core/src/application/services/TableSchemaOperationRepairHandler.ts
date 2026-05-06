import { inject, injectable } from '@teable/v2-di';
import { err, ok, safeTry } from 'neverthrow';
import type { Result } from 'neverthrow';

import { domainError, type DomainError } from '../../domain/shared/DomainError';
import type { LinkForeignTableReference } from '../../domain/table/fields/visitors/LinkForeignTableReferenceVisitor';
import type { Table } from '../../domain/table/Table';
import { Table as TableAggregate } from '../../domain/table/Table';
import { TableId } from '../../domain/table/TableId';
import type { IExecutionContext } from '../../ports/ExecutionContext';
import type { SchemaOperationRecord } from '../../ports/SchemaOperationRepository';
import * as TableRepositoryPort from '../../ports/TableRepository';
import * as TableSchemaRepositoryPort from '../../ports/TableSchemaRepository';
import { v2CoreTokens } from '../../ports/tokens';
import * as UnitOfWorkPort from '../../ports/UnitOfWork';
import { FieldCreationSideEffectService } from './FieldCreationSideEffectService';
import { ForeignTableLoaderService } from './ForeignTableLoaderService';
import type {
  ISchemaOperationHandler,
  SchemaOperationHandlerResult,
} from './SchemaOperationRunnerService';
import {
  completeTableSchemaOperation,
  completeTablesSchemaOperation,
} from './TableSchemaOperationLifecycleService';

const repairTypes = ['table.create', 'table.create_many', 'table.import'] as const;

type PayloadRecord = Record<string, unknown>;

const payloadRecord = (payload: unknown): PayloadRecord =>
  payload && typeof payload === 'object' && !Array.isArray(payload)
    ? (payload as PayloadRecord)
    : {};

const tableIdsFromOperation = (
  operation: SchemaOperationRecord
): Result<ReadonlyArray<TableId>, DomainError> => {
  const payload = payloadRecord(operation.payload);
  const rawTableIds = Array.isArray(payload.tableIds)
    ? payload.tableIds
    : operation.target.tableId
      ? [operation.target.tableId]
      : [];
  if (rawTableIds.length === 0) {
    return err(
      domainError.invariant({
        code: 'schema_operation.table_id_missing',
        message: 'Schema operation does not identify a table to repair',
        details: { operationId: operation.id },
      })
    );
  }

  const tableIds: TableId[] = [];
  for (const rawTableId of rawTableIds) {
    const tableId = TableId.create(rawTableId);
    if (tableId.isErr()) return err(tableId.error);
    tableIds.push(tableId.value);
  }
  return ok(tableIds);
};

const tableOperationIdFromKey = (idempotencyKey: string, tableId: string): string | undefined => {
  const suffix = `:table:${tableId}`;
  return idempotencyKey.endsWith(suffix)
    ? idempotencyKey.slice(0, idempotencyKey.length - suffix.length)
    : undefined;
};

const uniqueForeignTableReferences = (
  refs: ReadonlyArray<LinkForeignTableReference>
): ReadonlyArray<LinkForeignTableReference> => {
  const unique: LinkForeignTableReference[] = [];
  const seen = new Set<string>();
  for (const ref of refs) {
    const baseKey = ref.baseId ? ref.baseId.toString() : 'local';
    const key = `${baseKey}:${ref.foreignTableId.toString()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(ref);
  }
  return unique;
};

const externalReferences = (
  tables: ReadonlyArray<Table>,
  refs: ReadonlyArray<LinkForeignTableReference>
): ReadonlyArray<LinkForeignTableReference> => {
  const internalTableIds = new Set(tables.map((table) => table.id().toString()));
  return refs.filter((ref) => {
    const foreignTableId = ref.foreignTableId.toString();
    if (!internalTableIds.has(foreignTableId)) return true;
    const internalTable = tables.find((table) => table.id().toString() === foreignTableId);
    if (!internalTable) return true;
    if (ref.baseId && !ref.baseId.equals(internalTable.baseId())) return true;
    return false;
  });
};

const hasPositiveRecordCount = (
  operation: SchemaOperationRecord,
  tableIds: ReadonlyArray<TableId>
): boolean | 'unknown' => {
  const payload = payloadRecord(operation.payload);

  if (operation.type === 'table.create') {
    return typeof payload.recordCount === 'number' ? payload.recordCount > 0 : 'unknown';
  }

  if (operation.type === 'table.create_many') {
    const counts = payloadRecord(payload.recordCountByTableId);
    if (Object.keys(counts).length === 0) return 'unknown';
    return tableIds.some((tableId) => {
      const count = counts[tableId.toString()];
      return typeof count !== 'number' || count > 0;
    });
  }

  return false;
};

const unsupportedRepair = (message: string, details?: PayloadRecord): DomainError =>
  domainError.notImplemented({
    code: 'schema_operation.repair_not_supported',
    message,
    details,
  });

@injectable()
export class TableSchemaOperationRepairHandler implements ISchemaOperationHandler {
  readonly type = repairTypes;

  constructor(
    @inject(v2CoreTokens.tableRepository)
    private readonly tableRepository: TableRepositoryPort.ITableRepository,
    @inject(v2CoreTokens.tableSchemaRepository)
    private readonly tableSchemaRepository: TableSchemaRepositoryPort.ITableSchemaRepository,
    @inject(v2CoreTokens.fieldCreationSideEffectService)
    private readonly fieldCreationSideEffectService: FieldCreationSideEffectService,
    @inject(v2CoreTokens.foreignTableLoaderService)
    private readonly foreignTableLoaderService: ForeignTableLoaderService,
    @inject(v2CoreTokens.unitOfWork)
    private readonly unitOfWork: UnitOfWorkPort.IUnitOfWork
  ) {}

  async run(
    context: IExecutionContext,
    operation: SchemaOperationRecord
  ): Promise<Result<SchemaOperationHandlerResult, DomainError>> {
    const handler = this;
    return safeTry<SchemaOperationHandlerResult, DomainError>(async function* () {
      const payload = payloadRecord(operation.payload);
      if (operation.type === 'table.import' && payload.source !== 'dottea') {
        return err(
          unsupportedRepair('Only structure-only DotTea imports can be repaired automatically', {
            operationType: operation.type,
            source: payload.source,
          })
        );
      }

      const tableIds = yield* tableIdsFromOperation(operation);
      const recordCount = hasPositiveRecordCount(operation, tableIds);
      if (recordCount === 'unknown') {
        return err(
          unsupportedRepair('Schema operation payload is missing record-count repair metadata', {
            operationType: operation.type,
            operationId: operation.id,
          })
        );
      }
      if (recordCount) {
        return err(
          unsupportedRepair(
            'Schema operation with records requires durable record replay payload',
            {
              operationType: operation.type,
              operationId: operation.id,
            }
          )
        );
      }

      if (!handler.tableSchemaRepository.ensureInsertedMany) {
        return err(
          unsupportedRepair('Table schema repository does not support idempotent schema repair', {
            operationType: operation.type,
          })
        );
      }

      const tables = yield* await handler.loadTables(context, tableIds);
      const references = yield* handler.collectReferences(tables);
      const foreignTables = yield* await handler.foreignTableLoaderService.load(context, {
        references: externalReferences(tables, references),
      });

      yield* await handler.unitOfWork.withTransaction(
        context,
        async (dataContext) =>
          safeTry<void, DomainError>(async function* () {
            yield* await handler.tableSchemaRepository.ensureInsertedMany!(dataContext, tables);
            yield* await handler.replayFieldCreationSideEffects(dataContext, tables, foreignTables);
            return ok(undefined);
          }),
        { scope: 'data' }
      );

      if (tables.length === 1) {
        yield* await completeTableSchemaOperation(
          handler.unitOfWork,
          handler.tableRepository,
          context,
          tables[0]!,
          {
            type: operation.type,
            idempotencyKey: operation.idempotencyKey,
          }
        );
      } else {
        const operationTableId = operation.target.tableId ?? tables[0]!.id().toString();
        const operationId = tableOperationIdFromKey(operation.idempotencyKey, operationTableId);
        if (!operationId) {
          return err(
            unsupportedRepair('Batch schema operation idempotency key is not repairable', {
              operationId: operation.id,
              idempotencyKey: operation.idempotencyKey,
            })
          );
        }
        yield* await completeTablesSchemaOperation(
          handler.unitOfWork,
          handler.tableRepository,
          context,
          tables,
          {
            type: operation.type,
            operationId,
          }
        );
      }

      return ok({
        result: {
          repaired: 'table_schema',
          tableIds: tables.map((table) => table.id().toString()),
        },
      });
    });
  }

  private async loadTables(
    context: IExecutionContext,
    tableIds: ReadonlyArray<TableId>
  ): Promise<Result<ReadonlyArray<Table>, DomainError>> {
    const service = this;
    return safeTry<ReadonlyArray<Table>, DomainError>(async function* () {
      const spec = yield* TableAggregate.specs().byIds(tableIds).build();
      const tables = yield* await service.tableRepository.find(context, spec, { state: 'all' });
      const tablesById = new Map(tables.map((table) => [table.id().toString(), table] as const));
      const orderedTables: Table[] = [];
      for (const tableId of tableIds) {
        const table = tablesById.get(tableId.toString());
        if (!table) {
          return err(
            domainError.notFound({
              code: 'table.not_found',
              message: 'Table not found for schema operation repair',
              details: { tableId: tableId.toString() },
            })
          );
        }
        orderedTables.push(table);
      }
      return ok(orderedTables);
    });
  }

  private collectReferences(
    tables: ReadonlyArray<Table>
  ): Result<ReadonlyArray<LinkForeignTableReference>, DomainError> {
    const refs: LinkForeignTableReference[] = [];
    for (const table of tables) {
      const tableRefs = table.foreignTableReferences();
      if (tableRefs.isErr()) return err(tableRefs.error);
      refs.push(...tableRefs.value);
    }
    return ok(uniqueForeignTableReferences(refs));
  }

  private async replayFieldCreationSideEffects(
    context: IExecutionContext,
    tables: ReadonlyArray<Table>,
    foreignTables: ReadonlyArray<Table>
  ): Promise<Result<void, DomainError>> {
    const service = this;
    return safeTry<void, DomainError>(async function* () {
      let tableState = new Map<string, Table>(
        [...foreignTables, ...tables].map((table) => [table.id().toString(), table] as const)
      );

      for (const table of tables) {
        const sideEffectResult = yield* await service.fieldCreationSideEffectService.execute(
          context,
          {
            table,
            fields: table.getFields(),
            foreignTables: [...tableState.values()],
            tableState,
          }
        );
        tableState = new Map(sideEffectResult.tableState);
      }

      return ok(undefined);
    });
  }
}
