import type { TestingModule } from '@nestjs/testing';
import { Test } from '@nestjs/testing';
import type { IFilterSet, IOtOperation } from '@teable/core';
import { IdPrefix, ViewType } from '@teable/core';
import { GlobalModule } from '../../global/global.module';
import { RawOpType } from '../../share-db/interface';
import { ViewModule } from './view.module';
import { ViewService } from './view.service';

describe('ViewService', () => {
  let service: ViewService;
  let module: TestingModule;

  beforeEach(async () => {
    module = await Test.createTestingModule({
      imports: [GlobalModule, ViewModule],
    }).compile();

    service = module.get<ViewService>(ViewService);
  });

  afterEach(async () => {
    await module.close();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});

describe('ViewService.deleteViewRelativeByFields', () => {
  it('persists one bulk filter change and emits the original filter for undo', async () => {
    const tableId = 'tblTest0000000001';
    const viewId = 'viwTest0000000001';
    const first = { fieldId: 'fldFirst', operator: 'is', value: 'first' } as const;
    const second = { fieldId: 'fldSecond', operator: 'is', value: 'second' } as const;
    const retained = { fieldId: 'fldRetained', operator: 'is', value: 'retained' } as const;
    const originalFilter: IFilterSet = {
      conjunction: 'and',
      filterSet: [first, { conjunction: 'or', filterSet: [second] }, retained],
    };
    const nextFilter: IFilterSet = { conjunction: 'and', filterSet: [retained] };
    const view = {
      id: viewId,
      version: 3,
      type: ViewType.Grid,
      filter: JSON.stringify(originalFilter),
      columnMeta: JSON.stringify({ [first.fieldId]: { order: 0 }, [second.fieldId]: { order: 1 } }),
    };
    const update = vi.fn();
    const findMany = vi.fn().mockResolvedValue([view]);
    const saveRawOps = vi.fn();
    const service = new ViewService(
      { get: vi.fn().mockReturnValue('usrTest') } as never,
      { saveRawOps } as never,
      { txClient: () => ({ view: { findMany, update } }) } as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      { ensureSerializedProperties: vi.fn() } as never
    );

    await service.deleteViewRelativeByFields(tableId, [first.fieldId, second.fieldId]);

    expect(update).toHaveBeenCalledWith({
      where: { id: viewId },
      data: expect.objectContaining({ filter: expect.any(String) }),
    });
    expect(JSON.parse(update.mock.calls[0][0].data.filter)).toEqual(nextFilter);
    expect(saveRawOps).toHaveBeenCalledWith(tableId, RawOpType.Edit, IdPrefix.View, [
      { docId: viewId, version: 3, data: expect.any(Array) },
    ]);
    const ops = saveRawOps.mock.calls[0][3][0].data as IOtOperation[];
    expect(ops.filter(({ p }) => p[0] === 'filter')).toEqual([
      { p: ['filter'], oi: nextFilter, od: originalFilter },
    ]);
  });
});
