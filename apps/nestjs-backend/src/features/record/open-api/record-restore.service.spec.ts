import { domainError, RestoreRecordsCommand } from '@teable/v2-core';
import { err, ok } from 'neverthrow';
import { describe, expect, it, vi } from 'vitest';
import { collectLinkTargetIds } from './link-cell-value.util';
import { filterLiveLinkEntries, RecordRestoreNativeService } from './record-restore-native.service';
import type { IRestorableRecordSnapshot } from './record-restore-native.service';
import {
  RecordRestoreV1CompatibilityService,
  RECORD_RESTORE_V1_CREATE_RECORDS,
} from './record-restore-v1-compatibility.service';
import { RecordRestoreService } from './record-restore.service';

describe('collectLinkTargetIds', () => {
  it('collects ids from single and multi link cell values', () => {
    expect(collectLinkTargetIds({ id: 'recA', title: 'A' })).toEqual(['recA']);
    expect(
      collectLinkTargetIds([
        { id: 'recA', title: 'A' },
        { id: 'recB', title: 'B' },
      ])
    ).toEqual(['recA', 'recB']);
  });

  it('contributes nothing for null and unrecognized shapes', () => {
    expect(collectLinkTargetIds(null)).toEqual([]);
    expect(collectLinkTargetIds('recA')).toEqual([]);
    expect(collectLinkTargetIds([{ title: 'no id' }, 42])).toEqual([]);
  });
});

describe('filterLiveLinkEntries', () => {
  const live = (ids: string[]) => (id: string) => ids.includes(id);

  it('returns the same reference when every entry is live', () => {
    const single = { id: 'recA', title: 'A' };
    expect(filterLiveLinkEntries(single, live(['recA']))).toBe(single);

    const multi = [{ id: 'recA' }, { id: 'recB' }];
    expect(filterLiveLinkEntries(multi, live(['recA', 'recB']))).toBe(multi);
  });

  it('nulls a dead single value and filters dead entries from a multi value', () => {
    expect(filterLiveLinkEntries({ id: 'recDead' }, live([]))).toBeNull();

    expect(filterLiveLinkEntries([{ id: 'recA' }, { id: 'recDead' }], live(['recA']))).toEqual([
      { id: 'recA' },
    ]);
  });

  it('collapses a fully-dead multi value to null instead of an empty array', () => {
    expect(filterLiveLinkEntries([{ id: 'recDead' }], live([]))).toBeNull();
  });

  it('leaves unrecognized shapes untouched', () => {
    expect(filterLiveLinkEntries('recA', live([]))).toBe('recA');
    const mixed = [{ title: 'no id' }, { id: 'recA' }];
    expect(filterLiveLinkEntries(mixed, live(['recA']))).toBe(mixed);
  });
});

const tableId = `tbl${'a'.repeat(16)}`;
const recordId = `rec${'b'.repeat(16)}`;
const linkFieldId = 'fldLink';

const createNativeService = () => {
  const fieldFindMany = vi.fn().mockResolvedValue([]);
  const tableFindMany = vi.fn().mockResolvedValue([{ id: tableId }]);
  const tableFindFirst = vi.fn().mockResolvedValue({ base: { spaceId: 'spc1', v2Enabled: true } });
  const getExistingRecordIds = vi.fn().mockResolvedValue(new Set<string>());
  const execute = vi.fn().mockResolvedValue(ok({ restoredCount: 1, events: [] }));
  const container = { resolve: vi.fn().mockReturnValue({ execute }) };
  const getContainerForTable = vi.fn().mockResolvedValue(container);
  const context = { actorId: 'usrAuthenticated' };
  const createContext = vi.fn().mockResolvedValue(context);
  const prismaService = {
    txClient: () => ({
      field: { findMany: fieldFindMany },
      tableMeta: { findMany: tableFindMany, findFirst: tableFindFirst },
    }),
  };
  const service = new RecordRestoreNativeService(
    { getContainerForTable } as never,
    { createContext } as never,
    prismaService as never,
    { getExistingRecordIds } as never
  );
  return {
    service,
    prismaService,
    fieldFindMany,
    tableFindMany,
    tableFindFirst,
    getExistingRecordIds,
    execute,
    getContainerForTable,
    createContext,
    context,
  };
};

const createRestoreService = (useV2 = true) => {
  const nativeFixture = createNativeService();
  nativeFixture.tableFindFirst.mockResolvedValue({ base: { spaceId: 'spc1', v2Enabled: useV2 } });
  const shouldUseV2ForBaseWithReason = vi.fn().mockResolvedValue({ useV2 });
  const nativeRestore = vi.spyOn(nativeFixture.service, 'restoreRecordSnapshots');
  const legacyRestore = vi.fn().mockResolvedValue(undefined);
  const service = new RecordRestoreService(
    nativeFixture.prismaService as never,
    { shouldUseV2ForBaseWithReason } as never,
    nativeFixture.service,
    { restoreRecordSnapshots: legacyRestore } as never
  );
  return {
    ...nativeFixture,
    service,
    nativeRestore,
    legacyRestore,
    shouldUseV2ForBaseWithReason,
  };
};

describe('RecordRestoreService', () => {
  it('routes the original snapshots and attachment cleanup option only to the selected engine', async () => {
    const fixture = createRestoreService();
    const records = [
      { id: recordId, fields: { fldText: 'original' }, version: 7, order: { viw1: 2 } },
    ];
    const options = { cleanupAttachmentRefs: true };

    await fixture.service.restoreRecordSnapshots(tableId, records, options);

    expect(fixture.nativeRestore).toHaveBeenCalledExactlyOnceWith(tableId, records, options);
    expect(fixture.legacyRestore).not.toHaveBeenCalled();
    expect(fixture.shouldUseV2ForBaseWithReason).toHaveBeenCalledWith(
      { spaceId: 'spc1', v2Enabled: true },
      'createRecord'
    );
  });

  it('preserves v1 selection including missing table context without acquiring native execution', async () => {
    const fixture = createRestoreService(false);
    const records = [{ id: recordId, fields: {} }];
    await fixture.service.restoreRecordSnapshots(tableId, records);
    expect(fixture.legacyRestore).toHaveBeenCalledWith(tableId, records);
    expect(fixture.nativeRestore).not.toHaveBeenCalled();

    fixture.tableFindFirst.mockResolvedValueOnce(null);
    fixture.shouldUseV2ForBaseWithReason.mockClear();
    await fixture.service.restoreRecordSnapshots(tableId, records);
    expect(fixture.shouldUseV2ForBaseWithReason).not.toHaveBeenCalled();
    expect(fixture.legacyRestore).toHaveBeenCalledTimes(2);
  });

  it('keeps physical live and same-batch links, drops missing links without mutating stored snapshots', async () => {
    const fixture = createRestoreService();
    fixture.fieldFindMany.mockResolvedValue([
      { id: linkFieldId, options: JSON.stringify({ foreignTableId: tableId }) },
    ]);
    fixture.getExistingRecordIds.mockResolvedValue(new Set(['recUnreadableLive']));
    const records = [
      {
        id: recordId,
        fields: {
          [linkFieldId]: [
            { id: 'recUnreadableLive', title: 'kept' },
            { id: 'recBatch' },
            { id: 'recDead' },
          ],
        },
      },
      { id: 'recBatch', fields: {} },
    ];
    await fixture.service.restoreRecordSnapshots(tableId, records);

    expect(fixture.getExistingRecordIds).toHaveBeenCalledExactlyOnceWith(tableId, [
      'recUnreadableLive',
      'recBatch',
      'recDead',
    ]);
    expect(fixture.execute.mock.calls[0][1].records[0].fields[linkFieldId]).toEqual([
      { id: 'recUnreadableLive', title: 'kept' },
      { id: 'recBatch' },
    ]);
    expect(records[0].fields[linkFieldId]).toHaveLength(3);
  });

  it('nulls links into deleted foreign tables without probing their storage', async () => {
    const fixture = createRestoreService();
    fixture.fieldFindMany.mockResolvedValue([
      { id: linkFieldId, options: JSON.stringify({ foreignTableId: 'tblDeleted' }) },
    ]);
    fixture.tableFindMany.mockResolvedValue([]);
    await fixture.service.restoreRecordSnapshots(tableId, [
      { id: recordId, fields: { [linkFieldId]: { id: 'recDead' } } },
    ]);
    expect(fixture.getExistingRecordIds).not.toHaveBeenCalled();
    expect(fixture.execute.mock.calls[0][1].records[0].fields[linkFieldId]).toBeNull();
  });

  it('propagates a physical liveness failure before either engine can restore altered snapshots', async () => {
    const fixture = createRestoreService();
    fixture.fieldFindMany.mockResolvedValue([
      { id: linkFieldId, options: JSON.stringify({ foreignTableId: tableId }) },
    ]);
    const failure = new Error('storage unavailable');
    fixture.getExistingRecordIds.mockRejectedValue(failure);
    await expect(
      fixture.service.restoreRecordSnapshots(tableId, [
        { id: recordId, fields: { [linkFieldId]: { id: 'recLive' } } },
      ])
    ).rejects.toBe(failure);
    expect(fixture.execute).not.toHaveBeenCalled();
    expect(fixture.legacyRestore).not.toHaveBeenCalled();
  });

  it('prepares dangling links before the explicit-v1 adapter without executing native commands', async () => {
    const fixture = createRestoreService(false);
    fixture.fieldFindMany.mockResolvedValue([
      { id: linkFieldId, options: JSON.stringify({ foreignTableId: tableId }) },
    ]);
    const records = [{ id: recordId, fields: { [linkFieldId]: { id: 'recDead' } } }];

    await fixture.service.restoreRecordSnapshots(tableId, records);

    expect(fixture.legacyRestore).toHaveBeenCalledExactlyOnceWith(tableId, [
      { id: recordId, fields: { [linkFieldId]: null } },
    ]);
    expect(records[0].fields[linkFieldId]).toEqual({ id: 'recDead' });
    expect(fixture.nativeRestore).not.toHaveBeenCalled();
    expect(fixture.getContainerForTable).not.toHaveBeenCalled();
    expect(fixture.execute).not.toHaveBeenCalled();
  });
});

describe('RecordRestoreNativeService', () => {
  it('executes the real restore command with snapshot metadata, zero version/order and attachment cleanup', async () => {
    const fixture = createNativeService();
    const snapshot: IRestorableRecordSnapshot = {
      id: recordId,
      fields: { fldText: 'snapshot' },
      version: 0,
      order: { viw1: 0 },
      autoNumber: 0,
      createdTime: '2026-01-01T00:00:00.000Z',
      createdBy: 'usrCreator',
      lastModifiedTime: '2026-01-02T00:00:00.000Z',
      lastModifiedBy: 'usrEditor',
    };
    await fixture.service.restoreRecordSnapshots(tableId, [snapshot], {
      cleanupAttachmentRefs: true,
    });
    expect(fixture.getContainerForTable).toHaveBeenCalledExactlyOnceWith(tableId);
    const [context, command] = fixture.execute.mock.calls[0];
    expect(context).toBe(fixture.context);
    expect(command).toBeInstanceOf(RestoreRecordsCommand);
    expect(command.cleanupAttachmentRefs).toBe(true);
    expect(command.records).toEqual([
      {
        recordId,
        fields: snapshot.fields,
        version: 0,
        orders: snapshot.order,
        autoNumber: 0,
        createdTime: snapshot.createdTime,
        createdBy: snapshot.createdBy,
        lastModifiedTime: snapshot.lastModifiedTime,
        lastModifiedBy: snapshot.lastModifiedBy,
      },
    ]);
  });

  it('returns for empty input without acquiring a container', async () => {
    const fixture = createNativeService();
    await fixture.service.restoreRecordSnapshots(tableId, []);
    expect(fixture.getContainerForTable).not.toHaveBeenCalled();
  });

  it('rejects invalid command input before execution and preserves forbidden plugin status', async () => {
    const fixture = createNativeService();
    await expect(
      fixture.service.restoreRecordSnapshots('invalid', [{ id: recordId, fields: {} }])
    ).rejects.toMatchObject({ status: 400 });
    expect(fixture.execute).not.toHaveBeenCalled();
    fixture.execute.mockResolvedValueOnce(
      err(domainError.forbidden({ message: 'Foreign table denied' }))
    );
    await expect(
      fixture.service.restoreRecordSnapshots(tableId, [{ id: recordId, fields: {} }])
    ).rejects.toMatchObject({ status: 403, message: 'Foreign table denied' });
  });
});

describe('RecordRestoreV1CompatibilityService', () => {
  it('uses the selected-v1 application owner with exact legacy restore flags and snapshots', async () => {
    const multipleCreateRecords = vi.fn().mockResolvedValue(undefined);
    const get = vi.fn().mockReturnValue({ multipleCreateRecords });
    const service = new RecordRestoreV1CompatibilityService({ get } as never);
    const records = [{ id: recordId, fields: {}, version: 4, order: { viw1: 1 } }];
    expect(get).not.toHaveBeenCalled();
    await service.restoreRecordSnapshots(tableId, records);
    expect(get).toHaveBeenCalledExactlyOnceWith(RECORD_RESTORE_V1_CREATE_RECORDS, {
      strict: false,
    });
    expect(multipleCreateRecords).toHaveBeenCalledExactlyOnceWith(
      tableId,
      { fieldKeyType: 'id', records, typecast: true },
      true
    );
  });
});
