import { describe, expect, it } from 'vitest';

import { BaseId } from '../domain/base/BaseId';
import { FieldId } from '../domain/table/fields/FieldId';
import { FieldName } from '../domain/table/fields/FieldName';
import { LinkFieldConfig } from '../domain/table/fields/types/LinkFieldConfig';
import { LinkRelationship } from '../domain/table/fields/types/LinkRelationship';
import { LookupOptions } from '../domain/table/fields/types/LookupOptions';
import { SelectOption } from '../domain/table/fields/types/SelectOption';
import { SingleLineTextField } from '../domain/table/fields/types/SingleLineTextField';
import { RecordId } from '../domain/table/records/RecordId';
import { TableRecord } from '../domain/table/records/TableRecord';
import { TableRecordCellValue } from '../domain/table/records/TableRecordFields';
import { Table } from '../domain/table/Table';
import { TableId } from '../domain/table/TableId';
import { TableName } from '../domain/table/TableName';
import type { RecordFilter } from './RecordFilterDto';
import {
  buildRecordConditionSpec,
  replaceCurrentUserTagInFilter,
  sanitizeRecordFilter,
} from './RecordFilterMapper';

const baseId = (seed: string) => BaseId.create(`bse${seed.repeat(16)}`)._unsafeUnwrap();
const recordId = (seed: string) => RecordId.create(`rec${seed.repeat(16)}`)._unsafeUnwrap();
const cell = (value: unknown) => TableRecordCellValue.create(value)._unsafeUnwrap();
const selectOption = (name: string) => SelectOption.create({ name, color: 'blue' })._unsafeUnwrap();
const fieldId = (seed: string) => FieldId.create(`fld${seed.repeat(16)}`)._unsafeUnwrap();

const buildTable = () => {
  const builder = Table.builder()
    .withBaseId(baseId('a'))
    .withName(TableName.create('Records')._unsafeUnwrap());

  builder.field().singleLineText().withName(FieldName.create('Title')._unsafeUnwrap()).done();
  builder.field().singleLineText().withName(FieldName.create('Ref')._unsafeUnwrap()).done();
  builder.field().checkbox().withName(FieldName.create('Done')._unsafeUnwrap()).done();
  builder.field().date().withName(FieldName.create('Due')._unsafeUnwrap()).done();
  builder
    .field()
    .singleSelect()
    .withName(FieldName.create('Status')._unsafeUnwrap())
    .withOptions([selectOption('Open')])
    .done();
  builder.field().user().withName(FieldName.create('Owner')._unsafeUnwrap()).done();
  builder.field().createdBy().withName(FieldName.create('Creator')._unsafeUnwrap()).done();
  builder.field().lastModifiedBy().withName(FieldName.create('Modifier')._unsafeUnwrap()).done();
  builder
    .field()
    .multipleSelect()
    .withName(FieldName.create('Tags')._unsafeUnwrap())
    .withOptions([selectOption('a'), selectOption('b')])
    .done();
  builder.view().defaultGrid().done();

  return builder.build()._unsafeUnwrap();
};

const buildTextLookupTable = () => {
  const foreignTableId = TableId.create(`tbl${'l'.repeat(16)}`)._unsafeUnwrap();
  const foreignFieldId = fieldId('m');
  const linkId = fieldId('n');
  const lookupId = fieldId('o');
  const builder = Table.builder()
    .withBaseId(baseId('l'))
    .withName(TableName.create('Lookup Records')._unsafeUnwrap());
  builder
    .field()
    .singleLineText()
    .withName(FieldName.create('Title')._unsafeUnwrap())
    .primary()
    .done();
  builder
    .field()
    .link()
    .withId(linkId)
    .withName(FieldName.create('Link')._unsafeUnwrap())
    .withConfig(
      LinkFieldConfig.create({
        relationship: LinkRelationship.manyOne().toString(),
        foreignTableId: foreignTableId.toString(),
        lookupFieldId: foreignFieldId.toString(),
      })._unsafeUnwrap()
    )
    .done();
  builder
    .field()
    .lookup()
    .withId(lookupId)
    .withName(FieldName.create('Lookup Text')._unsafeUnwrap())
    .withInnerField(
      SingleLineTextField.create({
        id: foreignFieldId,
        name: FieldName.create('Foreign Text')._unsafeUnwrap(),
      })._unsafeUnwrap()
    )
    .withLookupOptions(
      LookupOptions.create({
        linkFieldId: linkId.toString(),
        foreignTableId: foreignTableId.toString(),
        lookupFieldId: foreignFieldId.toString(),
      })._unsafeUnwrap()
    )
    .withIsMultipleCellValue(false)
    .done();
  builder.view().defaultGrid().done();
  return { table: builder.build()._unsafeUnwrap(), lookupId };
};

const buildRecord = (table: Table) => {
  const titleField = table.getField((field) => field.name().toString() === 'Title')._unsafeUnwrap();
  const refField = table.getField((field) => field.name().toString() === 'Ref')._unsafeUnwrap();
  const dueField = table.getField((field) => field.name().toString() === 'Due')._unsafeUnwrap();
  const statusField = table
    .getField((field) => field.name().toString() === 'Status')
    ._unsafeUnwrap();

  const record = TableRecord.create({
    id: recordId('a'),
    tableId: table.id(),
    fieldValues: [
      { fieldId: titleField.id(), value: cell('Hello world') },
      { fieldId: refField.id(), value: cell('Hello world') },
      { fieldId: dueField.id(), value: cell('2024-01-02T00:00:00.000Z') },
      { fieldId: statusField.id(), value: cell('Open') },
    ],
  })._unsafeUnwrap();

  return { record, titleField, refField, dueField, statusField };
};

describe('RecordFilterMapper', () => {
  it('builds specs for literal, list, and date values', () => {
    const table = buildTable();
    const { record, titleField, dueField, statusField } = buildRecord(table);

    const filter: RecordFilter = {
      conjunction: 'and',
      items: [
        {
          fieldId: titleField.id().toString(),
          operator: 'contains',
          value: 'Hello',
        },
        {
          fieldId: statusField.id().toString(),
          operator: 'isAnyOf',
          value: ['Open'],
        },
        {
          fieldId: dueField.id().toString(),
          operator: 'isOnOrAfter',
          value: {
            mode: 'exactDate',
            exactDate: '2024-01-01T00:00:00.000Z',
            timeZone: 'utc',
          },
        },
      ],
    };

    const result = buildRecordConditionSpec(table, filter);
    expect(result.isOk()).toBe(true);
    const spec = result._unsafeUnwrap();
    expect(spec.isSatisfiedBy(record)).toBe(true);
  });

  it('builds specs for field reference values', () => {
    const table = buildTable();
    const { record, titleField, refField } = buildRecord(table);

    const filter: RecordFilter = {
      fieldId: titleField.id().toString(),
      operator: 'is',
      value: {
        type: 'field',
        fieldId: refField.id().toString(),
      },
    };

    const result = buildRecordConditionSpec(table, filter);
    expect(result.isOk()).toBe(true);
    expect(result._unsafeUnwrap().isSatisfiedBy(record)).toBe(true);
  });

  it('does not re-include hidden rows under NOT of a masked field condition', () => {
    const table = buildTable();
    const titleField = table
      .getField((field) => field.name().toString() === 'Title')
      ._unsafeUnwrap();
    const titleId = titleField.id().toString();
    // Mask never satisfied → field always hidden (CASE WHEN → null).
    const neverVisible = {
      isSatisfiedBy: () => false,
      mutate: () => {
        throw new Error('not used');
      },
      accept: () => {
        throw new Error('not used');
      },
    } as never;

    const filter: RecordFilter = {
      not: {
        fieldId: titleId,
        operator: 'is',
        value: 'Secret',
      },
    };

    // NOT(leaf) isTrue = leaf.isFalse = mask AND NOT cond → false when hidden.
    const hiddenRecord = TableRecord.fromRawFieldValues({
      id: recordId('h').toString(),
      tableId: table.id(),
      fields: { [titleId]: 'Secret' },
    })._unsafeUnwrap();

    const result = buildRecordConditionSpec(table, filter, [
      { fieldId: titleId, visibleWhen: neverVisible },
    ]);
    expect(result.isOk()).toBe(true);
    expect(result._unsafeUnwrap().isSatisfiedBy(hiddenRecord)).toBe(false);
  });

  it('preserves SQL three-valued NOT(AND) when a masked operand is unknown', () => {
    const table = buildTable();
    const titleField = table
      .getField((field) => field.name().toString() === 'Title')
      ._unsafeUnwrap();
    const doneField = table.getField((field) => field.name().toString() === 'Done')._unsafeUnwrap();
    const titleId = titleField.id().toString();
    const doneId = doneField.id().toString();
    const neverVisible = {
      isSatisfiedBy: () => false,
      mutate: () => {
        throw new Error('not used');
      },
      accept: () => {
        throw new Error('not used');
      },
    } as never;

    // NOT(maskedTitle = Secret AND Done is true)
    // When Title is hidden and Done is false: SQL UNKNOWN AND false = false → NOT = true.
    const filter: RecordFilter = {
      not: {
        conjunction: 'and',
        items: [
          { fieldId: titleId, operator: 'is', value: 'Secret' },
          { fieldId: doneId, operator: 'is', value: true },
        ],
      },
    };

    const record = TableRecord.fromRawFieldValues({
      id: recordId('c').toString(),
      tableId: table.id(),
      fields: {
        [titleId]: 'Secret',
        [doneId]: false,
      },
    })._unsafeUnwrap();

    const result = buildRecordConditionSpec(table, filter, [
      { fieldId: titleId, visibleWhen: neverVisible },
    ]);
    expect(result.isOk()).toBe(true);
    expect(result._unsafeUnwrap().isSatisfiedBy(record)).toBe(true);
  });

  it('matches hidden rows for null-is-true operators (isNot)', () => {
    const table = buildTable();
    const titleField = table
      .getField((field) => field.name().toString() === 'Title')
      ._unsafeUnwrap();
    const titleId = titleField.id().toString();
    const neverVisible = {
      isSatisfiedBy: () => false,
      mutate: () => {
        throw new Error('not used');
      },
      accept: () => {
        throw new Error('not used');
      },
    } as never;

    // CASE WHEN false THEN value END isNot 'X' ⇔ NULL IS DISTINCT FROM 'X' ⇔ true
    const filter: RecordFilter = {
      fieldId: titleId,
      operator: 'isNot',
      value: 'Secret',
    };
    const hiddenRecord = TableRecord.fromRawFieldValues({
      id: recordId('n').toString(),
      tableId: table.id(),
      fields: { [titleId]: 'Secret' },
    })._unsafeUnwrap();

    const result = buildRecordConditionSpec(table, filter, [
      { fieldId: titleId, visibleWhen: neverVisible },
    ]);
    expect(result.isOk()).toBe(true);
    expect(result._unsafeUnwrap().isSatisfiedBy(hiddenRecord)).toBe(true);
  });

  it('matches NOT(hidden isNotEmpty) because isNotEmpty is false on NULL', () => {
    const table = buildTable();
    const titleField = table
      .getField((field) => field.name().toString() === 'Title')
      ._unsafeUnwrap();
    const titleId = titleField.id().toString();
    const neverVisible = {
      isSatisfiedBy: () => false,
      mutate: () => {
        throw new Error('not used');
      },
      accept: () => {
        throw new Error('not used');
      },
    } as never;

    // isNotEmpty on NULL is definite false → NOT is true
    const filter: RecordFilter = {
      not: {
        fieldId: titleId,
        operator: 'isNotEmpty',
        value: null,
      },
    };
    const hiddenRecord = TableRecord.fromRawFieldValues({
      id: recordId('e').toString(),
      tableId: table.id(),
      fields: { [titleId]: 'Secret' },
    })._unsafeUnwrap();

    const result = buildRecordConditionSpec(table, filter, [
      { fieldId: titleId, visibleWhen: neverVisible },
    ]);
    expect(result.isOk()).toBe(true);
    expect(result._unsafeUnwrap().isSatisfiedBy(hiddenRecord)).toBe(true);
  });

  it('matches hidden checkbox is+null (canonical is false / unchecked)', () => {
    const table = buildTable();
    const doneField = table.getField((field) => field.name().toString() === 'Done')._unsafeUnwrap();
    const doneId = doneField.id().toString();
    const neverVisible = {
      isSatisfiedBy: () => false,
      mutate: () => {
        throw new Error('not used');
      },
      accept: () => {
        throw new Error('not used');
      },
    } as never;

    // V1: is + null → is false; SQL: false OR null → true when hidden
    const filter: RecordFilter = {
      fieldId: doneId,
      operator: 'is',
      value: null,
    };
    const hiddenRecord = TableRecord.fromRawFieldValues({
      id: recordId('u').toString(),
      tableId: table.id(),
      fields: { [doneId]: true },
    })._unsafeUnwrap();

    const result = buildRecordConditionSpec(table, filter, [
      { fieldId: doneId, visibleWhen: neverVisible },
    ]);
    expect(result.isOk()).toBe(true);
    expect(result._unsafeUnwrap().isSatisfiedBy(hiddenRecord)).toBe(true);
  });

  it('does not match hidden checkbox isNot+null (canonical is true / checked)', () => {
    const table = buildTable();
    const doneField = table.getField((field) => field.name().toString() === 'Done')._unsafeUnwrap();
    const doneId = doneField.id().toString();
    const neverVisible = {
      isSatisfiedBy: () => false,
      mutate: () => {
        throw new Error('not used');
      },
      accept: () => {
        throw new Error('not used');
      },
    } as never;

    // V1: isNot + null → is true; SQL: col = true does not match NULL when hidden
    const filter: RecordFilter = {
      fieldId: doneId,
      operator: 'isNot',
      value: null,
    };
    const hiddenRecord = TableRecord.fromRawFieldValues({
      id: recordId('k').toString(),
      tableId: table.id(),
      fields: { [doneId]: false },
    })._unsafeUnwrap();

    const result = buildRecordConditionSpec(table, filter, [
      { fieldId: doneId, visibleWhen: neverVisible },
    ]);
    expect(result.isOk()).toBe(true);
    expect(result._unsafeUnwrap().isSatisfiedBy(hiddenRecord)).toBe(false);
  });

  it('matches NOT(hasAnyOf) on hidden multi-value field (NULL → [] → false)', () => {
    const table = buildTable();
    const tagsField = table.getField((field) => field.name().toString() === 'Tags')._unsafeUnwrap();
    const tagsId = tagsField.id().toString();
    const neverVisible = {
      isSatisfiedBy: () => false,
      mutate: () => {
        throw new Error('not used');
      },
      accept: () => {
        throw new Error('not used');
      },
    } as never;

    const filter: RecordFilter = {
      not: {
        fieldId: tagsId,
        operator: 'hasAnyOf',
        value: ['a'],
      },
    };
    const hiddenRecord = TableRecord.fromRawFieldValues({
      id: recordId('m').toString(),
      tableId: table.id(),
      fields: { [tagsId]: ['a'] },
    })._unsafeUnwrap();

    const result = buildRecordConditionSpec(table, filter, [
      { fieldId: tagsId, visibleWhen: neverVisible },
    ]);
    expect(result.isOk()).toBe(true);
    expect(result._unsafeUnwrap().isSatisfiedBy(hiddenRecord)).toBe(true);
  });

  it('does not match hidden text is (ordinary equality → UNKNOWN)', () => {
    const table = buildTable();
    const titleField = table
      .getField((field) => field.name().toString() === 'Title')
      ._unsafeUnwrap();
    const titleId = titleField.id().toString();
    const neverVisible = {
      isSatisfiedBy: () => false,
      mutate: () => {
        throw new Error('not used');
      },
      accept: () => {
        throw new Error('not used');
      },
    } as never;

    const filter: RecordFilter = {
      fieldId: titleId,
      operator: 'is',
      value: 'false',
    };
    const hiddenRecord = TableRecord.fromRawFieldValues({
      id: recordId('b').toString(),
      tableId: table.id(),
      fields: { [titleId]: 'x' },
    })._unsafeUnwrap();

    const result = buildRecordConditionSpec(table, filter, [
      { fieldId: titleId, visibleWhen: neverVisible },
    ]);
    expect(result.isOk()).toBe(true);
    expect(result._unsafeUnwrap().isSatisfiedBy(hiddenRecord)).toBe(false);
  });

  it('does not match hidden doesNotContain empty string (NOT ILIKE %% is false)', () => {
    const table = buildTable();
    const titleField = table
      .getField((field) => field.name().toString() === 'Title')
      ._unsafeUnwrap();
    const titleId = titleField.id().toString();
    const neverVisible = {
      isSatisfiedBy: () => false,
      mutate: () => {
        throw new Error('not used');
      },
      accept: () => {
        throw new Error('not used');
      },
    } as never;

    const filter: RecordFilter = {
      fieldId: titleId,
      operator: 'doesNotContain',
      value: '',
    };
    const hiddenRecord = TableRecord.fromRawFieldValues({
      id: recordId('z').toString(),
      tableId: table.id(),
      fields: { [titleId]: 'secret' },
    })._unsafeUnwrap();

    const result = buildRecordConditionSpec(table, filter, [
      { fieldId: titleId, visibleWhen: neverVisible },
    ]);
    expect(result.isOk()).toBe(true);
    expect(result._unsafeUnwrap().isSatisfiedBy(hiddenRecord)).toBe(false);
  });

  it('rejects masked LHS compared to a field-reference RHS (row-dependent NULL)', () => {
    const table = buildTable();
    const titleField = table
      .getField((field) => field.name().toString() === 'Title')
      ._unsafeUnwrap();
    const refField = table.getField((field) => field.name().toString() === 'Ref')._unsafeUnwrap();
    const neverVisible = {
      isSatisfiedBy: () => false,
      mutate: () => {
        throw new Error('not used');
      },
      accept: () => {
        throw new Error('not used');
      },
    } as never;

    const filter: RecordFilter = {
      fieldId: titleField.id().toString(),
      operator: 'isNot',
      value: {
        type: 'field',
        fieldId: refField.id().toString(),
      },
    };

    const result = buildRecordConditionSpec(table, filter, [
      { fieldId: titleField.id().toString(), visibleWhen: neverVisible },
    ]);
    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr().code).toBe('record.filter.masked_field_reference_lhs');
  });

  it('rejects filter RHS field-references to conditionally masked fields', () => {
    const table = buildTable();
    const titleField = table
      .getField((field) => field.name().toString() === 'Title')
      ._unsafeUnwrap();
    const refField = table.getField((field) => field.name().toString() === 'Ref')._unsafeUnwrap();
    const neverVisible = {
      isSatisfiedBy: () => false,
      mutate: () => {
        throw new Error('not used');
      },
      accept: () => {
        throw new Error('not used');
      },
    } as never;

    const filter: RecordFilter = {
      fieldId: titleField.id().toString(),
      operator: 'is',
      value: {
        type: 'field',
        fieldId: refField.id().toString(),
      },
    };

    const result = buildRecordConditionSpec(table, filter, [
      { fieldId: refField.id().toString(), visibleWhen: neverVisible },
    ]);
    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr().message).toContain('conditionally masked');
  });

  it('supports not and or groups', () => {
    const table = buildTable();
    const { record, titleField, dueField } = buildRecord(table);

    const filter: RecordFilter = {
      conjunction: 'or',
      items: [
        {
          fieldId: titleField.id().toString(),
          operator: 'contains',
          value: 'Missing',
        },
        {
          not: {
            fieldId: dueField.id().toString(),
            operator: 'isBefore',
            value: {
              mode: 'exactDate',
              exactDate: '2024-01-01T00:00:00.000Z',
              timeZone: 'utc',
            },
          },
        },
      ],
    };

    const result = buildRecordConditionSpec(table, filter);
    expect(result.isOk()).toBe(true);
    expect(result._unsafeUnwrap().isSatisfiedBy(record)).toBe(true);
  });

  it('returns errors for invalid filters', () => {
    const table = buildTable();
    const { refField } = buildRecord(table);

    const empty = buildRecordConditionSpec(table, null);
    expect(empty._unsafeUnwrapErr().message).toContain('Filter is empty');

    const missingField = buildRecordConditionSpec(table, {
      fieldId: 'fldmissing123456789',
      operator: 'is',
      value: 'x',
    } as RecordFilter);
    expect(missingField._unsafeUnwrapErr().message).toContain('Filter field not found');

    const mismatchedTable = buildRecordConditionSpec(table, {
      fieldId: refField.id().toString(),
      operator: 'is',
      value: {
        type: 'field',
        fieldId: refField.id().toString(),
        tableId: TableId.create(`tbl${'z'.repeat(16)}`)
          ._unsafeUnwrap()
          .toString(),
      },
    });
    expect(mismatchedTable._unsafeUnwrapErr().message).toContain('Filter field table mismatch');

    const invalidNode = buildRecordConditionSpec(table, { foo: 'bar' } as unknown as RecordFilter);
    expect(invalidNode._unsafeUnwrapErr().message).toContain('Invalid record filter node');
  });

  it('drops invalid filter conditions during sanitization', () => {
    const table = buildTable();
    const { statusField, titleField } = buildRecord(table);

    const filter: RecordFilter = {
      conjunction: 'and',
      items: [
        {
          fieldId: statusField.id().toString(),
          operator: 'hasAnyOf',
          value: ['Open'],
        },
        {
          fieldId: titleField.id().toString(),
          operator: 'contains',
          value: 'Hello',
        },
      ],
    };

    const result = sanitizeRecordFilter(table, filter);
    expect(result.isOk()).toBe(true);
    expect(result._unsafeUnwrap()).toEqual({
      conjunction: 'and',
      items: [
        {
          fieldId: titleField.id().toString(),
          operator: 'contains',
          value: 'Hello',
        },
      ],
    });
  });

  it('keeps checkbox null equality and drops incomplete non-checkbox null equality', () => {
    const table = buildTable();
    const doneField = table.getField((field) => field.name().toString() === 'Done')._unsafeUnwrap();
    const titleField = table
      .getField((field) => field.name().toString() === 'Title')
      ._unsafeUnwrap();

    const filter: RecordFilter = {
      conjunction: 'and',
      items: [
        {
          fieldId: doneField.id().toString(),
          operator: 'is',
          value: null,
        },
        {
          fieldId: titleField.id().toString(),
          operator: 'is',
          value: null,
        },
        {
          fieldId: titleField.id().toString(),
          operator: 'isNot',
          value: null,
        },
      ],
    };

    const result = sanitizeRecordFilter(table, filter);

    expect(result.isOk()).toBe(true);
    expect(result._unsafeUnwrap()).toEqual({
      conjunction: 'and',
      items: [
        {
          fieldId: doneField.id().toString(),
          operator: 'is',
          value: null,
        },
      ],
    });
  });

  it('replaces current-user tag only for user-like filter fields', () => {
    const table = buildTable();
    const ownerField = table
      .getField((field) => field.name().toString() === 'Owner')
      ._unsafeUnwrap();
    const creatorField = table
      .getField((field) => field.name().toString() === 'Creator')
      ._unsafeUnwrap();
    const modifierField = table
      .getField((field) => field.name().toString() === 'Modifier')
      ._unsafeUnwrap();
    const titleField = table
      .getField((field) => field.name().toString() === 'Title')
      ._unsafeUnwrap();

    const filter: RecordFilter = {
      conjunction: 'and',
      items: [
        { fieldId: ownerField.id().toString(), operator: 'is', value: 'Me' },
        { fieldId: creatorField.id().toString(), operator: 'isAnyOf', value: ['Me', 'usrOther'] },
        { fieldId: modifierField.id().toString(), operator: 'isNot', value: 'Me' },
        { fieldId: titleField.id().toString(), operator: 'is', value: 'Me' },
      ],
    };

    expect(replaceCurrentUserTagInFilter(table, filter, 'usrCurrent')).toEqual({
      conjunction: 'and',
      items: [
        { fieldId: ownerField.id().toString(), operator: 'is', value: 'usrCurrent' },
        {
          fieldId: creatorField.id().toString(),
          operator: 'isAnyOf',
          value: ['usrCurrent', 'usrOther'],
        },
        { fieldId: modifierField.id().toString(), operator: 'isNot', value: 'usrCurrent' },
        { fieldId: titleField.id().toString(), operator: 'is', value: 'Me' },
      ],
    });
  });

  it('does not invert hidden text lookup doesNotContain empty string under NOT', () => {
    const { table, lookupId } = buildTextLookupTable();
    const neverVisible = {
      isSatisfiedBy: () => false,
      mutate: () => {
        throw new Error('not used');
      },
      accept: () => {
        throw new Error('not used');
      },
    } as never;
    const filter: RecordFilter = {
      not: {
        fieldId: lookupId.toString(),
        operator: 'doesNotContain',
        value: '',
      },
    };
    const hiddenRecord = TableRecord.fromRawFieldValues({
      id: recordId('l').toString(),
      tableId: table.id(),
      fields: {},
    })._unsafeUnwrap();

    const result = buildRecordConditionSpec(table, filter, [
      { fieldId: lookupId.toString(), visibleWhen: neverVisible },
    ]);
    expect(result.isOk()).toBe(true);
    // SQL: NOT(NOT jsonb_path_exists([], empty-regex)) = NOT(true) = false.
    expect(result._unsafeUnwrap().isSatisfiedBy(hiddenRecord)).toBe(false);
  });

  it('does not match hidden single-select isNoneOf an empty string', () => {
    const table = buildTable();
    const statusField = table
      .getField((field) => field.name().toString() === 'Status')
      ._unsafeUnwrap();
    const statusId = statusField.id().toString();
    const neverVisible = {
      isSatisfiedBy: () => false,
      mutate: () => {
        throw new Error('not used');
      },
      accept: () => {
        throw new Error('not used');
      },
    } as never;
    const filter: RecordFilter = {
      fieldId: statusId,
      operator: 'isNoneOf',
      value: [''],
    };
    const hiddenRecord = TableRecord.fromRawFieldValues({
      id: recordId('p').toString(),
      tableId: table.id(),
      fields: {},
    })._unsafeUnwrap();

    const result = buildRecordConditionSpec(table, filter, [
      { fieldId: statusId, visibleWhen: neverVisible },
    ]);
    expect(result.isOk()).toBe(true);
    // SQL: COALESCE(NULL, '') NOT IN ('') = false.
    expect(result._unsafeUnwrap().isSatisfiedBy(hiddenRecord)).toBe(false);
  });
});
