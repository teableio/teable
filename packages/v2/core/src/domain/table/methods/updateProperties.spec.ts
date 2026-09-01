import { describe, expect, it } from 'vitest';

import { BaseId } from '../../base/BaseId';
import { TablePropertiesUpdated } from '../events/TablePropertiesUpdated';
import { FieldName } from '../fields/FieldName';
import { Table } from '../Table';
import { TableName } from '../TableName';

const buildTable = () => {
  const builder = Table.builder()
    .withBaseId(BaseId.create(`bse${'a'.repeat(16)}`)._unsafeUnwrap())
    .withName(TableName.create('Projects')._unsafeUnwrap());
  builder.field().singleLineText().withName(FieldName.create('Name')._unsafeUnwrap()).done();
  builder.view().defaultGrid().done();
  return builder.build()._unsafeUnwrap();
};

describe('Table.updateProperties', () => {
  it('applies partial patches, clears values, and emits the aggregate event', () => {
    const initial = buildTable();
    const firstUpdate = initial
      .update((mutator) =>
        mutator.updateProperties({ description: 'Projects tracked by the team', icon: '📊' })
      )
      ._unsafeUnwrap();

    expect(firstUpdate.table.description()).toBe('Projects tracked by the team');
    expect(firstUpdate.table.icon()).toBe('📊');
    expect(firstUpdate.table.pullDomainEvents()).toEqual([expect.any(TablePropertiesUpdated)]);

    const partialUpdate = firstUpdate.table
      .update((mutator) => mutator.updateProperties({ description: 'Revised description' }))
      ._unsafeUnwrap();
    expect(partialUpdate.table.description()).toBe('Revised description');
    expect(partialUpdate.table.icon()).toBe('📊');

    const cleared = partialUpdate.table
      .update((mutator) => mutator.updateProperties({ description: null, icon: null }))
      ._unsafeUnwrap().table;
    expect(cleared.description()).toBeUndefined();
    expect(cleared.icon()).toBeUndefined();
  });

  it('does not emit an event when properties do not change', () => {
    const table = buildTable();
    const updated = table
      .update((mutator) => mutator.updateProperties({ description: null }))
      ._unsafeUnwrap().table;

    expect(updated.pullDomainEvents()).toEqual([]);
  });
});
