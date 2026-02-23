import type { Result } from 'neverthrow';

import type { DomainError } from '../../shared/DomainError';
import { MutateOnlySpec } from '../../shared/specification/MutateOnlySpec';
import type { FieldId } from '../fields/FieldId';
import type { Table } from '../Table';
import type { ITableSpecVisitor } from './ITableSpecVisitor';

export class TableUpdateFieldDescriptionSpec<
  V extends ITableSpecVisitor = ITableSpecVisitor,
> extends MutateOnlySpec<Table, V> {
  private constructor(
    private readonly fieldIdValue: FieldId,
    private readonly previousDescriptionValue: string | null,
    private readonly nextDescriptionValue: string | null
  ) {
    super();
  }

  static create(
    fieldId: FieldId,
    previousDescription: string | null,
    nextDescription: string | null
  ): TableUpdateFieldDescriptionSpec {
    return new TableUpdateFieldDescriptionSpec(fieldId, previousDescription, nextDescription);
  }

  fieldId(): FieldId {
    return this.fieldIdValue;
  }

  nextDescription(): string | null {
    return this.nextDescriptionValue;
  }

  previousDescription(): string | null {
    return this.previousDescriptionValue;
  }

  mutate(t: Table): Result<Table, DomainError> {
    return t.updateFieldDescription(this.fieldIdValue, this.nextDescriptionValue);
  }

  accept(v: V): Result<void, DomainError> {
    return v.visitTableUpdateFieldDescription(this).map(() => undefined);
  }
}
