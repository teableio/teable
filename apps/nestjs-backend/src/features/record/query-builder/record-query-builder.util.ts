import { Relationship } from '@teable/core';
import type { ILinkFieldOptions, LinkFieldCore, TableDomain } from '@teable/core';

export function getTableAliasFromTable(table: TableDomain): string {
  return table.getTableNameAndId().replaceAll(/\s+/g, '').replaceAll('.', '_');
}

export function getLinkUsesJunctionTable(field: LinkFieldCore): boolean {
  const options = field.options as ILinkFieldOptions;
  return (
    options.relationship === Relationship.ManyMany ||
    (options.relationship === Relationship.OneMany && !!options.isOneWay)
  );
}
