import { inject, injectable } from '@teable/v2-di';
import { err, ok, safeTry } from 'neverthrow';
import type { Result } from 'neverthrow';

import { domainError, type DomainError } from '../../domain/shared/DomainError';
import type { IDomainEvent } from '../../domain/shared/DomainEvent';
import type { Field } from '../../domain/table/fields/Field';
import { FieldDeletionSideEffectVisitor } from '../../domain/table/fields/visitors/FieldDeletionSideEffectVisitor';
import type { Table } from '../../domain/table/Table';
import { TableUpdateResult } from '../../domain/table/TableMutator';
import * as ExecutionContextPort from '../../ports/ExecutionContext';
import { v2CoreTokens } from '../../ports/tokens';
import { TraceSpan } from '../../ports/TraceSpan';
import { TableUpdateFlow } from './TableUpdateFlow';

export type FieldDeletionSideEffectServiceInput = {
  table: Table;
  fields: ReadonlyArray<Field>;
  foreignTables: ReadonlyArray<Table>;
};

@injectable()
// Application service: coordinates repositories and update flow for cross-table deletion side effects.
// Domain logic lives in visitors/specs; this class only orchestrates persistence and events.
export class FieldDeletionSideEffectService {
  constructor(
    @inject(v2CoreTokens.tableUpdateFlow)
    private readonly tableUpdateFlow: TableUpdateFlow
  ) {}

  @TraceSpan()
  async execute(
    context: ExecutionContextPort.IExecutionContext,
    input: FieldDeletionSideEffectServiceInput
  ): Promise<Result<ReadonlyArray<IDomainEvent>, DomainError>> {
    const service = this;
    const result = await safeTry<ReadonlyArray<IDomainEvent>, DomainError>(async function* () {
      if (input.fields.length === 0) return ok([]);

      const sideEffects = yield* FieldDeletionSideEffectVisitor.collect(input.fields, {
        table: input.table,
        foreignTables: input.foreignTables,
      });
      if (sideEffects.length === 0) return ok([]);

      const foreignTableState = new Map<string, Table>(
        input.foreignTables.map((foreignTable) => [foreignTable.id().toString(), foreignTable])
      );
      const events: IDomainEvent[] = [];

      for (const sideEffect of sideEffects) {
        const foreignTable = foreignTableState.get(sideEffect.foreignTable.id().toString());
        if (!foreignTable)
          return err(domainError.notFound({ message: 'Foreign table not found in state' }));

        const updateResult = yield* await service.tableUpdateFlow.execute(
          context,
          { table: foreignTable },
          (candidate) =>
            sideEffect.mutateSpec
              .mutate(candidate)
              .map((updated) => TableUpdateResult.create(updated, sideEffect.mutateSpec)),
          { publishEvents: false }
        );
        foreignTableState.set(updateResult.table.id().toString(), updateResult.table);
        events.push(...updateResult.events);
      }

      return ok(events);
    });
    return result;
  }
}
