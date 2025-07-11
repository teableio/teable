import type { INestApplication } from '@nestjs/common';
import type { IFieldVo, ISelectFieldChoice, ISelectFieldOptions } from '@teable/core';
import { FieldType, ViewType, SortFunc, Colors } from '@teable/core';
import {
  createTable,
  createView,
  deleteField,
  permanentDeleteTable,
  initApp,
  getViews,
  convertField,
} from './utils/init-app';

describe('OpenAPI FieldController (e2e)', () => {
  let app: INestApplication;
  const baseId = globalThis.testConfig.baseId;
  let tableId: string;
  let fields: IFieldVo[];

  beforeAll(async () => {
    const appCtx = await initApp();
    app = appCtx.app;
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    const { id, fields: fieldsVo } = await createTable(baseId, { name: 'table' });
    tableId = id;
    fields = fieldsVo;
  });
  afterEach(async () => {
    await permanentDeleteTable(baseId, tableId);
  });

  it('should delete relative view conditions when deleting a field', async () => {
    const numberField = fields.find(({ type }) => type === FieldType.Number) as IFieldVo;

    const statusField = fields.find(({ type }) => type === FieldType.SingleSelect) as IFieldVo;

    // create all views with some view conditions
    const gridView = await createView(tableId, {
      type: ViewType.Grid,
      filter: {
        conjunction: 'and',
        filterSet: [
          { fieldId: numberField.id, operator: 'isGreater', value: 1 },
          { fieldId: statusField.id, operator: 'is', value: 'done' },
        ],
      },
      sort: {
        sortObjs: [
          { fieldId: numberField.id, order: SortFunc.Asc },
          {
            fieldId: statusField.id,
            order: SortFunc.Asc,
          },
        ],
      },
      group: [
        { fieldId: numberField.id, order: SortFunc.Asc },
        { fieldId: statusField.id, order: SortFunc.Asc },
      ],
    });

    const kanbanView = await createView(tableId, {
      type: ViewType.Kanban,
      options: {
        stackFieldId: statusField.id,
      },
      filter: {
        conjunction: 'and',
        filterSet: [
          { fieldId: numberField.id, operator: 'isGreater', value: 1 },
          { fieldId: statusField.id, operator: 'is', value: 'done' },
        ],
      },
      group: [
        { fieldId: numberField.id, order: SortFunc.Asc },
        { fieldId: statusField.id, order: SortFunc.Asc },
      ],
    });

    const formView = await createView(tableId, {
      type: ViewType.Form,
    });

    // delete the used field
    await deleteField(tableId, numberField.id);

    // get all views
    const views = await getViews(tableId);

    const gridViewAfterDelete = views.find(({ id }) => id === gridView.id);

    const kanbanViewAfterDelete = views.find(({ id }) => id === kanbanView.id);

    const formViewAfterDelete = views.find(({ id }) => id === formView.id);

    // should delete the view conditions relative to the field
    expect(gridViewAfterDelete).toEqual({
      ...gridViewAfterDelete,
      filter: {
        conjunction: 'and',
        filterSet: [{ fieldId: statusField.id, operator: 'is', value: 'done' }],
      },
      sort: {
        sortObjs: [
          {
            fieldId: statusField.id,
            order: SortFunc.Asc,
          },
        ],
        manualSort: false,
      },
      group: [
        {
          fieldId: statusField.id,
          order: SortFunc.Asc,
        },
      ],
    });

    expect(kanbanViewAfterDelete).toEqual({
      ...kanbanViewAfterDelete,
      filter: {
        conjunction: 'and',
        filterSet: [{ fieldId: statusField.id, operator: 'is', value: 'done' }],
      },
      group: [
        {
          fieldId: statusField.id,
          order: SortFunc.Asc,
        },
      ],
    });

    expect(formViewAfterDelete?.columnMeta).not.haveOwnProperty(numberField.id);
  });

  it('should sync the selected value after update select type field option name', async () => {
    const statusField = fields.find(({ type }) => type === FieldType.SingleSelect) as IFieldVo;
    const defaultSelectValue = (statusField.options as ISelectFieldOptions)?.choices[0].name;

    // create all views with some view conditions
    const gridView = await createView(tableId, {
      type: ViewType.Grid,
      filter: {
        conjunction: 'and',
        filterSet: [
          {
            fieldId: statusField.id,
            operator: 'is',
            value: defaultSelectValue,
          },
        ],
      },
    });

    await convertField(tableId, statusField.id, {
      name: statusField.name,
      dbFieldName: statusField.dbFieldName,
      type: statusField.type,
      options: {
        choices: [
          { id: (statusField.options as ISelectFieldOptions)?.choices[0].id, name: 'newName' },
          { ...(statusField.options as ISelectFieldOptions)?.choices[1] },
          { ...(statusField.options as ISelectFieldOptions)?.choices[2] },
        ],
      },
    });

    // get all views
    const views = await getViews(tableId);

    const gridViewAfterChange = views.find(({ id }) => id === gridView.id);

    expect(gridViewAfterChange).toEqual({
      ...gridViewAfterChange,
      filter: {
        conjunction: 'and',
        filterSet: [{ fieldId: statusField.id, operator: 'is', value: 'newName' }],
      },
    });
  });

  it('should delete filter item when the field convert to another field type', async () => {
    const numberField = fields.find(({ type }) => type === FieldType.Number) as IFieldVo;
    const selectField = fields.find(({ type }) => type === FieldType.SingleSelect) as IFieldVo;

    // create all views with some view conditions
    const gridView = await createView(tableId, {
      type: ViewType.Grid,
      filter: {
        conjunction: 'and',
        filterSet: [
          { fieldId: numberField.id, operator: 'isGreater', value: 1 },
          {
            fieldId: selectField.id,
            operator: 'is',
            value: (selectField.options as ISelectFieldOptions)?.choices[0].name,
          },
        ],
      },
    });

    // number field convert to text field
    await convertField(tableId, numberField.id, {
      name: numberField.name,
      dbFieldName: numberField.dbFieldName,
      type: FieldType.SingleLineText,
      options: {},
    });

    const views = await getViews(tableId);

    const gridViewAfterChange = views.find(({ id }) => id === gridView.id);

    expect(gridViewAfterChange).toEqual({
      ...gridViewAfterChange,
      filter: {
        conjunction: 'and',
        filterSet: [
          {
            fieldId: selectField.id,
            operator: 'is',
            value: (selectField.options as ISelectFieldOptions)?.choices[0].name,
          },
        ],
      },
    });
  });

  it('should still intact for filter condition when add select option', async () => {
    const numberField = fields.find(({ type }) => type === FieldType.Number) as IFieldVo;
    const selectField = fields.find(({ type }) => type === FieldType.SingleSelect) as IFieldVo;

    // create all views with some view conditions
    const gridView = await createView(tableId, {
      type: ViewType.Grid,
      filter: {
        conjunction: 'and',
        filterSet: [
          { fieldId: numberField.id, operator: 'isGreater', value: 1 },
          {
            fieldId: selectField.id,
            operator: 'is',
            value: (selectField.options as ISelectFieldOptions)?.choices[0].name,
          },
        ],
      },
    });

    const newChoices = [
      ...(selectField.options as ISelectFieldOptions).choices,
    ] as Partial<ISelectFieldChoice>[];

    newChoices.push({ name: 'test-add-choice', color: Colors.YellowLight2 });

    // number field convert to text field
    await convertField(tableId, selectField.id, {
      name: selectField.name,
      dbFieldName: selectField.dbFieldName,
      type: FieldType.SingleSelect,
      options: {
        ...selectField.options,
        choices: newChoices,
      },
    });

    const views = await getViews(tableId);

    const gridViewAfterChange = views.find(({ id }) => id === gridView.id);

    expect(gridViewAfterChange?.filter).toEqual({
      conjunction: 'and',
      filterSet: [
        { fieldId: numberField.id, operator: 'isGreater', value: 1 },
        {
          fieldId: selectField.id,
          operator: 'is',
          value: (selectField.options as ISelectFieldOptions)?.choices[0].name,
        },
      ],
    });
  });
});
