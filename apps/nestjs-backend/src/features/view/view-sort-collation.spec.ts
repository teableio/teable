import {
  DbFieldType,
  FieldType,
  SortFunc,
  ViewOpBuilder,
  ViewType,
  type ISort,
} from '@teable/core';
import { describe, expect, it, vi } from 'vitest';
import { ViewService } from './view.service';

describe('ViewService legacy sort collation validation', () => {
  const tableId = 'tblTest0000000001';
  const viewId = 'viwTest0000000001';
  const fieldId = 'fldTest0000000001';

  const sort = (collated = true): ISort => ({
    sortObjs: [
      {
        fieldId,
        order: SortFunc.Asc,
        ...(collated ? { collation: 'zh-pinyin' as const } : {}),
      },
    ],
  });

  const build = (
    fields: Array<{
      id: string;
      type: FieldType;
      dbFieldType: DbFieldType;
      isComputed: boolean;
      isMultipleCellValue: boolean;
    }>
  ) => {
    const fieldFindMany = vi.fn().mockResolvedValue(fields);
    const viewFindMany = vi.fn().mockResolvedValue([]);
    const viewFindFirstOrThrow = vi.fn().mockResolvedValue({ sort: null, version: 2 });
    const viewUpdate = vi.fn().mockResolvedValue({ id: viewId });
    const viewCreate = vi.fn();
    const saveRawOps = vi.fn();
    const prisma = {
      field: { findMany: fieldFindMany },
      view: {
        findMany: viewFindMany,
        findFirstOrThrow: viewFindFirstOrThrow,
        update: viewUpdate,
        create: viewCreate,
      },
    };
    const service = new ViewService(
      { get: vi.fn().mockReturnValue('usrTest') } as never,
      { saveRawOps } as never,
      { txClient: () => prisma } as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {
        ensureCanCreateView: vi.fn(),
        ensureSort: vi.fn(),
        ensureSerializedProperties: vi.fn(),
      } as never
    );

    return {
      service,
      fieldFindMany,
      viewFindMany,
      viewFindFirstOrThrow,
      viewUpdate,
      viewCreate,
      saveRawOps,
    };
  };

  it.each([
    ['single-line text', FieldType.SingleLineText, DbFieldType.Text, false],
    ['long text', FieldType.LongText, DbFieldType.Text, false],
    ['single-value link', FieldType.Link, DbFieldType.Json, true],
  ])('accepts zh-pinyin for %s', async (_name, type, dbFieldType, isComputed) => {
    const { service } = build([
      { id: fieldId, type, dbFieldType, isComputed, isMultipleCellValue: false },
    ]);

    await expect(service.validateSortCollations(tableId, sort())).resolves.toBeUndefined();
  });

  it.each([
    ['number', FieldType.Number, DbFieldType.Real, false, false],
    ['computed text', FieldType.SingleLineText, DbFieldType.Text, true, false],
    ['multiple text', FieldType.SingleLineText, DbFieldType.Text, false, true],
    ['multiple link', FieldType.Link, DbFieldType.Json, false, true],
  ])(
    'rejects zh-pinyin for %s',
    async (_name, type, dbFieldType, isComputed, isMultipleCellValue) => {
      const { service } = build([
        { id: fieldId, type, dbFieldType, isComputed, isMultipleCellValue },
      ]);

      await expect(service.validateSortCollations(tableId, sort())).rejects.toThrow(
        `Sort field ${fieldId} does not support zh-pinyin collation`
      );
    }
  );

  it('persists an ordinary numeric sort without field-kind validation', async () => {
    const { service, fieldFindMany, viewUpdate, saveRawOps } = build([
      {
        id: fieldId,
        type: FieldType.Number,
        dbFieldType: DbFieldType.Real,
        isComputed: false,
        isMultipleCellValue: false,
      },
    ]);

    await expect(service.updateViewSort(tableId, viewId, sort(false))).resolves.toEqual({
      id: viewId,
    });
    expect(fieldFindMany).not.toHaveBeenCalled();
    expect(viewUpdate).toHaveBeenCalledOnce();
    expect(saveRawOps).toHaveBeenCalledOnce();
  });

  it('rejects an invalid collated sort before creating a legacy view', async () => {
    const { service, viewCreate } = build([
      {
        id: fieldId,
        type: FieldType.Number,
        dbFieldType: DbFieldType.Real,
        isComputed: false,
        isMultipleCellValue: false,
      },
    ]);

    await expect(
      service.createDbView(tableId, {
        name: 'Grid',
        type: ViewType.Grid,
        sort: sort(),
      })
    ).rejects.toThrow(`Sort field ${fieldId} does not support zh-pinyin collation`);
    expect(viewCreate).not.toHaveBeenCalled();
  });

  it('rejects an invalid direct sort update before persistence or publication', async () => {
    const { service, viewFindFirstOrThrow, viewUpdate, saveRawOps } = build([
      {
        id: fieldId,
        type: FieldType.Number,
        dbFieldType: DbFieldType.Real,
        isComputed: false,
        isMultipleCellValue: false,
      },
    ]);

    await expect(service.updateViewSort(tableId, viewId, sort())).rejects.toThrow(
      `Sort field ${fieldId} does not support zh-pinyin collation`
    );
    expect(viewFindFirstOrThrow).not.toHaveBeenCalled();
    expect(viewUpdate).not.toHaveBeenCalled();
    expect(saveRawOps).not.toHaveBeenCalled();
  });

  it('rejects an invalid raw-op sort save before persistence or publication', async () => {
    const { service, viewFindMany, viewUpdate, saveRawOps } = build([
      {
        id: fieldId,
        type: FieldType.Link,
        dbFieldType: DbFieldType.Json,
        isComputed: false,
        isMultipleCellValue: true,
      },
    ]);
    const ops = [
      ViewOpBuilder.editor.setViewProperty.build({
        key: 'sort',
        oldValue: null,
        newValue: sort(),
      }),
    ];

    await expect(service.batchUpdateViewByOps(tableId, { [viewId]: ops })).rejects.toThrow(
      `Sort field ${fieldId} does not support zh-pinyin collation`
    );
    expect(viewFindMany).not.toHaveBeenCalled();
    expect(viewUpdate).not.toHaveBeenCalled();
    expect(saveRawOps).not.toHaveBeenCalled();
  });
});
