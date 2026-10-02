import {
  BaseId,
  TableId,
  TableName,
  TableProperties,
  TablePropertiesUpdated,
  TableRenamed,
} from '@teable/v2-core';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  V2TablePropertiesDocProjection,
  tableDocOps,
  tablePropertiesDocOps,
} from './v2-table-properties-compat.service';

vi.mock('@teable/db-main-prisma', () => ({ PrismaService: class PrismaService {} }));
vi.mock('../../share-db/share-db.service', () => ({
  ShareDbService: class ShareDbService {},
}));

const properties = (raw: Record<string, string>) => TableProperties.create(raw)._unsafeUnwrap();

describe('tablePropertiesDocOps', () => {
  it('emits one op per property that changed, in the legacy oi/od shape', () => {
    expect(
      tablePropertiesDocOps(properties({}), properties({ description: 'QA', icon: '📊' }))
    ).toEqual([
      { p: ['description'], oi: 'QA', od: null },
      { p: ['icon'], oi: '📊', od: null },
    ]);
    expect(tablePropertiesDocOps(properties({ description: 'QA' }), properties({}))).toEqual([
      { p: ['description'], oi: null, od: 'QA' },
    ]);
  });

  it('is empty when nothing the doc carries changed', () => {
    expect(
      tablePropertiesDocOps(
        properties({ description: 'same' }),
        properties({ description: 'same' })
      )
    ).toEqual([]);
  });
});

describe('V2TablePropertiesDocProjection', () => {
  const baseId = `bse${'a'.repeat(16)}`;
  const tableId = `tbl${'a'.repeat(16)}`;
  const event = (previous: Record<string, string>, next: Record<string, string>) =>
    TablePropertiesUpdated.create({
      tableId: TableId.create(tableId)._unsafeUnwrap(),
      baseId: BaseId.create(baseId)._unsafeUnwrap(),
      previousProperties: properties(previous),
      nextProperties: properties(next),
    });

  const tableMeta = { findFirst: vi.fn(), update: vi.fn() };
  const prismaService = { txClient: () => ({ tableMeta }) };
  const shareDbService = { shareDbAdapter: { closed: false }, publishOpsMap: vi.fn() };
  const cls = { getId: () => 'req-1' };
  const projection = () =>
    new V2TablePropertiesDocProjection(
      prismaService as never,
      shareDbService as never,
      cls as never
    );

  beforeEach(() => {
    vi.clearAllMocks();
    tableMeta.findFirst.mockResolvedValue({ version: 4 });
    tableMeta.update.mockResolvedValue({});
    shareDbService.publishOpsMap.mockResolvedValue(undefined);
    shareDbService.shareDbAdapter.closed = false;
  });

  it('moves the doc name on a rename', async () => {
    const renamed = TableRenamed.create({
      tableId: TableId.create(tableId)._unsafeUnwrap(),
      baseId: BaseId.create(baseId)._unsafeUnwrap(),
      previousName: TableName.create('New table11')._unsafeUnwrap(),
      nextName: TableName.create('New table')._unsafeUnwrap(),
    });
    expect(tableDocOps(renamed)).toEqual([{ p: ['name'], oi: 'New table', od: 'New table11' }]);
    await projection().handle({} as never, renamed);
    expect(tableMeta.update).toHaveBeenCalledWith({ where: { id: tableId }, data: { version: 5 } });
    expect(shareDbService.publishOpsMap).toHaveBeenCalledTimes(1);
  });

  it('bumps the table version and publishes the op at the old one, like the legacy path', async () => {
    await projection().handle({} as never, event({}, { description: 'QA' }));
    expect(tableMeta.update).toHaveBeenCalledWith({
      where: { id: tableId },
      data: { version: 5 },
    });
    expect(shareDbService.publishOpsMap).toHaveBeenCalledWith([
      {
        [`tbl_${baseId}`]: {
          [tableId]: expect.objectContaining({
            v: 4,
            src: 'req-1',
            op: [{ p: ['description'], oi: 'QA', od: null }],
          }),
        },
      },
    ]);
  });

  it('does nothing when the change touches nothing the doc carries, or the table is gone', async () => {
    await projection().handle({} as never, event({ description: 'x' }, { description: 'x' }));
    expect(tableMeta.findFirst).not.toHaveBeenCalled();

    tableMeta.findFirst.mockResolvedValue(null);
    await projection().handle({} as never, event({}, { description: 'QA' }));
    expect(tableMeta.update).not.toHaveBeenCalled();
    expect(shareDbService.publishOpsMap).not.toHaveBeenCalled();
  });

  it('keeps the row right when ShareDB is closed or refuses the op', async () => {
    shareDbService.shareDbAdapter.closed = true;
    await projection().handle({} as never, event({}, { icon: '📊' }));
    expect(tableMeta.update).toHaveBeenCalled();
    expect(shareDbService.publishOpsMap).not.toHaveBeenCalled();

    shareDbService.shareDbAdapter.closed = false;
    shareDbService.publishOpsMap.mockRejectedValue(new Error('down'));
    await expect(projection().handle({} as never, event({}, { icon: '📊' }))).resolves.toEqual(
      expect.objectContaining({ isOk: expect.any(Function) })
    );
  });
});
