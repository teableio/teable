import { injectable } from '@teable/v2-di';
import { err, ok } from 'neverthrow';
import type { Result } from 'neverthrow';

import { type DomainError } from '../../domain/shared/DomainError';
import { FieldType } from '../../domain/table/fields/FieldType';
import type { MultipleSelectField } from '../../domain/table/fields/types/MultipleSelectField';
import type { SelectOption } from '../../domain/table/fields/types/SelectOption';
import {
  ensureSelectFieldOptionNameWithinLimit,
  resolveMaxSelectChoices,
  selectFieldOptionCountExceededError,
} from '../../domain/table/fields/types/SelectFieldOptionWriteConfig';
import type { SingleSelectField } from '../../domain/table/fields/types/SingleSelectField';
import {
  RecordWriteSideEffectVisitor,
  type RecordWriteSideEffect,
  type RecordWriteSideEffects,
} from '../../domain/table/fields/visitors/RecordWriteSideEffectVisitor';
import {
  normalizeCellDisplayValue,
  normalizeCellDisplayValues,
} from '../../domain/table/fields/visitors/normalizeCellDisplayValue';
import type { Table } from '../../domain/table/Table';
import type { TableUpdateResult } from '../../domain/table/TableMutator';
import type { IExecutionContext } from '../../ports/ExecutionContext';
import { getDomainContext } from '../../ports/ExecutionContext';

export type RecordWriteSideEffectResult = {
  table: Table;
  effects: RecordWriteSideEffects;
  updateResult?: TableUpdateResult;
};

type IsolatedSelectNames = Map<string, Set<string>>;

const mutableFieldValues = (
  record: ReadonlyMap<string, unknown>
): Map<string, unknown> | undefined => (record instanceof Map ? record : undefined);

const hasRemainingFieldValues = (
  recordFieldValues: ReadonlyArray<ReadonlyMap<string, unknown>>
): boolean => recordFieldValues.some((record) => record.size > 0);

const selectOptionCount = (field: SingleSelectField | MultipleSelectField): number =>
  field.selectOptions().length;

const rejectName = (rejectedNamesByFieldId: IsolatedSelectNames, fieldId: string, name: string) => {
  const rejected = rejectedNamesByFieldId.get(fieldId) ?? new Set<string>();
  rejected.add(name);
  rejectedNamesByFieldId.set(fieldId, rejected);
};

const stripRejectedSelectValues = (
  table: Table,
  recordFieldValues: ReadonlyArray<ReadonlyMap<string, unknown>>,
  rejectedNamesByFieldId: IsolatedSelectNames
): void => {
  if (rejectedNamesByFieldId.size === 0) return;

  for (const record of recordFieldValues) {
    const mutable = mutableFieldValues(record);
    if (!mutable) continue;

    for (const [fieldId, value] of [...mutable.entries()]) {
      const rejectedNames = rejectedNamesByFieldId.get(fieldId);
      if (!rejectedNames || rejectedNames.size === 0) continue;

      const fieldResult = table.getField((field) => field.id().toString() === fieldId);
      if (fieldResult.isErr()) continue;
      const fieldType = fieldResult.value.type();

      if (fieldType.equals(FieldType.singleSelect())) {
        const name = normalizeCellDisplayValue(value);
        if (name && rejectedNames.has(name)) {
          mutable.delete(fieldId);
        }
        continue;
      }

      if (!fieldType.equals(FieldType.multipleSelect())) continue;

      const names = normalizeCellDisplayValues(value);
      const kept = names.filter((name) => !rejectedNames.has(name));
      if (kept.length === names.length) continue;
      if (kept.length === 0) {
        mutable.delete(fieldId);
        continue;
      }
      mutable.set(fieldId, Array.isArray(value) ? kept : kept.join(', '));
    }
  }
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

    const domainContext = getDomainContext(context);
    const accepted: RecordWriteSideEffect[] = [];
    const rejectedNamesByFieldId: IsolatedSelectNames = new Map();
    const maxChoices = resolveMaxSelectChoices(domainContext);
    let countOverflowError: DomainError | undefined;
    let nameOverflowError: DomainError | undefined;

    for (const effect of effects) {
      const fieldResult = table.getField((field) => field.id().equals(effect.fieldId));
      if (fieldResult.isErr()) return err(fieldResult.error);
      const field = fieldResult.value as SingleSelectField | MultipleSelectField;
      const remaining = Math.max(0, maxChoices - selectOptionCount(field));
      const acceptedOptions: SelectOption[] = [];

      for (const option of effect.options) {
        const name = option.name().toString();
        const nameLimit = ensureSelectFieldOptionNameWithinLimit(name.length, domainContext);
        if (nameLimit.isErr()) {
          nameOverflowError = nameOverflowError ?? nameLimit.error;
          rejectName(rejectedNamesByFieldId, effect.fieldId.toString(), name);
          continue;
        }
        if (acceptedOptions.length >= remaining) {
          countOverflowError =
            countOverflowError ?? selectFieldOptionCountExceededError(maxChoices);
          rejectName(rejectedNamesByFieldId, effect.fieldId.toString(), name);
          continue;
        }
        acceptedOptions.push(option);
      }

      if (acceptedOptions.length > 0) {
        accepted.push({ fieldId: effect.fieldId, options: acceptedOptions });
      }
    }

    stripRejectedSelectValues(table, recordFieldValues, rejectedNamesByFieldId);

    if (
      accepted.length === 0 &&
      rejectedNamesByFieldId.size > 0 &&
      !hasRemainingFieldValues(recordFieldValues)
    ) {
      return err(
        countOverflowError ?? nameOverflowError ?? selectFieldOptionCountExceededError(maxChoices)
      );
    }

    if (accepted.length === 0) {
      return ok({ table, effects: [] });
    }

    const updateResult = table.update((mutator) => {
      let next = mutator;
      for (const effect of accepted) {
        next = next.addSelectOptions(effect.fieldId, effect.options, domainContext);
      }
      return next;
    });
    if (updateResult.isErr()) return err(updateResult.error);

    return ok({
      table: updateResult.value.table,
      effects: accepted,
      updateResult: updateResult.value,
    });
  }
}
