import { err } from 'neverthrow';
import type { Result } from 'neverthrow';

import type { DomainError } from '../../shared/DomainError';
import { Table } from '../Table';
import type { ITableBuildProps } from '../TableBuilder';
import type { TablePropertiesPatch } from '../TableProperties';

export function updateProperties(
  this: Table,
  patch: TablePropertiesPatch
): Result<Table, DomainError> {
  const propertiesResult = this.properties().withPatch(patch);
  if (propertiesResult.isErr()) return err(propertiesResult.error);

  const props: ITableBuildProps = {
    id: this.id(),
    baseId: this.baseId(),
    name: this.name(),
    properties: propertiesResult.value,
    fields: this.getFields(),
    views: this.views(),
    primaryFieldId: this.primaryFieldId(),
  };
  const dbTableNameResult = this.dbTableName();
  if (dbTableNameResult.isOk()) props.dbTableName = dbTableNameResult.value;

  return Table.rehydrate(props);
}
