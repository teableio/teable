import { describe, expect, it } from 'vitest';

import { BaseId } from '../base/BaseId';
import { FieldId } from './fields/FieldId';
import { FieldName } from './fields/FieldName';
import { RatingMax } from './fields/types/RatingMax';
import { SelectOption } from './fields/types/SelectOption';
import { Table } from './Table';
import { TableId } from './TableId';
import { TableName } from './TableName';
import { ViewName } from './views/ViewName';

const createBaseId = (seed: string) => BaseId.create(`bse${seed.repeat(16)}`);
const createTableId = (seed: string) => TableId.create(`tbl${seed.repeat(16)}`);
const createFieldId = (seed: string) => FieldId.create(`fld${seed.repeat(16)}`);

describe('TableBuilder', () => {
  it('builds a table with fields and a view', () => {
    const baseIdResult = BaseId.create(`bse${'a'.repeat(16)}`);
    const tableNameResult = TableName.create('My Table');
    expect([baseIdResult, tableNameResult].every((r) => r.isOk())).toBe(true);
    if (baseIdResult.isErr() || tableNameResult.isErr()) return;

    const titleNameResult = FieldName.create('Title');
    const amountNameResult = FieldName.create('Amount');
    const starsNameResult = FieldName.create('Stars');
    const statusNameResult = FieldName.create('Status');
    expect(
      [titleNameResult, amountNameResult, starsNameResult, statusNameResult].every((r) => r.isOk())
    ).toBe(true);
    if (
      titleNameResult.isErr() ||
      amountNameResult.isErr() ||
      starsNameResult.isErr() ||
      statusNameResult.isErr()
    )
      return;

    const todoOptionResult = SelectOption.create({ name: 'Todo', color: 'blue' });
    const doneOptionResult = SelectOption.create({ name: 'Done', color: 'red' });
    expect([todoOptionResult, doneOptionResult].every((r) => r.isOk())).toBe(true);
    if (todoOptionResult.isErr() || doneOptionResult.isErr()) return;

    const builder = Table.builder().withBaseId(baseIdResult.value).withName(tableNameResult.value);
    builder.field().singleLineText().withName(titleNameResult.value).done();
    builder.field().number().withName(amountNameResult.value).done();
    builder.field().rating().withName(starsNameResult.value).withMax(RatingMax.five()).done();
    builder
      .field()
      .singleSelect()
      .withName(statusNameResult.value)
      .withOptions([todoOptionResult.value, doneOptionResult.value])
      .done();
    builder.view().defaultGrid().done();

    const buildResult = builder.build();

    expect(buildResult.isOk()).toBe(true);
    if (buildResult.isErr()) return;

    const table = buildResult.value;
    expect(table.fields().length).toBe(4);
    expect(table.views().length).toBe(1);
    expect(table.views()[0]?.type().toString()).toBe('grid');
    expect(table.primaryFieldId().equals(table.fields()[0].id())).toBe(true);
  });

  it('builds a table with all base field types', () => {
    const baseIdResult = BaseId.create(`bse${'f'.repeat(16)}`);
    const tableNameResult = TableName.create('All Fields');
    expect([baseIdResult, tableNameResult].every((r) => r.isOk())).toBe(true);
    if (baseIdResult.isErr() || tableNameResult.isErr()) return;

    const namesResult = [
      FieldName.create('Title'),
      FieldName.create('Description'),
      FieldName.create('Amount'),
      FieldName.create('Rating'),
      FieldName.create('Status'),
      FieldName.create('Tags'),
      FieldName.create('Done'),
      FieldName.create('Files'),
      FieldName.create('Due Date'),
      FieldName.create('Owner'),
      FieldName.create('Action'),
    ];
    expect(namesResult.every((r) => r.isOk())).toBe(true);
    if (namesResult.some((r) => r.isErr())) return;

    const [
      titleName,
      descriptionName,
      amountName,
      ratingName,
      statusName,
      tagsName,
      doneName,
      filesName,
      dueDateName,
      ownerName,
      actionName,
    ] = namesResult.map((r) => r._unsafeUnwrap());

    const todoOptionResult = SelectOption.create({ name: 'Todo', color: 'blue' });
    const doneOptionResult = SelectOption.create({ name: 'Done', color: 'red' });
    expect([todoOptionResult, doneOptionResult].every((r) => r.isOk())).toBe(true);
    if (todoOptionResult.isErr() || doneOptionResult.isErr()) return;

    const todoOption = todoOptionResult.value;
    const doneOption = doneOptionResult.value;

    const builder = Table.builder().withBaseId(baseIdResult.value).withName(tableNameResult.value);
    builder.field().singleLineText().withName(titleName).done();
    builder.field().longText().withName(descriptionName).done();
    builder.field().number().withName(amountName).done();
    builder.field().rating().withName(ratingName).withMax(RatingMax.five()).done();
    builder
      .field()
      .singleSelect()
      .withName(statusName)
      .withOptions([todoOption, doneOption])
      .done();
    builder
      .field()
      .multipleSelect()
      .withName(tagsName)
      .withOptions([todoOption, doneOption])
      .done();
    builder.field().checkbox().withName(doneName).done();
    builder.field().attachment().withName(filesName).done();
    builder.field().date().withName(dueDateName).done();
    builder.field().user().withName(ownerName).done();
    builder.field().button().withName(actionName).done();
    builder.view().defaultGrid().done();

    const buildResult = builder.build();
    expect(buildResult.isOk()).toBe(true);
    if (buildResult.isErr()) return;

    const table = buildResult.value;
    expect(table.fields().map((f) => f.type().toString())).toEqual([
      'singleLineText',
      'longText',
      'number',
      'rating',
      'singleSelect',
      'multipleSelect',
      'checkbox',
      'attachment',
      'date',
      'user',
      'button',
    ]);
  });

  it('supports multiple view types', () => {
    const baseIdResult = BaseId.create(`bse${'b'.repeat(16)}`);
    const tableNameResult = TableName.create('My Table');
    const titleNameResult = FieldName.create('Title');
    expect([baseIdResult, tableNameResult, titleNameResult].every((r) => r.isOk())).toBe(true);
    if (baseIdResult.isErr() || tableNameResult.isErr() || titleNameResult.isErr()) return;

    const builder = Table.builder().withBaseId(baseIdResult.value).withName(tableNameResult.value);
    builder.field().singleLineText().withName(titleNameResult.value).done();
    builder.view().defaultGrid().done();
    builder.view().kanban().defaultName().done();
    builder.view().calendar().defaultName().done();
    builder.view().gallery().defaultName().done();
    builder.view().form().defaultName().done();
    builder.view().plugin().defaultName().done();

    const buildResult = builder.build();
    expect(buildResult.isOk()).toBe(true);
    if (buildResult.isErr()) return;

    expect(buildResult.value.views().map((v) => v.type().toString())).toEqual([
      'grid',
      'kanban',
      'calendar',
      'gallery',
      'form',
      'plugin',
    ]);
  });

  it('allows setting a non-first field as primary', () => {
    const baseIdResult = BaseId.create(`bse${'c'.repeat(16)}`);
    const tableNameResult = TableName.create('My Table');
    const titleNameResult = FieldName.create('Title');
    const amountNameResult = FieldName.create('Amount');
    expect(
      [baseIdResult, tableNameResult, titleNameResult, amountNameResult].every((r) => r.isOk())
    ).toBe(true);
    if (
      baseIdResult.isErr() ||
      tableNameResult.isErr() ||
      titleNameResult.isErr() ||
      amountNameResult.isErr()
    )
      return;

    const builder = Table.builder().withBaseId(baseIdResult.value).withName(tableNameResult.value);
    builder.field().singleLineText().withName(titleNameResult.value).done();
    builder.field().number().withName(amountNameResult.value).primary().done();
    builder.view().defaultGrid().done();

    const buildResult = builder.build();
    expect(buildResult.isOk()).toBe(true);
    if (buildResult.isErr()) return;

    const table = buildResult.value;
    expect(table.primaryFieldId().equals(table.fields()[1].id())).toBe(true);
  });

  it('rejects multiple primary fields', () => {
    const baseIdResult = BaseId.create(`bse${'d'.repeat(16)}`);
    const tableNameResult = TableName.create('My Table');
    const titleNameResult = FieldName.create('Title');
    const amountNameResult = FieldName.create('Amount');
    expect(
      [baseIdResult, tableNameResult, titleNameResult, amountNameResult].every((r) => r.isOk())
    ).toBe(true);
    if (
      baseIdResult.isErr() ||
      tableNameResult.isErr() ||
      titleNameResult.isErr() ||
      amountNameResult.isErr()
    )
      return;

    const builder = Table.builder().withBaseId(baseIdResult.value).withName(tableNameResult.value);
    builder.field().singleLineText().withName(titleNameResult.value).primary().done();
    builder.field().number().withName(amountNameResult.value).primary().done();
    builder.view().defaultGrid().done();

    const buildResult = builder.build();
    expect(buildResult.isErr()).toBe(true);
    if (buildResult.isOk()) return;
    expect(buildResult.error).toContain('primary');
  });

  it('requires at least one field', () => {
    const baseIdResult = BaseId.create(`bse${'e'.repeat(16)}`);
    const tableNameResult = TableName.create('My Table');
    expect([baseIdResult, tableNameResult].every((r) => r.isOk())).toBe(true);
    if (baseIdResult.isErr() || tableNameResult.isErr()) return;

    const buildResult = Table.builder()
      .withBaseId(baseIdResult.value)
      .withName(tableNameResult.value)
      .view()
      .defaultGrid()
      .done()
      .build();
    expect(buildResult.isErr()).toBe(true);
    if (buildResult.isOk()) return;
    expect(buildResult.error).toContain('at least one Field');
  });

  it('requires a base id', () => {
    const tableNameResult = TableName.create('My Table');
    expect(tableNameResult.isOk()).toBe(true);
    if (tableNameResult.isErr()) return;

    const buildResult = Table.builder()
      .withName(tableNameResult.value)
      .view()
      .defaultGrid()
      .done()
      .build();

    expect(buildResult.isErr()).toBe(true);
    if (buildResult.isOk()) return;
    expect(buildResult.error).toContain('BaseId is required');
  });

  it('requires a table name', () => {
    const baseIdResult = createBaseId('f');
    const fieldNameResult = FieldName.create('Title');
    expect([baseIdResult, fieldNameResult].every((r) => r.isOk())).toBe(true);
    if (baseIdResult.isErr() || fieldNameResult.isErr()) return;

    const buildResult = Table.builder()
      .withBaseId(baseIdResult.value)
      .field()
      .singleLineText()
      .withName(fieldNameResult.value)
      .done()
      .view()
      .defaultGrid()
      .done()
      .build();

    expect(buildResult.isErr()).toBe(true);
    if (buildResult.isOk()) return;
    expect(buildResult.error).toContain('TableName is required');
  });

  it('requires at least one view', () => {
    const baseIdResult = createBaseId('g');
    const tableNameResult = TableName.create('No Views');
    const fieldNameResult = FieldName.create('Title');
    expect([baseIdResult, tableNameResult, fieldNameResult].every((r) => r.isOk())).toBe(true);
    if (baseIdResult.isErr() || tableNameResult.isErr() || fieldNameResult.isErr()) return;

    const buildResult = Table.builder()
      .withBaseId(baseIdResult.value)
      .withName(tableNameResult.value)
      .field()
      .singleLineText()
      .withName(fieldNameResult.value)
      .done()
      .build();

    expect(buildResult.isErr()).toBe(true);
    if (buildResult.isOk()) return;
    expect(buildResult.error).toContain('at least one View');
  });

  it('rejects duplicate field names', () => {
    const baseIdResult = createBaseId('h');
    const tableNameResult = TableName.create('Duplicate Fields');
    const fieldNameResult = FieldName.create('Title');
    expect([baseIdResult, tableNameResult, fieldNameResult].every((r) => r.isOk())).toBe(true);
    if (baseIdResult.isErr() || tableNameResult.isErr() || fieldNameResult.isErr()) return;

    const builder = Table.builder().withBaseId(baseIdResult.value).withName(tableNameResult.value);
    builder.field().singleLineText().withName(fieldNameResult.value).done();
    builder.field().number().withName(fieldNameResult.value).done();
    builder.view().defaultGrid().done();

    const buildResult = builder.build();
    expect(buildResult.isErr()).toBe(true);
    if (buildResult.isOk()) return;
    expect(buildResult.error).toContain('Field names must be unique');
  });

  it('rejects duplicate view names', () => {
    const baseIdResult = createBaseId('i');
    const tableNameResult = TableName.create('Duplicate Views');
    const fieldNameResult = FieldName.create('Title');
    const viewNameResult = ViewName.create('Grid');
    expect(
      [baseIdResult, tableNameResult, fieldNameResult, viewNameResult].every((r) => r.isOk())
    ).toBe(true);
    if (
      baseIdResult.isErr() ||
      tableNameResult.isErr() ||
      fieldNameResult.isErr() ||
      viewNameResult.isErr()
    )
      return;

    const builder = Table.builder().withBaseId(baseIdResult.value).withName(tableNameResult.value);
    builder.field().singleLineText().withName(fieldNameResult.value).done();
    builder.view().grid().withName(viewNameResult.value).done();
    builder.view().kanban().withName(viewNameResult.value).done();

    const buildResult = builder.build();
    expect(buildResult.isErr()).toBe(true);
    if (buildResult.isOk()) return;
    expect(buildResult.error).toContain('View names must be unique');
  });

  it('captures missing field and view names', () => {
    const baseIdResult = createBaseId('j');
    const tableNameResult = TableName.create('Missing Names');
    const fieldNameResult = FieldName.create('Title');
    expect([baseIdResult, tableNameResult, fieldNameResult].every((r) => r.isOk())).toBe(true);
    if (baseIdResult.isErr() || tableNameResult.isErr() || fieldNameResult.isErr()) return;

    const builder = Table.builder().withBaseId(baseIdResult.value).withName(tableNameResult.value);
    builder.field().number().done();
    builder.view().grid().done();
    builder.field().singleLineText().withName(fieldNameResult.value).done();
    builder.view().defaultGrid().done();

    const buildResult = builder.build();
    expect(buildResult.isErr()).toBe(true);
    if (buildResult.isOk()) return;
    expect(buildResult.error).toContain('FieldName is required');
    expect(buildResult.error).toContain('ViewName is required');
  });

  it('uses provided table id and validates primary field existence', () => {
    const baseIdResult = createBaseId('k');
    const tableIdResult = createTableId('k');
    const tableNameResult = TableName.create('Explicit Id');
    const fieldNameResult = FieldName.create('Title');
    const missingPrimaryIdResult = createFieldId('x');
    expect(
      [baseIdResult, tableIdResult, tableNameResult, fieldNameResult, missingPrimaryIdResult].every(
        (r) => r.isOk()
      )
    ).toBe(true);
    if (
      baseIdResult.isErr() ||
      tableIdResult.isErr() ||
      tableNameResult.isErr() ||
      fieldNameResult.isErr() ||
      missingPrimaryIdResult.isErr()
    )
      return;

    const builder = Table.builder()
      .withId(tableIdResult.value)
      .withBaseId(baseIdResult.value)
      .withName(tableNameResult.value);
    builder.markPrimaryFieldId(missingPrimaryIdResult.value);
    builder.field().singleLineText().withName(fieldNameResult.value).done();
    builder.view().defaultGrid().done();

    const buildResult = builder.build();
    expect(buildResult.isErr()).toBe(true);
    if (buildResult.isOk()) return;
    expect(buildResult.error).toContain('Primary Field must exist');
  });

  it('honors explicit table id on successful build', () => {
    const baseIdResult = createBaseId('l');
    const tableIdResult = createTableId('l');
    const tableNameResult = TableName.create('Explicit Table');
    const fieldNameResult = FieldName.create('Title');
    expect(
      [baseIdResult, tableIdResult, tableNameResult, fieldNameResult].every((r) => r.isOk())
    ).toBe(true);
    if (
      baseIdResult.isErr() ||
      tableIdResult.isErr() ||
      tableNameResult.isErr() ||
      fieldNameResult.isErr()
    )
      return;

    const builder = Table.builder()
      .withId(tableIdResult.value)
      .withBaseId(baseIdResult.value)
      .withName(tableNameResult.value);
    builder.field().singleLineText().withName(fieldNameResult.value).done();
    builder.view().defaultGrid().done();

    const buildResult = builder.build();
    expect(buildResult.isOk()).toBe(true);
    if (buildResult.isErr()) return;
    expect(buildResult.value.id().equals(tableIdResult.value)).toBe(true);
  });
});
