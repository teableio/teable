import { describe, it } from 'vitest';

import { BaseId } from '../base/BaseId';
import { FieldName } from './fields/FieldName';
import { SelectOption } from './fields/types/SelectOption';
import { NoopFieldVisitor } from './fields/visitors/NoopFieldVisitor';
import { Table } from './Table';
import { TableName } from './TableName';
import { NoopViewVisitor } from './views/visitors/NoopViewVisitor';

const buildTable = () => {
  const baseId = BaseId.create(`bse${'v'.repeat(16)}`)._unsafeUnwrap();
  const tableName = TableName.create('Visitor Table')._unsafeUnwrap();

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
  [todoOptionResult, doneOptionResult].forEach((r) => r._unsafeUnwrap());

  const builder = Table.builder().withBaseId(baseId).withName(tableName);
  builder.field().singleLineText().withName(titleName).done();
  builder.field().longText().withName(descriptionName).done();
  builder.field().number().withName(amountName).done();
  builder.field().rating().withName(ratingName).done();
  builder
    .field()
    .singleSelect()
    .withName(statusName)
    .withOptions([todoOptionResult._unsafeUnwrap(), doneOptionResult._unsafeUnwrap()])
    .done();
  builder
    .field()
    .multipleSelect()
    .withName(tagsName)
    .withOptions([todoOptionResult._unsafeUnwrap(), doneOptionResult._unsafeUnwrap()])
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

  return builder.build()._unsafeUnwrap();
};

describe('Noop visitors', () => {
  it('accepts all field visitors', () => {
    const table = buildTable();

    const visitor = new NoopFieldVisitor();
    const results = table.getFields().map((field) => field.accept(visitor));
    results.forEach((result) => result._unsafeUnwrap());
  });

  it('accepts all view visitors', () => {
    const table = buildTable();

    const visitor = new NoopViewVisitor();
    const results = table.views().map((view) => view.accept(visitor));
    results.forEach((result) => result._unsafeUnwrap());
  });
});
