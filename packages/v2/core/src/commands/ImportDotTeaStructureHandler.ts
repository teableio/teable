import { inject, injectable } from '@teable/v2-di';
import { err, ok, safeTry } from 'neverthrow';
import type { Result } from 'neverthrow';

import { ForeignTableLoaderService } from '../application/services/ForeignTableLoaderService';
import { TableCreationService } from '../application/services/TableCreationService';
import type { BaseId } from '../domain/base/BaseId';
import type { DomainError } from '../domain/shared/DomainError';
import { domainError } from '../domain/shared/DomainError';
import { validateForeignTablesForFields } from '../domain/table/fields/ForeignTableRelatedField';
import type { LinkForeignTableReference } from '../domain/table/fields/visitors/LinkForeignTableReferenceVisitor';
import type { Table } from '../domain/table/Table';
import * as DotTeaParserPort from '../ports/DotTeaParser';
import * as EventBusPort from '../ports/EventBus';
import * as ExecutionContextPort from '../ports/ExecutionContext';
import { v2CoreTokens } from '../ports/tokens';
import { TraceSpan } from '../ports/TraceSpan';
import * as UnitOfWorkPort from '../ports/UnitOfWork';
import type { ITableFieldInput } from '../schemas/field';
import { CommandHandler, type ICommandHandler } from './CommandHandler';
import { ImportDotTeaStructureCommand } from './ImportDotTeaStructureCommand';
import { buildTableFromInput } from './TableInputParser';

const sequence = <T>(
  values: ReadonlyArray<Result<T, DomainError>>
): Result<ReadonlyArray<T>, DomainError> =>
  values.reduce<Result<ReadonlyArray<T>, DomainError>>(
    (acc, next) => acc.andThen((arr) => next.map((value) => [...arr, value])),
    ok([])
  );

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

const isInternalReference = (
  ref: LinkForeignTableReference,
  baseId: BaseId,
  internalTableIds: ReadonlySet<string>
): boolean => {
  if (ref.baseId && !ref.baseId.equals(baseId)) return false;
  return internalTableIds.has(ref.foreignTableId.toString());
};

const sortTablesByForeignDependencies = (
  tables: ReadonlyArray<Table>,
  referencesByTable: ReadonlyArray<ReadonlyArray<LinkForeignTableReference>>,
  baseId: BaseId,
  internalTableIds: ReadonlySet<string>
): ReadonlyArray<Table> => {
  const entries = tables.map((table, index) => ({
    table,
    id: table.id().toString(),
    references: referencesByTable[index] ?? [],
  }));
  const idToIndex = new Map(entries.map((entry, index) => [entry.id, index] as const));
  const dependents = entries.map(() => new Set<number>());
  const inDegree = entries.map(() => 0);

  entries.forEach((entry, index) => {
    for (const ref of entry.references) {
      if (!isInternalReference(ref, baseId, internalTableIds)) continue;
      const depIndex = idToIndex.get(ref.foreignTableId.toString());
      if (depIndex === undefined || depIndex === index) continue;
      if (dependents[depIndex]!.has(index)) continue;
      dependents[depIndex]!.add(index);
      inDegree[index]! += 1;
    }
  });

  const queue = entries
    .map((_, index) => (inDegree[index] === 0 ? index : -1))
    .filter((index) => index >= 0);
  const sorted: number[] = [];

  while (queue.length > 0) {
    const current = queue.shift()!;
    sorted.push(current);
    for (const dependent of dependents[current]!) {
      inDegree[dependent]!--;
      if (inDegree[dependent] === 0) {
        queue.push(dependent);
      }
    }
  }

  if (sorted.length !== entries.length) {
    return tables;
  }

  return sorted.map((index) => entries[index]!.table);
};

export class ImportDotTeaStructureResult {
  private constructor(
    readonly baseId: string,
    readonly tables: ReadonlyArray<{ id: string; name: string }>
  ) {}

  static create(baseId: string, tables: ReadonlyArray<Table>): ImportDotTeaStructureResult {
    return new ImportDotTeaStructureResult(
      baseId,
      tables.map((table) => ({
        id: table.id().toString(),
        name: table.name().toString(),
      }))
    );
  }
}

@CommandHandler(ImportDotTeaStructureCommand)
@injectable()
export class ImportDotTeaStructureHandler
  implements ICommandHandler<ImportDotTeaStructureCommand, ImportDotTeaStructureResult>
{
  constructor(
    @inject(v2CoreTokens.dotTeaParser)
    private readonly dotTeaParser: DotTeaParserPort.IDotTeaParser,
    @inject(v2CoreTokens.foreignTableLoaderService)
    private readonly foreignTableLoaderService: ForeignTableLoaderService,
    @inject(v2CoreTokens.tableCreationService)
    private readonly tableCreationService: TableCreationService,
    @inject(v2CoreTokens.eventBus)
    private readonly eventBus: EventBusPort.IEventBus,
    @inject(v2CoreTokens.unitOfWork)
    private readonly unitOfWork: UnitOfWorkPort.IUnitOfWork
  ) {}

  @TraceSpan()
  async handle(
    context: ExecutionContextPort.IExecutionContext,
    command: ImportDotTeaStructureCommand
  ): Promise<Result<ImportDotTeaStructureResult, DomainError>> {
    const handler = this;
    return safeTry<ImportDotTeaStructureResult, DomainError>(async function* () {
      // Use parseNormalizedStructure() which handles v1→v2 conversion in dottea package
      const normalized = yield* await handler.dotTeaParser.parseNormalizedStructure(command.source);
      if (normalized.tables.length === 0) {
        return err(
          domainError.validation({
            message: 'DotTea structure has no tables to import',
            code: 'dottea.no_tables',
          })
        );
      }

      // Build tables directly using TableInputParser (no CreateTableCommand dependency)
      const buildResults = yield* sequence(
        normalized.tables.map((table) =>
          buildTableFromInput({
            baseId: command.baseId.toString(),
            tableId: table.id,
            name: table.name,
            // Cast fields to ITableFieldInput[] - the normalized structure already has valid field types
            fields: table.fields.map((field) => ({
              id: field.id,
              type: field.type as ITableFieldInput['type'],
              name: field.name,
              isPrimary: field.isPrimary,
              notNull: field.notNull,
              unique: field.unique,
              options: field.options,
              config: field.config,
              cellValueType: field.cellValueType,
              isMultipleCellValue: field.isMultipleCellValue,
            })) as ITableFieldInput[],
            views: table.views?.map((view) => ({
              type: view.type,
              name: view.name,
            })),
          })
        )
      );

      // Extract tables and foreign references from build results
      const builtTables = buildResults.map((r) => r.table);
      const referencesByTable = buildResults.map((r) => r.foreignTableReferences);

      // Collect and filter foreign table references
      const allReferences = uniqueForeignTableReferences(referencesByTable.flat());
      const internalTableIds = new Set(builtTables.map((t) => t.id().toString()));
      const externalReferences = allReferences.filter(
        (ref) => !isInternalReference(ref, command.baseId, internalTableIds)
      );

      // Load external/foreign tables
      const externalTables = yield* await handler.foreignTableLoaderService.load(context, {
        baseId: command.baseId,
        references: externalReferences,
      });

      // Validate foreign tables for all fields
      const foreignTables = [...externalTables, ...builtTables];
      const tablesForValidation = sortTablesByForeignDependencies(
        builtTables,
        referencesByTable,
        command.baseId,
        internalTableIds
      );
      for (const table of tablesForValidation) {
        yield* validateForeignTablesForFields(table.getFields(), {
          hostTable: table,
          foreignTables,
        });
      }

      // Execute table creation using TableCreationService
      const transactionResult = yield* await handler.unitOfWork.withTransaction(
        context,
        async (transactionContext) => {
          return handler.tableCreationService.execute(transactionContext, {
            baseId: command.baseId,
            tables: builtTables,
            externalTables,
            referencesByTable,
          });
        }
      );

      // Build and publish events
      const hostEvents = builtTables.flatMap((table) => table.pullDomainEvents());
      const events = [...hostEvents, ...transactionResult.sideEffectEvents];
      yield* await handler.eventBus.publishMany(context, events);

      const resultTables = transactionResult.persistedTables.map(
        (table) => transactionResult.tableState.get(table.id().toString()) ?? table
      );

      return ok(ImportDotTeaStructureResult.create(command.baseId.toString(), resultTables));
    });
  }
}
