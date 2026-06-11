import { describe, expect, it } from 'vitest';

import { DefaultTableMapper } from '@teable/v2-core';
import type { ITablePersistenceDTO } from '@teable/v2-core';

import { mapTableToDto } from './dto';

describe('mapTableToDto', () => {
  it('maps direct link fields without requiring link db config', () => {
    const baseId = `bse${'a'.repeat(16)}`;
    const tableId = `tbl${'b'.repeat(16)}`;
    const foreignTableId = `tbl${'c'.repeat(16)}`;
    const primaryFieldId = `fld${'d'.repeat(16)}`;
    const linkFieldId = `fld${'e'.repeat(16)}`;
    const viewId = `viw${'f'.repeat(16)}`;

    const dto: ITablePersistenceDTO = {
      id: tableId,
      baseId,
      name: 'Direct Link Source',
      dbTableName: `${baseId}.${tableId}`,
      primaryFieldId,
      fields: [
        {
          id: primaryFieldId,
          name: 'Name',
          type: 'singleLineText',
        },
        {
          id: linkFieldId,
          name: 'Vendor',
          type: 'link',
          options: {
            relationship: 'manyMany',
            foreignTableId,
            lookupFieldId: primaryFieldId,
          },
        },
      ],
      views: [
        {
          id: viewId,
          type: 'grid',
          name: 'Grid',
          columnMeta: {
            [primaryFieldId]: { order: 0 },
            [linkFieldId]: { order: 1 },
          },
        },
      ],
    };

    const table = new DefaultTableMapper().toDomain(dto)._unsafeUnwrap();
    const mapped = mapTableToDto(table);

    expect(mapped.isOk()).toBe(true);
    if (mapped.isErr()) {
      return;
    }

    const linkField = mapped.value.fields.find((field) => field.id === linkFieldId);
    expect(linkField).toMatchObject({
      id: linkFieldId,
      type: 'link',
      options: {
        relationship: 'manyMany',
        foreignTableId,
        lookupFieldId: primaryFieldId,
      },
    });
  });

  it('maps lookup fields over link inner types without requiring link db config', () => {
    const baseId = `bse${'a'.repeat(16)}`;
    const tableId = `tbl${'b'.repeat(16)}`;
    const foreignTableId = `tbl${'c'.repeat(16)}`;
    const primaryFieldId = `fld${'d'.repeat(16)}`;
    const linkFieldId = `fld${'e'.repeat(16)}`;
    const lookupLinkFieldId = `fld${'f'.repeat(16)}`;
    const viewId = `viw${'g'.repeat(16)}`;

    const dto: ITablePersistenceDTO = {
      id: tableId,
      baseId,
      name: 'Lookup Link Source',
      dbTableName: `${baseId}.${tableId}`,
      primaryFieldId,
      fields: [
        {
          id: primaryFieldId,
          name: 'Name',
          type: 'singleLineText',
        },
        {
          id: linkFieldId,
          name: 'Vendor',
          type: 'link',
          options: {
            relationship: 'manyMany',
            foreignTableId,
            lookupFieldId: primaryFieldId,
            fkHostTableName: `${baseId}.junction_vendor`,
            selfKeyName: '__fk_vendor_left',
            foreignKeyName: '__fk_vendor_right',
          },
        },
        {
          id: lookupLinkFieldId,
          name: 'Vendor Link Lookup',
          type: 'link',
          isLookup: true,
          isComputed: true,
          isMultipleCellValue: true,
          options: {
            relationship: 'manyMany',
            foreignTableId,
            lookupFieldId: primaryFieldId,
          },
          lookupOptions: {
            foreignTableId,
            linkFieldId,
            lookupFieldId: linkFieldId,
            relationship: 'manyMany',
          },
        },
      ],
      views: [
        {
          id: viewId,
          type: 'grid',
          name: 'Grid',
          columnMeta: {
            [primaryFieldId]: { order: 0 },
            [linkFieldId]: { order: 1 },
            [lookupLinkFieldId]: { order: 2 },
          },
        },
      ],
    };

    const table = new DefaultTableMapper().toDomain(dto)._unsafeUnwrap();
    const mapped = mapTableToDto(table);

    expect(mapped.isOk()).toBe(true);
    if (mapped.isErr()) {
      return;
    }

    const lookupField = mapped.value.fields.find((field) => field.id === lookupLinkFieldId);
    expect(lookupField).toMatchObject({
      id: lookupLinkFieldId,
      type: 'link',
      isLookup: true,
      lookupOptions: {
        foreignTableId,
        linkFieldId,
        lookupFieldId: linkFieldId,
      },
    });
  });
});
