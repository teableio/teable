import type { Table } from '@teable/v2-core';

const outboundComputedHint = new WeakMap<Table, boolean>();

/** Set during table hydrate. True when this table's fields have outbound `reference` rows. */
export const setTableComputedDownstreamHint = (
  table: Table,
  hasOutboundReference: boolean
): void => {
  outboundComputedHint.set(table, hasOutboundReference);
};

export const getTableComputedDownstreamHint = (table: Table): boolean | undefined =>
  outboundComputedHint.get(table);
