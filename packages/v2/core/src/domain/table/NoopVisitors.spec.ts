import { describe, expect, it } from 'vitest';

import { BaseId } from '../base/BaseId';
import { FieldName } from './fields/FieldName';
import { SelectOption } from './fields/types/SelectOption';
import { NoopFieldVisitor } from './fields/visitors/NoopFieldVisitor';
import { Table } from './Table';
import { TableName } from './TableName';
import { NoopViewVisitor } from './views/visitors/NoopViewVisitor';

const buildTable = () => {
  const baseIdResult = BaseId.create(`bse${'v'.repeat(16)}`);
  const tableNameResult = TableName.create('Visitor Table');
  expect([baseIdResult, tableNameResult].every((r) => r.isOk())).toBe(true);
  if (baseIdResult.isErr() || tableNameResult.isErr()) return undefined;

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
  if (namesResult.some((r) => r.isErr())) return undefined;

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
  if (todoOptionResult.isErr() || doneOptionResult.isErr()) return undefined;

  const builder = Table.builder().withBaseId(baseIdResult.value).withName(tableNameResult.value);
  builder.field().singleLineText().withName(titleName).done();
  builder.field().longText().withName(descriptionName).done();
  builder.field().number().withName(amountName).done();
  builder.field().rating().withName(ratingName).done();
  builder
    .field()
    .singleSelect()
    .withName(statusName)
    .withOptions([todoOptionResult.value, doneOptionResult.value])
    .done();
  builder
    .field()
    .multipleSelect()
    .withName(tagsName)
    .withOptions([todoOptionResult.value, doneOptionResult.value])
    .done();
  builder.field().checkbox().withName(doneName).done();
  builder.field().attachment().withName(filesName).done();
  builder.field().date().withName(dueDateName).done();
  builder.field().user().withName(ownerName).done();
  builder.field().button().withName(actionName).done();
  builder.view().defaultGrid().done();
  builder.view().kanban().defaultName().done();
  builder.view().calendar().defaultName().done();
  builder.view().gallery().defaultName().done();
  builder.view().form().defaultName().done();
  builder.view().plugin().defaultName().done();

  const result = builder.build();
  expect(result.isOk()).toBe(true);
  if (result.isErr()) return undefined;
  return result.value;
};

describe('Noop visitors', () => {
  it('accepts all field visitors', () => {
    const table = buildTable();
    if (!table) return;

    const visitor = new NoopFieldVisitor();
    const results = table.fields().map((field) => field.accept(visitor));
    expect(results.every((result) => result.isOk())).toBe(true);
  });

  it('accepts all view visitors', () => {
    const table = buildTable();
    if (!table) return;

    const visitor = new NoopViewVisitor();
    const results = table.views().map((view) => view.accept(visitor));
    expect(results.every((result) => result.isOk())).toBe(true);
  });
});
