import { err, ok } from 'neverthrow';
import type { Result } from 'neverthrow';
import type { DomainError } from '../../shared/DomainError';
import { TableRenamed } from '../events/TableRenamed';
import type { Table } from '../Table';
import type { ITableBuildProps } from '../TableBuilder';
import type { TableName } from '../TableName';

export function rename(this: Table, nextName: TableName): Result<Table, DomainError> {
  const props: ITableBuildProps = {
    id: this.id(),
    baseId: this.baseId(),
    name: nextName,
    fields: this.getFields(),
    views: this.views(),
    primaryFieldId: this.primaryFieldId(),
  };

  const dbTableNameResult = this.dbTableName();
  if (dbTableNameResult.isOk()) {
    props.dbTableName = dbTableNameResult.value;
  }

  const tableClass = this.constructor as {
    rehydrate: (props: ITableBuildProps) => Result<Table, DomainError>;
  };
  const cloned = tableClass.rehydrate(props);
  if (cloned.isErr()) return err(cloned.error);
  const nextTable = cloned.value;

  const currentName = this.name();
  if (!currentName.equals(nextName)) {
    nextTable.addDomainEvent(
      TableRenamed.create({
        tableId: nextTable.id(),
        baseId: nextTable.baseId(),
        previousName: currentName,
        nextName,
      })
    );
  }

  return ok(nextTable);
}
