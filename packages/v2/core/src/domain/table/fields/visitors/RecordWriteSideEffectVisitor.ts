import { err, ok } from 'neverthrow';
import type { Result } from 'neverthrow';

import type { DomainError } from '../../../shared/DomainError';
import type { Table } from '../../Table';
import type { FieldId } from '../FieldId';
import type { AttachmentField } from '../types/AttachmentField';
import type { AutoNumberField } from '../types/AutoNumberField';
import type { ButtonField } from '../types/ButtonField';
import type { CheckboxField } from '../types/CheckboxField';
import type { ConditionalLookupField } from '../types/ConditionalLookupField';
import type { ConditionalRollupField } from '../types/ConditionalRollupField';
import type { CreatedByField } from '../types/CreatedByField';
import type { CreatedTimeField } from '../types/CreatedTimeField';
import type { DateField } from '../types/DateField';
import { FieldColor, fieldColorValues, type FieldColorValue } from '../types/FieldColor';
import type { FormulaField } from '../types/FormulaField';
import type { LastModifiedByField } from '../types/LastModifiedByField';
import type { LastModifiedTimeField } from '../types/LastModifiedTimeField';
import type { LinkField } from '../types/LinkField';
import type { LongTextField } from '../types/LongTextField';
import type { LookupField } from '../types/LookupField';
import type { MultipleSelectField } from '../types/MultipleSelectField';
import type { NumberField } from '../types/NumberField';
import type { RatingField } from '../types/RatingField';
import type { RollupField } from '../types/RollupField';
import { SelectOption } from '../types/SelectOption';
import { SelectOptionId } from '../types/SelectOptionId';
import type { SingleLineTextField } from '../types/SingleLineTextField';
import type { SingleSelectField } from '../types/SingleSelectField';
import type { UserField } from '../types/UserField';
import type { IFieldVisitor } from './IFieldVisitor';
import { normalizeCellDisplayValue, normalizeCellDisplayValues } from './normalizeCellDisplayValue';

export type RecordWriteSideEffect = {
  fieldId: FieldId;
  options: ReadonlyArray<SelectOption>;
};

export type RecordWriteSideEffects = ReadonlyArray<RecordWriteSideEffect>;

const normalizeSingleSelectValue = (value: unknown): string | null => {
  return normalizeCellDisplayValue(value);
};

const normalizeMultiSelectValues = (value: unknown): string[] => {
  return normalizeCellDisplayValues(value);
};

const randomColors = (exists: string[], num: number): FieldColorValue[] => {
  const allColors = [...fieldColorValues];
  const availableColors = allColors.filter((color) => !exists.includes(color));
  const result: FieldColorValue[] = [];

  for (let i = 0; i < num; i += 1) {
    const colorsToChooseFrom = availableColors.length > 0 ? availableColors : allColors;
    const randomIndex = Math.floor(Math.random() * colorsToChooseFrom.length);
    result.push(colorsToChooseFrom[randomIndex]!);
    if (availableColors.length > 0) {
      availableColors.splice(randomIndex, 1);
    }
  }

  return result;
};

export class RecordWriteSideEffectVisitor implements IFieldVisitor<RecordWriteSideEffects> {
  private constructor(
    private readonly recordFieldValues: ReadonlyArray<ReadonlyMap<string, unknown>>,
    private readonly typecast: boolean
  ) {}

  static collect(
    table: Table,
    recordFieldValues: ReadonlyArray<ReadonlyMap<string, unknown>>,
    typecast: boolean
  ): Result<RecordWriteSideEffects, DomainError> {
    if (!typecast) return ok([]);
    const visitor = new RecordWriteSideEffectVisitor(recordFieldValues, typecast);
    return table
      .getFields()
      .reduce<
        Result<RecordWriteSideEffects, DomainError>
      >((acc, field) => acc.andThen((effects) => field.accept(visitor).map((next) => [...effects, ...next])), ok([]));
  }

  visitSingleLineTextField(_: SingleLineTextField): Result<RecordWriteSideEffects, DomainError> {
    return ok([]);
  }

  visitLongTextField(_: LongTextField): Result<RecordWriteSideEffects, DomainError> {
    return ok([]);
  }

  visitNumberField(_: NumberField): Result<RecordWriteSideEffects, DomainError> {
    return ok([]);
  }

  visitRatingField(_: RatingField): Result<RecordWriteSideEffects, DomainError> {
    return ok([]);
  }

  visitFormulaField(_: FormulaField): Result<RecordWriteSideEffects, DomainError> {
    return ok([]);
  }

  visitRollupField(_: RollupField): Result<RecordWriteSideEffects, DomainError> {
    return ok([]);
  }

  visitSingleSelectField(field: SingleSelectField): Result<RecordWriteSideEffects, DomainError> {
    if (!this.typecast || field.preventAutoNewOptions().toBoolean()) return ok([]);

    const existingNames = new Set(field.selectOptions().map((option) => option.name().toString()));
    const names = new Set<string>();

    for (const fieldValues of this.recordFieldValues) {
      const candidate = normalizeSingleSelectValue(fieldValues.get(field.id().toString()));
      if (!candidate) continue;
      if (!existingNames.has(candidate)) {
        names.add(candidate);
      }
    }

    if (names.size === 0) return ok([]);
    return this.buildSelectOptions(field, names).map((options) => [
      {
        fieldId: field.id(),
        options,
      },
    ]);
  }

  visitMultipleSelectField(
    field: MultipleSelectField
  ): Result<RecordWriteSideEffects, DomainError> {
    if (!this.typecast || field.preventAutoNewOptions().toBoolean()) return ok([]);

    const existingNames = new Set(field.selectOptions().map((option) => option.name().toString()));
    const names = new Set<string>();

    for (const fieldValues of this.recordFieldValues) {
      const candidates = normalizeMultiSelectValues(fieldValues.get(field.id().toString()));
      for (const candidate of candidates) {
        if (!existingNames.has(candidate)) {
          names.add(candidate);
        }
      }
    }

    if (names.size === 0) return ok([]);
    return this.buildSelectOptions(field, names).map((options) => [
      {
        fieldId: field.id(),
        options,
      },
    ]);
  }

  visitCheckboxField(_: CheckboxField): Result<RecordWriteSideEffects, DomainError> {
    return ok([]);
  }

  visitAttachmentField(_: AttachmentField): Result<RecordWriteSideEffects, DomainError> {
    return ok([]);
  }

  visitDateField(_: DateField): Result<RecordWriteSideEffects, DomainError> {
    return ok([]);
  }

  visitCreatedTimeField(_: CreatedTimeField): Result<RecordWriteSideEffects, DomainError> {
    return ok([]);
  }

  visitLastModifiedTimeField(
    _: LastModifiedTimeField
  ): Result<RecordWriteSideEffects, DomainError> {
    return ok([]);
  }

  visitUserField(_: UserField): Result<RecordWriteSideEffects, DomainError> {
    return ok([]);
  }

  visitCreatedByField(_: CreatedByField): Result<RecordWriteSideEffects, DomainError> {
    return ok([]);
  }

  visitLastModifiedByField(_: LastModifiedByField): Result<RecordWriteSideEffects, DomainError> {
    return ok([]);
  }

  visitAutoNumberField(_: AutoNumberField): Result<RecordWriteSideEffects, DomainError> {
    return ok([]);
  }

  visitButtonField(_: ButtonField): Result<RecordWriteSideEffects, DomainError> {
    return ok([]);
  }

  visitLinkField(_: LinkField): Result<RecordWriteSideEffects, DomainError> {
    return ok([]);
  }

  visitLookupField(_: LookupField): Result<RecordWriteSideEffects, DomainError> {
    return ok([]);
  }

  visitConditionalRollupField(
    _: ConditionalRollupField
  ): Result<RecordWriteSideEffects, DomainError> {
    return ok([]);
  }

  visitConditionalLookupField(
    _: ConditionalLookupField
  ): Result<RecordWriteSideEffects, DomainError> {
    return ok([]);
  }

  private buildSelectOptions(
    field: SingleSelectField | MultipleSelectField,
    names: Set<string>
  ): Result<ReadonlyArray<SelectOption>, DomainError> {
    const orderedNames = [...names];
    if (orderedNames.length === 0) return ok([]);

    const existingColors = field.selectOptions().map((option) => option.color().toString());
    const colors = randomColors(existingColors, orderedNames.length);
    const newOptions: SelectOption[] = [];

    for (let index = 0; index < orderedNames.length; index += 1) {
      const name = orderedNames[index]!;
      const idResult = SelectOptionId.generate();
      if (idResult.isErr()) return err(idResult.error);
      const colorResult = FieldColor.create(colors[index]);
      if (colorResult.isErr()) return err(colorResult.error);
      const optionResult = SelectOption.create({
        id: idResult.value.toString(),
        name,
        color: colorResult.value.toString(),
      });
      if (optionResult.isErr()) return err(optionResult.error);
      newOptions.push(optionResult.value);
    }

    return ok(newOptions);
  }
}
