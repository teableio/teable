import { injectable } from '@teable/v2-di';
import { err, ok } from 'neverthrow';
import type { Result } from 'neverthrow';

import type { DomainError } from '../../domain/shared/DomainError';
import {
  RecordWriteSideEffectVisitor,
  type RecordWriteSideEffects,
} from '../../domain/table/fields/visitors/RecordWriteSideEffectVisitor';
import type { Table } from '../../domain/table/Table';
import type { TableUpdateResult } from '../../domain/table/TableMutator';
import type { IExecutionContext } from '../../ports/ExecutionContext';
import { getDomainContext } from '../../ports/ExecutionContext';

export type RecordWriteSideEffectResult = {
  table: Table;
  effects: RecordWriteSideEffects;
  updateResult?: TableUpdateResult;
};

@injectable()
export class RecordWriteSideEffectService {
  execute(
    context: IExecutionContext,
    table: Table,
    recordFieldValues: ReadonlyArray<ReadonlyMap<string, unknown>>,
    typecast: boolean
  ): Result<RecordWriteSideEffectResult, DomainError> {
    if (!typecast) return ok({ table, effects: [] });

    const effectsResult = RecordWriteSideEffectVisitor.collect(table, recordFieldValues, typecast);
    if (effectsResult.isErr()) return err(effectsResult.error);
    const effects = effectsResult.value;
    if (effects.length === 0) return ok({ table, effects });

    const updateResult = table.update((mutator) => {
      const domainContext = getDomainContext(context);
      let next = mutator;
      for (const effect of effects) {
        next = next.addSelectOptions(effect.fieldId, effect.options, domainContext);
      }
      return next;
    });
    if (updateResult.isErr()) return err(updateResult.error);

    return ok({ table: updateResult.value.table, effects, updateResult: updateResult.value });
  }
}
