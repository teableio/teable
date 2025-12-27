import { inject, injectable } from '@teable/v2-di';
import { err, ok, safeTry } from 'neverthrow';
import type { Result } from 'neverthrow';

import type { IDomainEvent } from '../../domain/shared/DomainEvent';
import type { Field } from '../../domain/table/fields/Field';
import { FieldCreationSideEffectVisitor } from '../../domain/table/fields/visitors/FieldCreationSideEffectVisitor';
import { FieldForeignTableValidationVisitor } from '../../domain/table/fields/visitors/FieldForeignTableValidationVisitor';
import { LinkForeignTableReferenceVisitor } from '../../domain/table/fields/visitors/LinkForeignTableReferenceVisitor';
import type { Table } from '../../domain/table/Table';
import { Table as TableAggregate } from '../../domain/table/Table';
import { TableUpdateResult } from '../../domain/table/TableMutator';
import type { IExecutionContext } from '../../ports/ExecutionContext';
import * as TableRepositoryPort from '../../ports/TableRepository';
import { v2CoreTokens } from '../../ports/tokens';
import { TraceSpan } from '../../ports/TraceSpan';
import { TableUpdateFlow } from './TableUpdateFlow';

export type FieldCreationSideEffectServiceInput = {
  context: IExecutionContext;
  table: Table;
  fields: ReadonlyArray<Field>;
};

@injectable()
// Application service: coordinates repositories and update flow for cross-table side effects.
// Domain logic lives in visitors/specs; this class only orchestrates persistence and events.
export class FieldCreationSideEffectService {
  constructor(
    @inject(v2CoreTokens.tableRepository)
    private readonly tableRepository: TableRepositoryPort.ITableRepository,
    @inject(v2CoreTokens.tableUpdateFlow)
    private readonly tableUpdateFlow: TableUpdateFlow
  ) {}

  @TraceSpan()
  async execute(
    input: FieldCreationSideEffectServiceInput
  ): Promise<Result<ReadonlyArray<IDomainEvent>, string>> {
    const tableUpdateFlow = this.tableUpdateFlow;
    const loadForeignTables = this.loadForeignTables.bind(this);
    const result = await safeTry<ReadonlyArray<IDomainEvent>, string>(async function* () {
      if (input.fields.length === 0) return ok([]);

      const foreignTables = yield* await loadForeignTables(input);
      if (foreignTables.length === 0) return ok([]);

      yield* FieldForeignTableValidationVisitor.validate(input.fields, {
        table: input.table,
        foreignTables,
      });

      const sideEffects = yield* FieldCreationSideEffectVisitor.collect(input.fields, {
        table: input.table,
        foreignTables,
      });
      if (sideEffects.length === 0) return ok([]);

      const foreignTableState = new Map<string, Table>(
        foreignTables.map((foreignTable) => [foreignTable.id().toString(), foreignTable])
      );
      const events: IDomainEvent[] = [];

      for (const sideEffect of sideEffects) {
        const foreignTable = foreignTableState.get(sideEffect.foreignTable.id().toString());
        if (!foreignTable) return err('Foreign table not found in state');

        const updateResult = yield* await tableUpdateFlow.execute(
          input.context,
          { table: foreignTable },
          (candidate) =>
            sideEffect.mutateSpec
              .mutate(candidate)
              .map((updated) => TableUpdateResult.create(updated, sideEffect.mutateSpec)),
          { deferPublish: true }
        );
        foreignTableState.set(updateResult.table.id().toString(), updateResult.table);
        events.push(...updateResult.events);
      }

      return ok(events);
    });
    return result;
  }

  private async loadForeignTables(
    input: FieldCreationSideEffectServiceInput
  ): Promise<Result<ReadonlyArray<Table>, string>> {
    const tableRepository = this.tableRepository;
    const result = await safeTry<ReadonlyArray<Table>, string>(async function* () {
      const references = yield* new LinkForeignTableReferenceVisitor().collect(input.fields);
      if (references.length === 0) return ok([]);

      const foreignTableSpec = yield* TableAggregate.specs(input.table.baseId())
        .withoutBaseId()
        .byIds(references.map((reference) => reference.foreignTableId))
        .build();

      const foreignTables = yield* await tableRepository.find(input.context, foreignTableSpec);

      const foreignTablesById = new Map(
        foreignTables.map((table) => [table.id().toString(), table] as const)
      );
      const missing = references.filter(
        (reference) => !foreignTablesById.has(reference.foreignTableId.toString())
      );
      if (missing.length > 0) return err('Foreign tables not found');

      return ok(foreignTables);
    });
    return result;
  }
}
