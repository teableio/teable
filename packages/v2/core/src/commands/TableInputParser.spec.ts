import { describe, expect, it } from 'vitest';

import { BaseId } from '../domain/base/BaseId';
import { FieldName } from '../domain/table/fields/FieldName';
import { Table } from '../domain/table/Table';
import { TableName } from '../domain/table/TableName';
import {
  buildTableFromInput,
  parseFieldSpecs,
  parseTableInput,
  parseViewSpecs,
} from './TableInputParser';

describe('TableInputParser', () => {
  it('defaults to a primary field and grid view', () => {
    const result = buildTableFromInput({
      baseId: `bse${'a'.repeat(16)}`,
      name: 'Defaults',
      fields: [],
    });

    const table = result._unsafeUnwrap().table;
    expect(table.getFields()).toHaveLength(1);
    expect(table.views()).toHaveLength(1);
  });

  it('rejects multiple primary fields', () => {
    const specs = parseFieldSpecs([
      { type: 'singleLineText', name: 'A', isPrimary: true },
      { type: 'singleLineText', name: 'B', isPrimary: true },
    ]);

    expect(specs.isErr()).toBe(true);
  });

  it('parses view specs with default names', () => {
    const viewSpecs = parseViewSpecs([
      { type: 'kanban' },
      { type: 'calendar', name: 'Schedule' },
    ])._unsafeUnwrap();

    const baseId = BaseId.create(`bse${'b'.repeat(16)}`)._unsafeUnwrap();
    const builder = Table.builder()
      .withBaseId(baseId)
      .withName(TableName.create('Views')._unsafeUnwrap());
    builder
      .field()
      .singleLineText()
      .withName(FieldName.create('Title')._unsafeUnwrap())
      .primary()
      .done();

    for (const spec of viewSpecs) {
      spec.applyTo(builder);
    }

    const table = builder.build()._unsafeUnwrap();
    const viewNames = table.views().map((view) => view.name().toString());
    expect(viewNames).toEqual(['Kanban', 'Schedule']);
  });

  it('builds tables with foreign references', () => {
    const baseId = `bse${'c'.repeat(16)}`;
    const tableId = `tbl${'d'.repeat(16)}`;
    const primaryFieldId = `fld${'e'.repeat(16)}`;
    const linkFieldId = `fld${'f'.repeat(16)}`;
    const foreignTableId = `tbl${'g'.repeat(16)}`;

    const result = buildTableFromInput({
      baseId,
      tableId,
      name: 'Links',
      fields: [
        { type: 'singleLineText', id: primaryFieldId, name: 'Name', isPrimary: true },
        {
          type: 'link',
          id: linkFieldId,
          name: 'Link',
          options: {
            relationship: 'oneMany',
            foreignTableId,
            lookupFieldId: primaryFieldId,
          },
        },
      ],
      views: [{ type: 'grid', name: 'Grid' }],
    });

    const payload = result._unsafeUnwrap();
    expect(payload.table.id().toString()).toBe(tableId);
    expect(payload.foreignTableReferences).toHaveLength(1);
    expect(payload.foreignTableReferences[0]?.foreignTableId.toString()).toBe(foreignTableId);
  });

  it('parses table input into structured parts', () => {
    const parsed = parseTableInput({
      baseId: `bse${'h'.repeat(16)}`,
      name: 'Parsed',
      fields: [{ type: 'singleLineText', name: 'Name' }],
      views: [{ type: 'form' }],
    })._unsafeUnwrap();

    expect(parsed.fieldSpecs).toHaveLength(1);
    expect(parsed.viewSpecs).toHaveLength(1);
  });
});
