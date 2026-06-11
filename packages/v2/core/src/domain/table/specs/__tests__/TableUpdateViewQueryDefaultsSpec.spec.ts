import { describe, expect, it } from 'vitest';

import { BaseId } from '../../../base/BaseId';
import { FieldName } from '../../fields/FieldName';
import { Table } from '../../Table';
import { TableName } from '../../TableName';
import { ViewQueryDefaults } from '../../views/ViewQueryDefaults';
import { TableUpdateViewQueryDefaultsSpec } from '../TableUpdateViewQueryDefaultsSpec';

const createBaseId = (seed: string) => BaseId.create(`bse${seed.repeat(16)}`)._unsafeUnwrap();

const buildTable = () => {
  const baseId = createBaseId('a');
  const builder = Table.builder()
    .withBaseId(baseId)
    .withName(TableName.create('Query Defaults Table')._unsafeUnwrap());
  builder
    .field()
    .singleLineText()
    .withName(FieldName.create('Title')._unsafeUnwrap())
    .primary()
    .done();
  builder.view().defaultGrid().done();
  return builder.build()._unsafeUnwrap();
};

describe('TableUpdateViewQueryDefaultsSpec', () => {
  it('stores updates payload', () => {
    const table = buildTable();
    const view = table.views()[0]!;
    const queryDefaults = ViewQueryDefaults.create({
      filter: {
        conjunction: 'and',
        items: [{ fieldId: table.primaryFieldId().toString(), operator: 'is', value: 'A' }],
      },
      manualSort: false,
    })._unsafeUnwrap();

    const spec = TableUpdateViewQueryDefaultsSpec.create([
      {
        viewId: view.id(),
        queryDefaults,
      },
    ]);

    const updates = spec.updates();
    expect(updates).toHaveLength(1);
    expect(updates[0]?.viewId.equals(view.id())).toBe(true);
    expect(updates[0]?.queryDefaults.equals(queryDefaults)).toBe(true);
  });

  it('mutates the matching view query defaults and returns a cloned table', () => {
    const table = buildTable();
    const view = table.views()[0]!;
    const queryDefaults = ViewQueryDefaults.create({
      filter: {
        conjunction: 'and',
        items: [{ fieldId: table.primaryFieldId().toString(), operator: 'is', value: 'B' }],
      },
      manualSort: false,
    })._unsafeUnwrap();

    const spec = TableUpdateViewQueryDefaultsSpec.create([
      {
        viewId: view.id(),
        queryDefaults,
      },
    ]);

    const mutated = spec.mutate(table)._unsafeUnwrap();
    expect(mutated).not.toBe(table);
    expect(mutated.views()[0]?.id().equals(view.id())).toBe(true);
    expect(mutated.views()[0]?.queryDefaults()._unsafeUnwrap().equals(queryDefaults)).toBe(true);
  });
});
