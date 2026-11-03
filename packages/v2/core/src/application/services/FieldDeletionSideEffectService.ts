import { inject, injectable } from '@teable/v2-di';
import { err, ok, safeTry } from 'neverthrow';
import type { Result } from 'neverthrow';

import { domainError, type DomainError } from '../../domain/shared/DomainError';
import type { IDomainEvent } from '../../domain/shared/DomainEvent';
import type { Field } from '../../domain/table/fields/Field';
import {
  FieldDeletionSideEffectVisitor,
  type FieldDeletionSideEffect,
} from '../../domain/table/fields/visitors/FieldDeletionSideEffectVisitor';
import { TableRemoveFieldSpec } from '../../domain/table/specs/TableRemoveFieldSpec';
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

export type PreparedFieldDeletionSideEffect = FieldDeletionSideEffect & {
  readonly deletedField?: Field;
};

/** Read-only domain facts collected before any cross-table persistence occurs. */
export type FieldDeletionSideEffectPreparation = {
  readonly sideEffects: ReadonlyArray<PreparedFieldDeletionSideEffect>;
};

export type AppliedFieldDeletionSideEffect = {
  deletedField: Field;
  previousTable: Table;
  table: Table;
};

export type FieldDeletionSideEffectServiceResult = {
  events: ReadonlyArray<IDomainEvent>;
  appliedDeletions: ReadonlyArray<AppliedFieldDeletionSideEffect>;
};

@injectable()
// Application service: exposes pure side-effect preparation, then coordinates the prepared
// cross-table updates. Domain decisions remain in visitors/specs.
export class FieldDeletionSideEffectService {
  constructor(
    @inject(v2CoreTokens.tableUpdateFlow)
    private readonly tableUpdateFlow: TableUpdateFlow
  ) {}

  static prepare(
    input: FieldDeletionSideEffectServiceInput
  ): Result<FieldDeletionSideEffectPreparation, DomainError> {
    if (input.fields.length === 0) {
      return ok({ sideEffects: [] });
    }

    return FieldDeletionSideEffectVisitor.collect(input.fields, {
      table: input.table,
      foreignTables: input.foreignTables,
    }).map((sideEffects) => ({
      sideEffects: sideEffects.map((sideEffect) => ({
        ...sideEffect,
        ...(sideEffect.mutateSpec instanceof TableRemoveFieldSpec
          ? { deletedField: sideEffect.mutateSpec.field() }
          : {}),
      })),
    }));
  }

  prepare(
    input: FieldDeletionSideEffectServiceInput
  ): Result<FieldDeletionSideEffectPreparation, DomainError> {
    return FieldDeletionSideEffectService.prepare(input);
  }

  @TraceSpan()
  async execute(
    context: ExecutionContextPort.IExecutionContext,
    input: FieldDeletionSideEffectServiceInput,
    preparation?: FieldDeletionSideEffectPreparation
  ): Promise<Result<FieldDeletionSideEffectServiceResult, DomainError>> {
    const service = this; // NOSONAR typescript:S7740 -- generator functions cannot be arrow functions, so `this` must be captured
    const result = await safeTry<FieldDeletionSideEffectServiceResult, DomainError>(
      async function* () {
        const prepared = yield* preparation ? ok(preparation) : service.prepare(input);
        if (prepared.sideEffects.length === 0) {
          return ok({ events: [], appliedDeletions: [] });
        }

        const foreignTableState = new Map<string, Table>(
          input.foreignTables.map((foreignTable) => [foreignTable.id().toString(), foreignTable])
        );
        // A self-referencing link's foreign table is the source table itself. Start that entry
        // from the already-updated aggregate so removing its symmetric field cannot restore the
        // directly deleted field from the pre-delete loader snapshot.
        foreignTableState.set(input.table.id().toString(), input.table);
        const events: IDomainEvent[] = [];
        const appliedDeletions: AppliedFieldDeletionSideEffect[] = [];

        for (const sideEffect of prepared.sideEffects) {
          const foreignTable = foreignTableState.get(sideEffect.foreignTable.id().toString());
          if (!foreignTable)
            return err(domainError.notFound({ message: 'Foreign table not found in state' }));

          const previousTable = foreignTable;
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

          if (sideEffect.deletedField) {
            appliedDeletions.push({
              deletedField: sideEffect.deletedField,
              previousTable,
              table: updateResult.table,
            });
          }
        }

        return ok({ events, appliedDeletions });
      }
    );
    return result;
  }
}
