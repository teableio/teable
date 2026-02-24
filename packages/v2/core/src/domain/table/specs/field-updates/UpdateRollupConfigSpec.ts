import { err, ok } from 'neverthrow';
import type { Result } from 'neverthrow';

import { domainError, type DomainError } from '../../../shared/DomainError';
import { MutateOnlySpec } from '../../../shared/specification/MutateOnlySpec';
import type { FieldId } from '../../fields/FieldId';
import { RollupField } from '../../fields/types/RollupField';
import type { RollupFieldConfig } from '../../fields/types/RollupFieldConfig';
import type { Table } from '../../Table';
import type { ITableSpecVisitor } from '../ITableSpecVisitor';

/**
 * Specification for updating a rollup field's configuration.
 */
export class UpdateRollupConfigSpec<
  V extends ITableSpecVisitor = ITableSpecVisitor,
> extends MutateOnlySpec<Table, V> {
  private constructor(
    private readonly fieldIdValue: FieldId,
    private readonly previousConfigValue: RollupFieldConfig,
    private readonly nextConfigValue: RollupFieldConfig
  ) {
    super();
  }

  static create(
    fieldId: FieldId,
    previousConfig: RollupFieldConfig,
    nextConfig: RollupFieldConfig
  ): UpdateRollupConfigSpec {
    return new UpdateRollupConfigSpec(fieldId, previousConfig, nextConfig);
  }

  fieldId(): FieldId {
    return this.fieldIdValue;
  }

  previousConfig(): RollupFieldConfig {
    return this.previousConfigValue;
  }

  nextConfig(): RollupFieldConfig {
    return this.nextConfigValue;
  }

  mutate(t: Table): Result<Table, DomainError> {
    const fieldResult = t.getField((f) => f.id().equals(this.fieldIdValue));
    if (fieldResult.isErr()) return err(fieldResult.error);

    const field = fieldResult.value;
    if (!(field instanceof RollupField)) {
      return err(domainError.validation({ message: 'Field is not a rollup field' }));
    }

    const cellValueTypeResult = field.cellValueType();
    const isMultipleResult = field.isMultipleCellValue();
    const resultType =
      cellValueTypeResult.isOk() && isMultipleResult.isOk()
        ? {
            cellValueType: cellValueTypeResult.value,
            isMultipleCellValue: isMultipleResult.value,
          }
        : undefined;

    const updatedFieldResult = RollupField.createPending({
      id: field.id(),
      name: field.name(),
      config: this.nextConfigValue,
      expression: field.expression(),
      timeZone: field.timeZone(),
      formatting: field.formatting(),
      showAs: field.showAs(),
      resultType,
    });
    if (updatedFieldResult.isErr()) return err(updatedFieldResult.error);

    return t.replaceField(this.fieldIdValue, updatedFieldResult.value);
  }

  accept(v: V): Result<void, DomainError> {
    return v.visitUpdateRollupConfig(this).map(() => undefined);
  }
}
