import { err, ok } from 'neverthrow';
import type { Result } from 'neverthrow';

import { domainError, type DomainError } from '../../../shared/DomainError';
import { MutateOnlySpec } from '../../../shared/specification/MutateOnlySpec';
import type { FieldId } from '../../fields/FieldId';
import { FormulaField, type FormulaFormatting } from '../../fields/types/FormulaField';
import type { Table } from '../../Table';
import type { ITableSpecVisitor } from '../ITableSpecVisitor';

/**
 * Specification for updating a formula field's formatting.
 */
export class UpdateFormulaFormattingSpec<
  V extends ITableSpecVisitor = ITableSpecVisitor,
> extends MutateOnlySpec<Table, V> {
  private constructor(
    private readonly fieldIdValue: FieldId,
    private readonly previousFormattingValue: FormulaFormatting | undefined,
    private readonly nextFormattingValue: FormulaFormatting | undefined
  ) {
    super();
  }

  static create(
    fieldId: FieldId,
    previousFormatting: FormulaFormatting | undefined,
    nextFormatting: FormulaFormatting | undefined
  ): UpdateFormulaFormattingSpec {
    return new UpdateFormulaFormattingSpec(fieldId, previousFormatting, nextFormatting);
  }

  fieldId(): FieldId {
    return this.fieldIdValue;
  }

  previousFormatting(): FormulaFormatting | undefined {
    return this.previousFormattingValue;
  }

  nextFormatting(): FormulaFormatting | undefined {
    return this.nextFormattingValue;
  }

  mutate(t: Table): Result<Table, DomainError> {
    const fieldResult = t.getField((f) => f.id().equals(this.fieldIdValue));
    if (fieldResult.isErr()) return err(fieldResult.error);

    const field = fieldResult.value;
    if (!(field instanceof FormulaField)) {
      return err(domainError.validation({ message: 'Field is not a formula field' }));
    }

    const cellValueType = field.cellValueType();
    const isMultipleCellValue = field.isMultipleCellValue();
    if (cellValueType.isErr() || isMultipleCellValue.isErr()) {
      return err(domainError.validation({ message: 'Formula field result type not set' }));
    }

    const updatedFieldResult = FormulaField.create({
      id: field.id(),
      name: field.name(),
      expression: field.expression(),
      timeZone: field.timeZone(),
      formatting: this.nextFormattingValue,
      showAs: field.showAs(),
      meta: field.meta(),
      resultType: {
        cellValueType: cellValueType.value,
        isMultipleCellValue: isMultipleCellValue.value,
      },
      dependencies: field.dependencies(),
    });
    if (updatedFieldResult.isErr()) return err(updatedFieldResult.error);

    return t.replaceField(this.fieldIdValue, updatedFieldResult.value);
  }

  accept(v: V): Result<void, DomainError> {
    return v.visitUpdateFormulaFormatting(this).map(() => undefined);
  }
}
