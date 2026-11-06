import type { INestApplication } from '@nestjs/common';
import type {
  IFieldVo,
  IGridColumnMeta,
  ISelectFieldChoice,
  ISelectFieldOptions,
  IFormColumn,
  ILinkFieldOptions,
} from '@teable/core';
import {
  FieldKeyType,
  FieldType,
  ViewType,
  SortFunc,
  Colors,
  StatisticsFunc,
  Relationship,
} from '@teable/core';
import { axios, redo, undo, updateRecords, updateViewSort } from '@teable/openapi';
import {
  ViewSortUpdated,
  v2CoreTokens,
  type IEventBus,
  type IRealtimeEngine,
} from '@teable/v2-core';
import { V2ContainerService } from '../src/features/v2/v2-container.service';
import {
  createTable,
  createField,
  createView,
  deleteField,
  permanentDeleteTable,
  initApp,
  getViews,
  updateViewColumnMeta,
  convertField,
  getRecords,
  getField,
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

    expect(gridViewAfterDelete?.columnMeta).not.haveOwnProperty(numberField.id);

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

    expect(kanbanViewAfterDelete?.columnMeta).not.haveOwnProperty(numberField.id);
    expect(formViewAfterDelete?.columnMeta).not.haveOwnProperty(numberField.id);
  });

  it('should set form column visible after setting field notNull without default', async () => {
    const textField = fields.find(({ type }) => type === FieldType.SingleLineText) as IFieldVo;

    const formView = await createView(tableId, {
      type: ViewType.Form,
      name: 'Form',
    });

    const recordResult = await getRecords(tableId);
    await updateRecords(tableId, {
      fieldKeyType: FieldKeyType.Id,
      records: recordResult.records.map((rec) => ({
        id: rec.id,
        fields: { [textField.id]: 'filled' },
      })),
    });

    await convertField(tableId, textField.id, {
      name: textField.name,
      dbFieldName: textField.dbFieldName,
      type: textField.type,
      options: {},
      notNull: true,
    });

    const views = await getViews(tableId);
    const formAfter = views.find(({ id }) => id === formView.id)!;
    const formColumnMeta = formAfter.columnMeta as unknown as Record<string, IFormColumn>;
    expect(formColumnMeta[textField.id]?.visible ?? false).toBe(true);
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
      } as ISelectFieldOptions,
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

  it('should clear invalid statisticFunc in columnMeta when field type changes', async () => {
    const numberField = fields.find(({ type }) => type === FieldType.Number) as IFieldVo;

    const views = await getViews(tableId);
    const gridView = views.find(({ type }) => type === ViewType.Grid) || views[0];

    await updateViewColumnMeta(tableId, gridView.id, [
      {
        fieldId: numberField.id,
        columnMeta: {
          statisticFunc: StatisticsFunc.Sum,
        },
      },
    ]);

    await convertField(tableId, numberField.id, {
      name: numberField.name,
      dbFieldName: numberField.dbFieldName,
      type: FieldType.SingleLineText,
      options: {},
    });

    const updatedViews = await getViews(tableId);
    const updatedGridView = updatedViews.find(({ id }) => id === gridView.id)!;
    const updatedColumnMeta = updatedGridView.columnMeta as unknown as IGridColumnMeta;
    expect(updatedColumnMeta[numberField.id]?.statisticFunc ?? null).toBe(null);
  });

  it('should remove collation and preserve the rest of the view sort when text becomes number', async () => {
    const numberField = fields.find(({ type }) => type === FieldType.Number) as IFieldVo;
    const textField = await createField(tableId, {
      name: 'Collated text',
      type: FieldType.SingleLineText,
    });
    const gridView = await createView(tableId, {
      type: ViewType.Grid,
      sort: {
        sortObjs: [
          { fieldId: textField.id, order: SortFunc.Desc, collation: 'zh-pinyin' },
          { fieldId: numberField.id, order: SortFunc.Asc },
        ],
        manualSort: false,
      },
    });

    await convertField(tableId, textField.id, { type: FieldType.Number });

    await expect(getRecords(tableId, { viewId: gridView.id })).resolves.toMatchObject({
      records: expect.any(Array),
    });
    const updatedGridView = (await getViews(tableId)).find(({ id }) => id === gridView.id)!;
    expect(updatedGridView.sort).toEqual({
      sortObjs: [
        { fieldId: textField.id, order: SortFunc.Desc },
        { fieldId: numberField.id, order: SortFunc.Asc },
      ],
      manualSort: false,
    });
  });

  it('should preserve cross-table sort settings while cleaning reciprocal collation on conversion', async () => {
    const foreignTable = await createTable(baseId, { name: 'foreign cleanup table' });
    try {
      const foreignNumberField = foreignTable.fields.find(({ type }) => type === FieldType.Number)!;
      const sourceLinkField = await createField(tableId, {
        name: 'Source cleanup link',
        type: FieldType.Link,
        options: {
          relationship: Relationship.OneMany,
          foreignTableId: foreignTable.id,
        },
      });
      const symmetricFieldId = (sourceLinkField.options as ILinkFieldOptions).symmetricFieldId!;
      const view = await createView(foreignTable.id, {
        type: ViewType.Grid,
        sort: {
          sortObjs: [
            { fieldId: symmetricFieldId, order: SortFunc.Desc, collation: 'zh-pinyin' },
            { fieldId: foreignNumberField.id, order: SortFunc.Asc },
          ],
          manualSort: false,
        },
      });

      await convertField(tableId, sourceLinkField.id, {
        type: FieldType.Link,
        options: {
          relationship: Relationship.ManyMany,
          foreignTableId: foreignTable.id,
        },
      });

      expect((await getViews(foreignTable.id)).find(({ id }) => id === view.id)!.sort).toEqual({
        sortObjs: [
          { fieldId: symmetricFieldId, order: SortFunc.Desc },
          { fieldId: foreignNumberField.id, order: SortFunc.Asc },
        ],
        manualSort: false,
      });
      await expect(getRecords(foreignTable.id, { viewId: view.id })).resolves.toMatchObject({
        records: expect.any(Array),
      });
    } finally {
      await permanentDeleteTable(baseId, foreignTable.id);
    }
  });

  it.runIf(process.env.FORCE_V2_ALL === 'true')(
    'should remove collation from a cross-table symmetric link that becomes multiple',
    async () => {
      const foreignTable = await createTable(baseId, { name: 'foreign table' });
      const headers = axios.defaults.headers.common;
      const windowHeader =
        Object.keys(headers).find((key) => key.toLowerCase() === 'x-window-id') ?? 'X-Window-Id';
      const previousWindowId = headers[windowHeader];
      const fieldWindowId = `win-cross-table-collation-${Date.now()}`;
      const container = await app.get(V2ContainerService).getContainerForTable(tableId);
      const eventBus = container.resolve<IEventBus>(v2CoreTokens.eventBus);
      const realtimeEngine = container.resolve<IRealtimeEngine>(v2CoreTokens.realtimeEngine);
      const publishSpy = vi.spyOn(eventBus, 'publishMany');
      const realtimeChangeSpy = vi.spyOn(realtimeEngine, 'applyChange');

      try {
        const foreignNumberField = foreignTable.fields.find(
          ({ type }) => type === FieldType.Number
        ) as IFieldVo;
        const sourceLinkField = await createField(tableId, {
          name: 'Source link',
          type: FieldType.Link,
          options: {
            relationship: Relationship.OneMany,
            foreignTableId: foreignTable.id,
          },
        });
        const symmetricFieldId = (sourceLinkField.options as ILinkFieldOptions).symmetricFieldId!;
        const sourceView = (await getViews(tableId))[0]!;
        await updateViewColumnMeta(tableId, sourceView.id, [
          { fieldId: sourceLinkField.id, columnMeta: { order: 0.5 } },
        ]);
        const fractionalMeta = (await getViews(tableId)).find(({ id }) => id === sourceView.id)!
          .columnMeta as IGridColumnMeta;
        expect(fractionalMeta[sourceLinkField.id]?.order).toBe(0.5);
        const gridView = await createView(foreignTable.id, {
          type: ViewType.Grid,
          sort: {
            sortObjs: [
              { fieldId: symmetricFieldId, order: SortFunc.Desc, collation: 'zh-pinyin' },
              { fieldId: foreignNumberField.id, order: SortFunc.Asc },
            ],
            manualSort: true,
          },
          group: [{ fieldId: symmetricFieldId, order: SortFunc.Asc }],
        });
        const originalView = (await getViews(foreignTable.id)).find(
          ({ id }) => id === gridView.id
        )!;
        const originalSort = originalView.sort;
        const originalGroup = originalView.group;
        expect(originalGroup).toEqual([{ fieldId: symmetricFieldId, order: SortFunc.Asc }]);
        headers[windowHeader] = fieldWindowId;

        await convertField(tableId, sourceLinkField.id, {
          type: FieldType.Link,
          options: {
            relationship: Relationship.ManyMany,
            foreignTableId: foreignTable.id,
          },
        });

        await expect(getRecords(foreignTable.id, { viewId: gridView.id })).resolves.toMatchObject({
          records: expect.any(Array),
        });
        const cleanedSort = {
          sortObjs: [
            { fieldId: symmetricFieldId, order: SortFunc.Desc },
            { fieldId: foreignNumberField.id, order: SortFunc.Asc },
          ],
          manualSort: true,
        };
        let updatedGridView = (await getViews(foreignTable.id)).find(
          ({ id }) => id === gridView.id
        )!;
        expect(updatedGridView.sort).toEqual(cleanedSort);
        expect(updatedGridView.group).toEqual(originalGroup);
        publishSpy.mockClear();
        realtimeChangeSpy.mockClear();

        const undoResult = (await undo(tableId)).data;
        expect(undoResult.status, JSON.stringify(undoResult)).toBe('fulfilled');
        expect(
          ((await getField(tableId, sourceLinkField.id)).options as ILinkFieldOptions).relationship
        ).toBe(Relationship.OneMany);
        expect(
          ((await getField(foreignTable.id, symmetricFieldId)).options as ILinkFieldOptions)
            .relationship
        ).toBe(Relationship.ManyOne);
        updatedGridView = (await getViews(foreignTable.id)).find(({ id }) => id === gridView.id)!;
        expect(updatedGridView.sort).toEqual(originalSort);
        expect(updatedGridView.group).toEqual(originalGroup);
        const normalizedMeta = (await getViews(tableId)).find(({ id }) => id === sourceView.id)!
          .columnMeta as IGridColumnMeta;
        expect(normalizedMeta[sourceLinkField.id]?.order).not.toBe(0.5);
        const restoredSortEvents = publishSpy.mock.calls
          .flatMap(([, events]) => events)
          .filter(
            (event): event is ViewSortUpdated =>
              event instanceof ViewSortUpdated && event.viewId.toString() === gridView.id
          );
        expect(restoredSortEvents).toHaveLength(1);
        expect(restoredSortEvents[0]).toMatchObject({
          previousSort: cleanedSort,
          nextSort: originalSort,
          oldVersion: expect.any(Number),
          newVersion: expect.any(Number),
        });
        await vi.waitFor(() => {
          const viewChanges = realtimeChangeSpy.mock.calls
            .filter(([, docId]) => docId.toString().includes(gridView.id))
            .flatMap(([, , change]) => (Array.isArray(change) ? change : [change]));
          expect(viewChanges).toEqual(
            expect.arrayContaining([
              expect.objectContaining({ type: 'set', path: ['sort'], value: originalSort }),
            ])
          );
        });

        const redoResult = (await redo(tableId)).data;
        expect(redoResult.status, JSON.stringify(redoResult)).toBe('fulfilled');
        expect(
          ((await getField(tableId, sourceLinkField.id)).options as ILinkFieldOptions).relationship
        ).toBe(Relationship.ManyMany);
        expect(
          ((await getField(foreignTable.id, symmetricFieldId)).options as ILinkFieldOptions)
            .relationship
        ).toBe(Relationship.ManyMany);
        updatedGridView = (await getViews(foreignTable.id)).find(({ id }) => id === gridView.id)!;
        expect(updatedGridView.sort).toEqual(cleanedSort);
        expect(updatedGridView.group).toEqual(originalGroup);
        await expect(getRecords(foreignTable.id, { viewId: gridView.id })).resolves.toMatchObject({
          records: expect.any(Array),
        });

        const secondUndo = (await undo(tableId)).data;
        expect(secondUndo.status, JSON.stringify(secondUndo)).toBe('fulfilled');
        expect(
          (await getViews(foreignTable.id)).find(({ id }) => id === gridView.id)!.sort
        ).toEqual(originalSort);
        const secondRedo = (await redo(tableId)).data;
        expect(secondRedo.status, JSON.stringify(secondRedo)).toBe('fulfilled');
        expect(
          (await getViews(foreignTable.id)).find(({ id }) => id === gridView.id)!.sort
        ).toEqual(cleanedSort);

        const concurrentSort = {
          sortObjs: [{ fieldId: foreignNumberField.id, order: SortFunc.Desc }],
          manualSort: false,
        };
        await updateViewSort(foreignTable.id, gridView.id, { sort: concurrentSort });
        expect((await undo(tableId)).data).toMatchObject({
          status: 'failed',
          errorCode: 'undo_redo.view_snapshot_conflict',
        });
        expect(
          ((await getField(tableId, sourceLinkField.id)).options as ILinkFieldOptions).relationship
        ).toBe(Relationship.ManyMany);
        updatedGridView = (await getViews(foreignTable.id)).find(({ id }) => id === gridView.id)!;
        expect(updatedGridView.sort).toEqual(concurrentSort);

        // The rejected undo must retain its stack entry. Restore the expected foreign state, then
        // edit the source view from another window so source undo still targets the conversion.
        await updateViewSort(foreignTable.id, gridView.id, { sort: cleanedSort });
        const currentSourceView = (await getViews(tableId)).find(({ id }) => id === sourceView.id)!;
        const sourceNumberField = fields.find(({ type }) => type === FieldType.Number)!;
        const sourceConcurrentSort = {
          sortObjs: [{ fieldId: sourceNumberField.id, order: SortFunc.Desc }],
          manualSort: false,
        };
        headers[windowHeader] = `${fieldWindowId}-other`;
        await updateViewSort(tableId, currentSourceView.id, { sort: sourceConcurrentSort });
        headers[windowHeader] = fieldWindowId;
        expect((await undo(tableId)).data).toMatchObject({
          status: 'failed',
          errorCode: 'undo_redo.field_snapshot_conflict',
        });
        expect((await getViews(tableId)).find(({ id }) => id === sourceView.id)!.sort).toEqual(
          sourceConcurrentSort
        );
        expect(
          (await getViews(foreignTable.id)).find(({ id }) => id === gridView.id)!.sort
        ).toEqual(cleanedSort);
        expect(
          ((await getField(tableId, sourceLinkField.id)).options as ILinkFieldOptions).relationship
        ).toBe(Relationship.ManyMany);
      } finally {
        publishSpy.mockRestore();
        realtimeChangeSpy.mockRestore();
        if (previousWindowId == null) delete headers[windowHeader];
        else headers[windowHeader] = previousWindowId;
        await permanentDeleteTable(baseId, foreignTable.id);
      }
    }
  );

  it('should remove collation from a self-link symmetric field that becomes multiple', async () => {
    const numberField = fields.find(({ type }) => type === FieldType.Number) as IFieldVo;
    const sourceLinkField = await createField(tableId, {
      name: 'Self link',
      type: FieldType.Link,
      options: {
        relationship: Relationship.OneMany,
        foreignTableId: tableId,
      },
    });
    const symmetricFieldId = (sourceLinkField.options as ILinkFieldOptions).symmetricFieldId!;
    const gridView = await createView(tableId, {
      type: ViewType.Grid,
      sort: {
        sortObjs: [
          { fieldId: symmetricFieldId, order: SortFunc.Desc, collation: 'zh-pinyin' },
          { fieldId: numberField.id, order: SortFunc.Asc },
        ],
        manualSort: false,
      },
    });

    await convertField(tableId, sourceLinkField.id, {
      type: FieldType.Link,
      options: {
        relationship: Relationship.ManyMany,
        foreignTableId: tableId,
      },
    });

    await expect(getRecords(tableId, { viewId: gridView.id })).resolves.toMatchObject({
      records: expect.any(Array),
    });
    const updatedGridView = (await getViews(tableId)).find(({ id }) => id === gridView.id)!;
    expect(updatedGridView.sort).toEqual({
      sortObjs: [
        { fieldId: symmetricFieldId, order: SortFunc.Desc },
        { fieldId: numberField.id, order: SortFunc.Asc },
      ],
      manualSort: false,
    });
  });
});
