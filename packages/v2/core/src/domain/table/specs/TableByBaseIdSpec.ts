import { ok } from 'neverthrow';
import type { Result } from 'neverthrow';

import type { BaseId } from '../../base/BaseId';
import type { DomainError } from '../../shared/DomainError';
import type { ISpecification } from '../../shared/specification/ISpecification';
import type { Table } from '../Table';
import type { ITableSpecVisitor } from './ITableSpecVisitor';

export class TableByBaseIdSpec<V extends ITableSpecVisitor = ITableSpecVisitor>
  implements ISpecification<Table, V>
{
  private constructor(private readonly baseIdValue: BaseId) {}

  static create(baseId: BaseId): TableByBaseIdSpec {
    return new TableByBaseIdSpec(baseId);
  }

  baseId(): BaseId {
    return this.baseIdValue;
  }

  isSatisfiedBy(t: Table): boolean {
    return t.baseId().equals(this.baseIdValue);
  }

  mutate(t: Table): Result<Table, DomainError> {
    return ok(t);
  }

  accept(v: V): Result<void, DomainError> {
    return v.visitTableByBaseId(this).map(() => undefined);
  }
}
