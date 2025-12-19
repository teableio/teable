import { ok } from 'neverthrow';
import type { Result } from 'neverthrow';

import type { BaseId } from '../../base/BaseId';
import type { ISpecification } from '../../shared/specification/ISpecification';
import type { ISpecVisitor } from '../../shared/specification/ISpecVisitor';
import type { Table } from '../Table';

export class TableByBaseIdSpec<V extends ISpecVisitor = ISpecVisitor>
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

  mutate(t: Table): Result<Table, string> {
    return ok(t);
  }

  accept(v: V): Result<void, string> {
    return v.visit(this).map(() => undefined);
  }
}
