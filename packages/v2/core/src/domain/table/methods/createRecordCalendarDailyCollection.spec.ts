import { describe, expect, it } from 'vitest';

import { BaseId } from '../../base/BaseId';
import { FieldId } from '../fields/FieldId';
import { FieldName } from '../fields/FieldName';
import {
  DateFormattingPreset,
  DateTimeFormatting,
  TimeFormatting,
} from '../fields/types/DateTimeFormatting';
import { Table } from '../Table';
import { TableId } from '../TableId';
import { TableName } from '../TableName';

const createTable = () => {
  const nameId = FieldId.create(`fld${'n'.repeat(16)}`)._unsafeUnwrap();
  const startId = FieldId.create(`fld${'s'.repeat(16)}`)._unsafeUnwrap();
  const endId = FieldId.create(`fld${'e'.repeat(16)}`)._unsafeUnwrap();
  const hiddenDateId = FieldId.create(`fld${'h'.repeat(16)}`)._unsafeUnwrap();
  const formatting = DateTimeFormatting.create({
    date: DateFormattingPreset.ISO,
    time: TimeFormatting.Hour24,
    timeZone: 'Asia/Singapore',
  })._unsafeUnwrap();
  const builder = Table.builder()
    .withBaseId(BaseId.create(`bse${'a'.repeat(16)}`)._unsafeUnwrap())
    .withId(TableId.create(`tbl${'c'.repeat(16)}`)._unsafeUnwrap())
    .withName(TableName.create('Calendar')._unsafeUnwrap());
  builder
    .field()
    .singleLineText()
    .withId(nameId)
    .withName(FieldName.create('Name')._unsafeUnwrap())
    .primary()
    .done();
  for (const [id, name] of [
    [startId, 'Start'],
    [endId, 'End'],
    [hiddenDateId, 'Hidden date'],
  ] as const) {
    builder
      .field()
      .date()
      .withId(id)
      .withName(FieldName.create(name)._unsafeUnwrap())
      .withFormatting(formatting)
      .done();
  }
  builder.view().calendar().defaultName().done();
  let table = builder.build()._unsafeUnwrap();
  const viewId = table.defaultView()._unsafeUnwrap().id();
  table = table
    .updateViewOptions(viewId, {
      startDateFieldId: startId.toString(),
      endDateFieldId: endId.toString(),
      titleFieldId: nameId.toString(),
    })
    ._unsafeUnwrap().updateResult!.table;
  table = table
    .updateViewColumnMeta(viewId, [
      { fieldId: startId, columnMeta: { visible: false } },
      { fieldId: endId, columnMeta: { visible: false } },
      { fieldId: hiddenDateId, columnMeta: { visible: false } },
    ])
    ._unsafeUnwrap().updateResult!.table;
  return { table, viewId, nameId, startId, endId, hiddenDateId };
};

describe('Table.createRecordCalendarDailyCollection', () => {
  it('derives scalar date fields and timezone inside the Table aggregate', () => {
    const { table, viewId, startId, endId } = createTable();

    const calendar = table
      .createRecordCalendarDailyCollection({
        viewId: viewId.toString(),
        startFieldId: startId.toString(),
        endFieldId: endId.toString(),
      })
      ._unsafeUnwrap();

    expect(calendar.startFieldId.equals(startId)).toBe(true);
    expect(calendar.endFieldId.equals(endId)).toBe(true);
    expect(calendar.timeZone.toString()).toBe('Asia/Singapore');
  });

  it('treats Calendar option fields as visible even when column metadata says otherwise', () => {
    const { table, viewId, nameId, startId, endId, hiddenDateId } = createTable();

    expect(table.getOrderedVisibleFieldIds(viewId.toString())._unsafeUnwrap().map(String)).toEqual([
      nameId.toString(),
      startId.toString(),
      endId.toString(),
    ]);
    expect(
      table
        .createRecordCalendarDailyCollection({
          viewId: viewId.toString(),
          startFieldId: startId.toString(),
          endFieldId: endId.toString(),
        })
        .isOk()
    ).toBe(true);
    expect(hiddenDateId.toString()).not.toBe(startId.toString());
  });

  it('falls back to the start field when the end field is omitted', () => {
    const { table, viewId, startId } = createTable();
    const calendar = table
      .createRecordCalendarDailyCollection({
        viewId: viewId.toString(),
        startFieldId: startId.toString(),
      })
      ._unsafeUnwrap();

    expect(calendar.endFieldId.equals(startId)).toBe(true);
  });

  it('rejects hidden, missing, and non-date target fields without includeHiddenFields', () => {
    const { table, viewId, nameId, startId, hiddenDateId } = createTable();

    expect(
      table
        .createRecordCalendarDailyCollection({
          viewId: viewId.toString(),
          startFieldId: hiddenDateId.toString(),
        })
        ._unsafeUnwrapErr()
    ).toMatchObject({ code: 'calendar.field_hidden', tags: ['forbidden'] });
    expect(
      table
        .createRecordCalendarDailyCollection({
          viewId: viewId.toString(),
          startFieldId: nameId.toString(),
        })
        ._unsafeUnwrapErr()
    ).toMatchObject({ code: 'calendar.invalid_start_field', tags: ['validation'] });
    expect(
      table
        .createRecordCalendarDailyCollection({
          viewId: viewId.toString(),
          startFieldId: startId.toString(),
          endFieldId: `fld${'x'.repeat(16)}`,
        })
        ._unsafeUnwrapErr()
    ).toMatchObject({ code: 'calendar.invalid_end_field' });
    expect(
      table
        .createRecordCalendarDailyCollection({
          viewId: viewId.toString(),
          startFieldId: hiddenDateId.toString(),
          includeHiddenFields: true,
        })
        .isOk()
    ).toBe(true);
  });
});
