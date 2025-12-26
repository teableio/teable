import { inject, injectable } from '@teable/v2-di';
import { err, ok, safeTry } from 'neverthrow';
import type { Result } from 'neverthrow';

import type { BaseId } from '../../domain/base/BaseId';
import type { IDomainEvent } from '../../domain/shared/DomainEvent';
import type { ISpecification } from '../../domain/shared/specification/ISpecification';
import type { Field } from '../../domain/table/fields/Field';
import { FieldCreationSideEffectVisitor } from '../../domain/table/fields/visitors/FieldCreationSideEffectVisitor';
import {
  LinkForeignTableReferenceVisitor,
  type LinkForeignTableReference,
} from '../../domain/table/fields/visitors/LinkForeignTableReferenceVisitor';
import type { ITableSpecVisitor } from '../../domain/table/specs/ITableSpecVisitor';
import type { Table } from '../../domain/table/Table';
import { Table as TableAggregate } from '../../domain/table/Table';
import { TableUpdateResult } from '../../domain/table/TableMutator';
import type { IExecutionContext } from '../../ports/ExecutionContext';
import * as TableRepositoryPort from '../../ports/TableRepository';
import { v2CoreTokens } from '../../ports/tokens';
import { TableUpdateFlow } from './TableUpdateFlow';

export type FieldCreationSideEffectFlowInput = {
  context: IExecutionContext;
  baseId: BaseId;
  table: Table;
  fields: ReadonlyArray<Field>;
};

@injectable()
// Application service: coordinates repositories and update flow for cross-table side effects.
// Domain logic lives in visitors/specs; this class only orchestrates persistence and events.
export class FieldCreationSideEffectFlow {
  constructor(
    @inject(v2CoreTokens.tableRepository)
    private readonly tableRepository: TableRepositoryPort.ITableRepository,
    @inject(v2CoreTokens.tableUpdateFlow)
    private readonly tableUpdateFlow: TableUpdateFlow
  ) {}

  async execute(
    input: FieldCreationSideEffectFlowInput
  ): Promise<Result<ReadonlyArray<IDomainEvent>, string>> {
    const tableRepository = this.tableRepository;
    const tableUpdateFlow = this.tableUpdateFlow;
    const buildForeignTableSpec = this.buildForeignTableSpec.bind(this);
    const result = await safeTry<ReadonlyArray<IDomainEvent>, string>(async function* () {
      if (input.fields.length === 0) return ok([]);

      const references = yield* new LinkForeignTableReferenceVisitor().collect(input.fields);
      if (references.length === 0) return ok([]);

      const foreignTableSpec = yield* buildForeignTableSpec(input.baseId, references);
      const foreignTables = yield* await tableRepository.find(input.context, foreignTableSpec);
      const foreignTablesById = new Map<string, Table>();
      for (const foreignTable of foreignTables) {
        foreignTablesById.set(foreignTable.id().toString(), foreignTable);
      }
      const missing = references.filter(
        (reference) => !foreignTablesById.has(reference.foreignTableId.toString())
      );
      if (missing.length > 0) return err('Foreign tables not found');

      const sideEffects = yield* FieldCreationSideEffectVisitor.collect(input.fields, {
        table: input.table,
        foreignTables,
      });
      if (sideEffects.length === 0) return ok([]);

      const foreignTableState = new Map<string, Table>(foreignTablesById);
      const events: IDomainEvent[] = [];

      for (const sideEffect of sideEffects) {
        const foreignTable = foreignTableState.get(sideEffect.foreignTableId.toString());
        if (!foreignTable) return err('Foreign table not found');

        const updateResult = yield* await tableUpdateFlow.execute(
          input.context,
          { table: foreignTable },
          (candidate) =>
            sideEffect.mutateSpec
              .mutate(candidate)
              .map((updated) => TableUpdateResult.create(updated, sideEffect.mutateSpec)),
          undefined,
          { deferPublish: true }
        );
        foreignTableState.set(updateResult.table.id().toString(), updateResult.table);
        events.push(...updateResult.events);
      }

      return ok(events);
    });
    return result;
  }

  private buildForeignTableSpec(
    baseId: BaseId,
    references: ReadonlyArray<LinkForeignTableReference>
  ): Result<ISpecification<Table, ITableSpecVisitor>, string> {
    const ids = references.map((reference) => reference.foreignTableId);
    return TableAggregate.specs(baseId).withoutBaseId().byIds(ids).build();
  }
}
