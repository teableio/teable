import { ok } from 'neverthrow';
import type { Result } from 'neverthrow';

import type { DomainError } from '../../shared/DomainError';
import type { ISpecification } from '../../shared/specification/ISpecification';
import { LinkForeignTableReferenceVisitor } from '../fields/visitors/LinkForeignTableReferenceVisitor';
import type { Table } from '../Table';
import type { TableId } from '../TableId';
import type { ITableSpecVisitor } from './ITableSpecVisitor';

export class TableByIncomingReferenceToTableSpec<V extends ITableSpecVisitor = ITableSpecVisitor>
  implements ISpecification<Table, V>
{
  private readonly linkReferenceVisitor = new LinkForeignTableReferenceVisitor();

  private constructor(private readonly tableIdValue: TableId) {}

  static create(tableId: TableId): TableByIncomingReferenceToTableSpec {
    return new TableByIncomingReferenceToTableSpec(tableId);
  }

  tableId(): TableId {
    return this.tableIdValue;
  }

  isSatisfiedBy(t: Table): boolean {
    const referencesResult = this.linkReferenceVisitor.collect(t.getFields());
    if (referencesResult.isErr()) {
      return false;
    }

    return referencesResult.value.some((reference) =>
      reference.foreignTableId.equals(this.tableIdValue)
    );
  }

  mutate(t: Table): Result<Table, DomainError> {
    return ok(t);
  }

  accept(v: V): Result<void, DomainError> {
    return v.visitTableByIncomingReferenceToTable(this).map(() => undefined);
  }
}
