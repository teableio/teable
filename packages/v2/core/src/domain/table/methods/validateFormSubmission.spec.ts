import { describe, expect, it } from 'vitest';

import { BaseId } from '../../base/BaseId';
import { FieldId } from '../fields/FieldId';
import { FieldName } from '../fields/FieldName';
import { Table } from '../Table';
import { TableId } from '../TableId';
import { TableName } from '../TableName';
import { ViewColumnMeta } from '../views/ViewColumnMeta';
import { ViewType } from '../views/ViewType';
import { CloneViewVisitor } from '../views/visitors/CloneViewVisitor';

const createTestTable = () => {
  const baseId = BaseId.create(`bse${'a'.repeat(16)}`)._unsafeUnwrap();
  const tableId = TableId.create(`tbl${'b'.repeat(16)}`)._unsafeUnwrap();
  const tableName = TableName.create('Form Validation Table')._unsafeUnwrap();
  const textFieldId = FieldId.create(`fld${'c'.repeat(16)}`)._unsafeUnwrap();
  const hiddenFieldId = FieldId.create(`fld${'d'.repeat(16)}`)._unsafeUnwrap();

  const builder = Table.builder().withBaseId(baseId).withId(tableId).withName(tableName);
  builder
    .field()
    .singleLineText()
    .withId(textFieldId)
    .withName(FieldName.create('Title')._unsafeUnwrap())
    .primary()
    .done();
  builder
    .field()
    .button()
    .withId(hiddenFieldId)
    .withName(FieldName.create('Hidden Button')._unsafeUnwrap())
    .done();
  builder.view().defaultGrid().done();
  builder.view().form().defaultName().done();

  const table = builder.build()._unsafeUnwrap();
  const gridView = table.views().find((view) => view.type().equals(ViewType.grid()));
  const formView = table.views().find((view) => view.type().equals(ViewType.form()));

  if (!gridView || !formView) {
    throw new Error('Expected both grid and form views');
  }

  return {
    table,
    textFieldId: textFieldId.toString(),
    hiddenFieldId: hiddenFieldId.toString(),
    gridViewId: gridView.id().toString(),
    formViewId: formView.id().toString(),
  };
};

const withFormRequiredFields = (
  table: Table,
  formViewId: string,
  requiredFieldIds: ReadonlyArray<string>
): Table => {
  const nextViews = table.views().map((view) => {
    const clone = view.accept(new CloneViewVisitor())._unsafeUnwrap();
    const columnMeta = view.columnMeta()._unsafeUnwrap().toDto();

    if (view.id().toString() === formViewId) {
      for (const fieldId of requiredFieldIds) {
        const previous = columnMeta[fieldId] ?? {};
        columnMeta[fieldId] = {
          ...previous,
          visible: true,
          required: true,
        };
      }
    }

    clone.setColumnMeta(ViewColumnMeta.create(columnMeta)._unsafeUnwrap())._unsafeUnwrap();
    clone.setQueryDefaults(view.queryDefaults()._unsafeUnwrap())._unsafeUnwrap();
    return clone;
  });

  return Table.rehydrate({
    id: table.id(),
    baseId: table.baseId(),
    name: table.name(),
    fields: table.getFields(),
    views: nextViews,
    primaryFieldId: table.primaryFieldId(),
  })._unsafeUnwrap();
};

describe('Table.validateFormSubmission', () => {
  it('passes for form view with visible fields only', () => {
    const { table, textFieldId, formViewId } = createTestTable();

    const result = table.validateFormSubmission(
      formViewId,
      new Map([[textFieldId, 'submitted from form']])
    );

    expect(result.isOk()).toBe(true);
  });

  it('fails when view is not form type', () => {
    const { table, textFieldId, gridViewId } = createTestTable();

    const result = table.validateFormSubmission(gridViewId, new Map([[textFieldId, 'invalid']]));
    const error = result._unsafeUnwrapErr();

    expect(error.tags).toContain('forbidden');
    expect(error.code).toBe('view.type_not_form');
  });

  it('fails when submitted field is hidden in form view', () => {
    const { table, hiddenFieldId, formViewId } = createTestTable();

    const result = table.validateFormSubmission(formViewId, new Map([[hiddenFieldId, 'hidden']]));
    const error = result._unsafeUnwrapErr();

    expect(error.tags).toContain('forbidden');
    expect(error.code).toBe('view.hidden_fields_submission_not_allowed');
  });

  it('fails when required form field is missing', () => {
    const { table, textFieldId, formViewId } = createTestTable();
    const tableWithRequiredField = withFormRequiredFields(table, formViewId, [textFieldId]);

    const result = tableWithRequiredField.validateFormSubmission(formViewId, new Map());
    const error = result._unsafeUnwrapErr();

    expect(error.tags).toContain('validation');
    expect(error.code).toBe('view.required_fields_missing');
    expect(error.details).toEqual({
      missingFieldIds: [textFieldId],
    });
  });

  it('passes when required form field is provided', () => {
    const { table, textFieldId, formViewId } = createTestTable();
    const tableWithRequiredField = withFormRequiredFields(table, formViewId, [textFieldId]);

    const result = tableWithRequiredField.validateFormSubmission(
      formViewId,
      new Map([[textFieldId, 'provided']])
    );

    expect(result.isOk()).toBe(true);
  });
});
