import { describe, expect, it } from 'vitest';

import { BaseId } from '../../domain/base/BaseId';
import { FieldName } from '../../domain/table/fields/FieldName';
import { FieldId } from '../../domain/table/fields/FieldId';
import { FieldKeyType } from '../../domain/table/fields/FieldKeyType';
import { Table } from '../../domain/table/Table';
import { TableId } from '../../domain/table/TableId';
import { TableName } from '../../domain/table/TableName';
import { FieldKeyResolverService } from './FieldKeyResolverService';

const createTable = () => {
  const builder = Table.builder()
    .withId(TableId.create(`tbl${'a'.repeat(16)}`)._unsafeUnwrap())
    .withBaseId(BaseId.create(`bse${'b'.repeat(16)}`)._unsafeUnwrap())
    .withName(TableName.create('Resolver Test Table')._unsafeUnwrap());

  builder
    .field()
    .singleLineText()
    .withId(FieldId.create(`fld${'c'.repeat(16)}`)._unsafeUnwrap())
    .withName(FieldName.create('Name')._unsafeUnwrap())
    .primary()
    .done();

  builder
    .field()
    .number()
    .withId(FieldId.create(`fld${'d'.repeat(16)}`)._unsafeUnwrap())
    .withName(FieldName.create('Amount')._unsafeUnwrap())
    .done();

  builder.view().defaultGrid().done();

  return builder.build()._unsafeUnwrap();
};

describe('FieldKeyResolverService', () => {
  it('returns a domain error with available field keys for missing field names', () => {
    const table = createTable();
    const result = FieldKeyResolverService.resolveFieldKeys(
      table,
      { 'Source ID 2': 'src-1' },
      FieldKeyType.Name
    );

    expect(result.isErr()).toBe(true);

    if (result.isOk()) {
      expect.unreachable('Expected resolveFieldKeys to fail');
    }

    expect(result.error.code).toBe('field.key_not_found');
    expect(result.error.tags).toContain('not-found');
    expect(result.error.message).toBe('Field "Source ID 2" does not exist in this table');
    expect(result.error.details).toEqual({
      fieldKeyType: FieldKeyType.Name,
      fieldKey: 'Source ID 2',
      availableFieldKeys: ['Name', 'Amount'],
    });
  });
});
