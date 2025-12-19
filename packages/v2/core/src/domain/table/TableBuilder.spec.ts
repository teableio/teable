import { describe, expect, it } from 'vitest';

import { BaseId } from '../base/BaseId';
import { FieldName } from './fields/FieldName';
import { RatingMax } from './fields/types/RatingMax';
import { SelectOptionName } from './fields/types/SelectOptionName';
import { Table } from './Table';
import { TableName } from './TableName';

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

    const todoOptionResult = SelectOptionName.create('Todo');
    const doneOptionResult = SelectOptionName.create('Done');
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
});
