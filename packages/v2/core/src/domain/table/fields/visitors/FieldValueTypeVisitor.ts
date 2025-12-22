import { ok } from 'neverthrow';
import type { Result } from 'neverthrow';

import type { AttachmentField } from '../types/AttachmentField';
import type { ButtonField } from '../types/ButtonField';
import { CellValueMultiplicity } from '../types/CellValueMultiplicity';
import { CellValueType } from '../types/CellValueType';
import type { CheckboxField } from '../types/CheckboxField';
import type { DateField } from '../types/DateField';
import type { FormulaField } from '../types/FormulaField';
import type { LongTextField } from '../types/LongTextField';
import type { MultipleSelectField } from '../types/MultipleSelectField';
import type { NumberField } from '../types/NumberField';
import type { RatingField } from '../types/RatingField';
import type { SingleLineTextField } from '../types/SingleLineTextField';
import type { SingleSelectField } from '../types/SingleSelectField';
import type { UserField } from '../types/UserField';
import type { IFieldVisitor } from './IFieldVisitor';

export type FieldValueType = {
  cellValueType: CellValueType;
  isMultipleCellValue: CellValueMultiplicity;
};

export class FieldValueTypeVisitor implements IFieldVisitor<FieldValueType> {
  visitSingleLineTextField(_: SingleLineTextField): Result<FieldValueType, string> {
    return ok({
      cellValueType: CellValueType.string(),
      isMultipleCellValue: CellValueMultiplicity.single(),
    });
  }

  visitLongTextField(_: LongTextField): Result<FieldValueType, string> {
    return ok({
      cellValueType: CellValueType.string(),
      isMultipleCellValue: CellValueMultiplicity.single(),
    });
  }

  visitNumberField(_: NumberField): Result<FieldValueType, string> {
    return ok({
      cellValueType: CellValueType.number(),
      isMultipleCellValue: CellValueMultiplicity.single(),
    });
  }

  visitRatingField(_: RatingField): Result<FieldValueType, string> {
    return ok({
      cellValueType: CellValueType.number(),
      isMultipleCellValue: CellValueMultiplicity.single(),
    });
  }

  visitFormulaField(field: FormulaField): Result<FieldValueType, string> {
    return field
      .cellValueType()
      .andThen((cellValueType) =>
        field
          .isMultipleCellValue()
          .map((isMultipleCellValue) => ({ cellValueType, isMultipleCellValue }))
      );
  }

  visitSingleSelectField(_: SingleSelectField): Result<FieldValueType, string> {
    return ok({
      cellValueType: CellValueType.string(),
      isMultipleCellValue: CellValueMultiplicity.single(),
    });
  }

  visitMultipleSelectField(_: MultipleSelectField): Result<FieldValueType, string> {
    return ok({
      cellValueType: CellValueType.string(),
      isMultipleCellValue: CellValueMultiplicity.multiple(),
    });
  }

  visitCheckboxField(_: CheckboxField): Result<FieldValueType, string> {
    return ok({
      cellValueType: CellValueType.boolean(),
      isMultipleCellValue: CellValueMultiplicity.single(),
    });
  }

  visitAttachmentField(_: AttachmentField): Result<FieldValueType, string> {
    return ok({
      cellValueType: CellValueType.string(),
      isMultipleCellValue: CellValueMultiplicity.multiple(),
    });
  }

  visitDateField(_: DateField): Result<FieldValueType, string> {
    return ok({
      cellValueType: CellValueType.dateTime(),
      isMultipleCellValue: CellValueMultiplicity.single(),
    });
  }

  visitUserField(field: UserField): Result<FieldValueType, string> {
    const isMultiple = field.multiplicity().toBoolean();
    return ok({
      cellValueType: CellValueType.string(),
      isMultipleCellValue: isMultiple
        ? CellValueMultiplicity.multiple()
        : CellValueMultiplicity.single(),
    });
  }

  visitButtonField(_: ButtonField): Result<FieldValueType, string> {
    return ok({
      cellValueType: CellValueType.string(),
      isMultipleCellValue: CellValueMultiplicity.single(),
    });
  }
}
