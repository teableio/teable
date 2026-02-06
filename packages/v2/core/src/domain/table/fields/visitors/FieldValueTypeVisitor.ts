import { ok } from 'neverthrow';
import type { Result } from 'neverthrow';

import type { DomainError } from '../../../shared/DomainError';
import type { AttachmentField } from '../types/AttachmentField';
import type { AutoNumberField } from '../types/AutoNumberField';
import type { ButtonField } from '../types/ButtonField';
import { CellValueMultiplicity } from '../types/CellValueMultiplicity';
import { CellValueType } from '../types/CellValueType';
import type { CheckboxField } from '../types/CheckboxField';
import type { ConditionalLookupField } from '../types/ConditionalLookupField';
import type { ConditionalRollupField } from '../types/ConditionalRollupField';
import type { CreatedByField } from '../types/CreatedByField';
import type { CreatedTimeField } from '../types/CreatedTimeField';
import type { DateField } from '../types/DateField';
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
import type { SingleLineTextField } from '../types/SingleLineTextField';
import type { SingleSelectField } from '../types/SingleSelectField';
import type { UserField } from '../types/UserField';
import type { IFieldVisitor } from './IFieldVisitor';

export type FieldValueType = {
  cellValueType: CellValueType;
  isMultipleCellValue: CellValueMultiplicity;
};

export class FieldValueTypeVisitor implements IFieldVisitor<FieldValueType> {
  visitSingleLineTextField(_: SingleLineTextField): Result<FieldValueType, DomainError> {
    return ok({
      cellValueType: CellValueType.string(),
      isMultipleCellValue: CellValueMultiplicity.single(),
    });
  }

  visitLongTextField(_: LongTextField): Result<FieldValueType, DomainError> {
    return ok({
      cellValueType: CellValueType.string(),
      isMultipleCellValue: CellValueMultiplicity.single(),
    });
  }

  visitNumberField(_: NumberField): Result<FieldValueType, DomainError> {
    return ok({
      cellValueType: CellValueType.number(),
      isMultipleCellValue: CellValueMultiplicity.single(),
    });
  }

  visitRatingField(_: RatingField): Result<FieldValueType, DomainError> {
    return ok({
      cellValueType: CellValueType.number(),
      isMultipleCellValue: CellValueMultiplicity.single(),
    });
  }

  visitFormulaField(field: FormulaField): Result<FieldValueType, DomainError> {
    return field
      .cellValueType()
      .andThen((cellValueType) =>
        field
          .isMultipleCellValue()
          .map((isMultipleCellValue) => ({ cellValueType, isMultipleCellValue }))
      );
  }

  visitRollupField(field: RollupField): Result<FieldValueType, DomainError> {
    return field
      .cellValueType()
      .andThen((cellValueType) =>
        field
          .isMultipleCellValue()
          .map((isMultipleCellValue) => ({ cellValueType, isMultipleCellValue }))
      );
  }

  visitSingleSelectField(_: SingleSelectField): Result<FieldValueType, DomainError> {
    return ok({
      cellValueType: CellValueType.string(),
      isMultipleCellValue: CellValueMultiplicity.single(),
    });
  }

  visitMultipleSelectField(_: MultipleSelectField): Result<FieldValueType, DomainError> {
    return ok({
      cellValueType: CellValueType.string(),
      isMultipleCellValue: CellValueMultiplicity.multiple(),
    });
  }

  visitCheckboxField(_: CheckboxField): Result<FieldValueType, DomainError> {
    return ok({
      cellValueType: CellValueType.boolean(),
      isMultipleCellValue: CellValueMultiplicity.single(),
    });
  }

  visitAttachmentField(_: AttachmentField): Result<FieldValueType, DomainError> {
    return ok({
      cellValueType: CellValueType.string(),
      isMultipleCellValue: CellValueMultiplicity.multiple(),
    });
  }

  visitDateField(_: DateField): Result<FieldValueType, DomainError> {
    return ok({
      cellValueType: CellValueType.dateTime(),
      isMultipleCellValue: CellValueMultiplicity.single(),
    });
  }

  visitCreatedTimeField(_: CreatedTimeField): Result<FieldValueType, DomainError> {
    return ok({
      cellValueType: CellValueType.dateTime(),
      isMultipleCellValue: CellValueMultiplicity.single(),
    });
  }

  visitLastModifiedTimeField(_: LastModifiedTimeField): Result<FieldValueType, DomainError> {
    return ok({
      cellValueType: CellValueType.dateTime(),
      isMultipleCellValue: CellValueMultiplicity.single(),
    });
  }

  visitUserField(field: UserField): Result<FieldValueType, DomainError> {
    const isMultiple = field.multiplicity().toBoolean();
    return ok({
      cellValueType: CellValueType.string(),
      isMultipleCellValue: isMultiple
        ? CellValueMultiplicity.multiple()
        : CellValueMultiplicity.single(),
    });
  }

  visitCreatedByField(_: CreatedByField): Result<FieldValueType, DomainError> {
    return ok({
      cellValueType: CellValueType.string(),
      isMultipleCellValue: CellValueMultiplicity.single(),
    });
  }

  visitLastModifiedByField(_: LastModifiedByField): Result<FieldValueType, DomainError> {
    return ok({
      cellValueType: CellValueType.string(),
      isMultipleCellValue: CellValueMultiplicity.single(),
    });
  }

  visitAutoNumberField(_: AutoNumberField): Result<FieldValueType, DomainError> {
    return ok({
      cellValueType: CellValueType.number(),
      isMultipleCellValue: CellValueMultiplicity.single(),
    });
  }

  visitButtonField(_: ButtonField): Result<FieldValueType, DomainError> {
    return ok({
      cellValueType: CellValueType.string(),
      isMultipleCellValue: CellValueMultiplicity.single(),
    });
  }

  visitLinkField(field: LinkField): Result<FieldValueType, DomainError> {
    const isMultiple = field.isMultipleValue();
    return ok({
      cellValueType: CellValueType.string(),
      isMultipleCellValue: isMultiple
        ? CellValueMultiplicity.multiple()
        : CellValueMultiplicity.single(),
    });
  }

  /**
   * Lookup fields get cellValueType from inner field; multiplicity follows the lookup config.
   */
  visitLookupField(field: LookupField): Result<FieldValueType, DomainError> {
    // For pending lookup fields, default to string type
    if (field.isPending()) {
      return field.isMultipleCellValue().map((isMultipleCellValue) => ({
        cellValueType: CellValueType.string(),
        isMultipleCellValue,
      }));
    }

    // Get the inner field's cellValueType
    return field.innerField().andThen((inner) =>
      inner.accept(this).andThen((innerType: FieldValueType) =>
        field.isMultipleCellValue().map((isMultipleCellValue) => ({
          cellValueType: innerType.cellValueType,
          isMultipleCellValue,
        }))
      )
    );
  }

  /**
   * ConditionalRollup fields get cellValueType/multiplicity from the rollup expression result.
   */
  visitConditionalRollupField(field: ConditionalRollupField): Result<FieldValueType, DomainError> {
    return field
      .cellValueType()
      .andThen((cellValueType) =>
        field
          .isMultipleCellValue()
          .map((isMultipleCellValue) => ({ cellValueType, isMultipleCellValue }))
      );
  }

  /**
   * ConditionalLookup fields get cellValueType from inner field; multiplicity follows the config.
   */
  visitConditionalLookupField(field: ConditionalLookupField): Result<FieldValueType, DomainError> {
    // For pending conditional lookup fields, default to string type
    if (field.isPending()) {
      return field.isMultipleCellValue().map((isMultipleCellValue) => ({
        cellValueType: CellValueType.string(),
        isMultipleCellValue,
      }));
    }

    // Get the inner field's cellValueType
    return field.innerField().andThen((inner) =>
      inner.accept(this).andThen((innerType: FieldValueType) =>
        field.isMultipleCellValue().map((isMultipleCellValue) => ({
          cellValueType: innerType.cellValueType,
          isMultipleCellValue,
        }))
      )
    );
  }
}
