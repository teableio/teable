import { DefaultTableMapper } from '@teable/v2-core';
import type { ITablePersistenceDTO } from '@teable/v2-core';
import { describe, expect, it } from 'vitest';

import { mapTableToDto, tableDtoSchema } from './dto';

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
      description: 'Table description',
      icon: '📊',
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
    expect(tableDtoSchema.parse(mapped.value)).toMatchObject({
      description: 'Table description',
      icon: '📊',
    });
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

  it('maps AI field config through the public table DTO', () => {
    const baseId = `bse${'a'.repeat(16)}`;
    const tableId = `tbl${'b'.repeat(16)}`;
    const primaryFieldId = `fld${'c'.repeat(16)}`;
    const aiFieldId = `fld${'d'.repeat(16)}`;
    const viewId = `viw${'e'.repeat(16)}`;
    const aiConfig = {
      type: 'summary',
      sourceFieldId: primaryFieldId,
      prompt: 'Summarize the name',
    };

    const dto: ITablePersistenceDTO = {
      id: tableId,
      baseId,
      name: 'AI Config Source',
      dbTableName: `${baseId}.${tableId}`,
      primaryFieldId,
      fields: [
        {
          id: primaryFieldId,
          name: 'Name',
          type: 'singleLineText',
        },
        {
          id: aiFieldId,
          name: 'AI Summary',
          type: 'singleLineText',
          aiConfig,
        },
      ],
      views: [
        {
          id: viewId,
          type: 'grid',
          name: 'Grid',
          columnMeta: {
            [primaryFieldId]: { order: 0 },
            [aiFieldId]: { order: 1 },
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

    expect(
      tableDtoSchema.parse(mapped.value).fields.find((field) => field.id === aiFieldId)
    ).toMatchObject({
      id: aiFieldId,
      aiConfig,
    });
  });

  it('keeps oneMany lookup of a single user as a multiple JSON field', () => {
    const baseId = `bse${'a'.repeat(16)}`;
    const tableId = `tbl${'b'.repeat(16)}`;
    const foreignTableId = `tbl${'c'.repeat(16)}`;
    const primaryFieldId = `fld${'d'.repeat(16)}`;
    const linkFieldId = `fld${'e'.repeat(16)}`;
    const ownerFieldId = `fld${'h'.repeat(16)}`;
    const lookupFieldId = `fld${'i'.repeat(16)}`;
    const viewId = `viw${'g'.repeat(16)}`;

    const dto: ITablePersistenceDTO = {
      id: tableId,
      baseId,
      name: 'Customer Host',
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
          name: 'Opportunities',
          type: 'link',
          options: {
            relationship: 'oneMany',
            foreignTableId,
            lookupFieldId: primaryFieldId,
            fkHostTableName: `${baseId}.${foreignTableId}`,
            selfKeyName: '__fk_customer',
            foreignKeyName: '__id',
          },
        },
        {
          id: lookupFieldId,
          name: 'Owners',
          type: 'user',
          isLookup: true,
          isComputed: true,
          isMultipleCellValue: true,
          dbFieldType: 'JSON',
          options: {
            isMultiple: false,
            shouldNotify: false,
          },
          lookupOptions: {
            foreignTableId,
            linkFieldId,
            lookupFieldId: ownerFieldId,
            relationship: 'oneMany',
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
            [lookupFieldId]: { order: 2 },
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

    const lookupField = mapped.value.fields.find((field) => field.id === lookupFieldId);
    expect(tableDtoSchema.parse(mapped.value)).toBeTruthy();
    expect(lookupField).toMatchObject({
      id: lookupFieldId,
      type: 'user',
      isLookup: true,
      isMultipleCellValue: true,
      dbFieldType: 'JSON',
      options: {
        isMultiple: true,
        shouldNotify: false,
      },
    });
  });

  it('keeps isMultipleCellValue on a multi-value text conditional lookup (T6946)', () => {
    const baseId = `bse${'a'.repeat(16)}`;
    const tableId = `tbl${'b'.repeat(16)}`;
    const foreignTableId = `tbl${'c'.repeat(16)}`;
    const primaryFieldId = `fld${'d'.repeat(16)}`;
    const lookupFieldId = `fld${'e'.repeat(16)}`;
    const foreignLookupFieldId = `fld${'f'.repeat(16)}`;
    const filterFieldId = `fld${'g'.repeat(16)}`;
    const viewId = `viw${'h'.repeat(16)}`;

    const dto: ITablePersistenceDTO = {
      id: tableId,
      baseId,
      name: 'Conditional Lookup Host',
      dbTableName: `${baseId}.${tableId}`,
      primaryFieldId,
      fields: [
        {
          id: primaryFieldId,
          name: 'Key',
          type: 'singleLineText',
        },
        {
          id: lookupFieldId,
          name: 'Matched Names',
          type: 'conditionalLookup',
          isComputed: true,
          isMultipleCellValue: true,
          dbFieldType: 'JSON',
          cellValueType: 'string',
          innerType: 'singleLineText',
          innerOptions: {},
          options: {
            foreignTableId,
            lookupFieldId: foreignLookupFieldId,
            condition: {
              filter: {
                conjunction: 'and',
                filterSet: [{ fieldId: filterFieldId, operator: 'is', value: primaryFieldId }],
              },
            },
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
            [lookupFieldId]: { order: 1 },
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

    const lookupField = mapped.value.fields.find((field) => field.id === lookupFieldId);
    expect(lookupField).toMatchObject({
      id: lookupFieldId,
      type: 'singleLineText',
      isLookup: true,
      isMultipleCellValue: true,
      dbFieldType: 'JSON',
    });
    expect(
      tableDtoSchema.parse(mapped.value).fields.find((field) => field.id === lookupFieldId)
    ).toMatchObject({
      id: lookupFieldId,
      isMultipleCellValue: true,
      dbFieldType: 'JSON',
    });
  });

  it('keeps longText markdown showAs on the public table DTO (T6956)', () => {
    const baseId = `bse${'a'.repeat(16)}`;
    const tableId = `tbl${'b'.repeat(16)}`;
    const primaryFieldId = `fld${'c'.repeat(16)}`;
    const notesFieldId = `fld${'d'.repeat(16)}`;
    const viewId = `viw${'e'.repeat(16)}`;

    const dto: ITablePersistenceDTO = {
      id: tableId,
      baseId,
      name: 'Changelog',
      dbTableName: `${baseId}.${tableId}`,
      primaryFieldId,
      fields: [
        {
          id: primaryFieldId,
          name: 'Title',
          type: 'singleLineText',
        },
        {
          id: notesFieldId,
          name: 'Notes',
          type: 'longText',
          options: {
            showAs: { type: 'markdown' },
            defaultValue: 'Details',
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
            [notesFieldId]: { order: 1 },
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

    expect(mapped.value.fields.find((field) => field.id === notesFieldId)).toMatchObject({
      id: notesFieldId,
      type: 'longText',
      options: {
        showAs: { type: 'markdown' },
        defaultValue: 'Details',
      },
    });
    expect(
      tableDtoSchema.parse(mapped.value).fields.find((field) => field.id === notesFieldId)
    ).toMatchObject({
      id: notesFieldId,
      options: {
        showAs: { type: 'markdown' },
        defaultValue: 'Details',
      },
    });
  });
});
