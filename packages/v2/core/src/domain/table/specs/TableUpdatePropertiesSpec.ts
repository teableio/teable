import type { Result } from 'neverthrow';

import type { DomainError } from '../../shared/DomainError';
import { MutateOnlySpec } from '../../shared/specification/MutateOnlySpec';
import type { Table } from '../Table';
import type { TableProperties, TablePropertiesPatch } from '../TableProperties';
import type { ITableSpecVisitor } from './ITableSpecVisitor';

export class TableUpdatePropertiesSpec<
  V extends ITableSpecVisitor = ITableSpecVisitor,
> extends MutateOnlySpec<Table, V> {
  private constructor(
    private readonly previousPropertiesValue: TableProperties,
    private readonly nextPropertiesValue: TableProperties,
    private readonly patchValue: TablePropertiesPatch
  ) {
    super();
  }

  static create(
    previousProperties: TableProperties,
    nextProperties: TableProperties,
    patch: TablePropertiesPatch
  ): TableUpdatePropertiesSpec {
    return new TableUpdatePropertiesSpec(previousProperties, nextProperties, patch);
  }

  previousProperties(): TableProperties {
    return this.previousPropertiesValue;
  }

  nextProperties(): TableProperties {
    return this.nextPropertiesValue;
  }

  patch(): TablePropertiesPatch {
    return { ...this.patchValue };
  }

  mutate(table: Table): Result<Table, DomainError> {
    return table.updateProperties(this.patchValue);
  }

  accept(visitor: V): Result<void, DomainError> {
    return visitor.visitTableUpdateProperties(this).map(() => undefined);
  }
}
