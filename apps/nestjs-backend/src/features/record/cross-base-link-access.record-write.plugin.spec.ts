import { HttpErrorCode } from '@teable/core';
import {
  RecordWriteOperationKind,
  type DomainError,
  type RecordWritePluginContext,
} from '@teable/v2-core';
import { describe, expect, it, vi, type Mock } from 'vitest';
import { CustomHttpException } from '../../custom.exception';
import { CrossBaseLinkAccessRecordWritePlugin } from './cross-base-link-access.record-write.plugin';

type ForeignTablesReadableMock = Mock<
  (tableId: string, fieldKeys?: Iterable<string>) => Promise<void>
>;

const TABLE_ID = `tbl${'t'.repeat(16)}`;
const LINK_FIELD_ID = `fld${'l'.repeat(16)}`;
const MATCH_FIELD_ID = `fld${'m'.repeat(16)}`;

const createContext = (
  kind: RecordWritePluginContext['kind'],
  payload: unknown
): RecordWritePluginContext =>
  ({
    kind,
    executionContext: {} as never,
    table: { id: () => ({ toString: () => TABLE_ID }) } as never,
    payload,
    isTransactionBound: false,
  }) as RecordWritePluginContext;

const createPlugin = () => {
  const assertForeignTablesReadable: ForeignTablesReadableMock = vi
    .fn()
    .mockResolvedValue(undefined);
  const plugin = new CrossBaseLinkAccessRecordWritePlugin({
    assertForeignTablesReadable,
  } as never);
  return { plugin, assertForeignTablesReadable };
};

const checkedFieldKeys = (mock: ForeignTablesReadableMock): string[] => {
  const [, fieldKeys] = mock.mock.calls[0]!;
  return [...(fieldKeys as Iterable<string>)];
};

const permissionDenied = new CustomHttpException(
  `not allowed to operate record|read on tbl${'f'.repeat(16)}`,
  HttpErrorCode.RESTRICTED_RESOURCE,
  { localization: { i18nKey: 'httpErrors.permission.notAllowedOperation' } }
);

describe('CrossBaseLinkAccessRecordWritePlugin', () => {
  it('checks every record write kind that persists a link cell', () => {
    const { plugin } = createPlugin();

    // The host entry points that used to call the service by hand, plus the v2
    // paths this plugin was introduced to cover: submit, upsert, duplicate,
    // /api/v2 updateRecords and import.
    for (const kind of [
      RecordWriteOperationKind.createOne,
      RecordWriteOperationKind.createMany,
      RecordWriteOperationKind.createStream,
      RecordWriteOperationKind.submit,
      RecordWriteOperationKind.updateOne,
      RecordWriteOperationKind.updateMany,
      RecordWriteOperationKind.upsertRecords,
      RecordWriteOperationKind.paste,
      RecordWriteOperationKind.importAppend,
      RecordWriteOperationKind.restoreMany,
      RecordWriteOperationKind.duplicate,
      RecordWriteOperationKind.duplicateStream,
    ]) {
      expect(plugin.supports(kind), kind).toBe(true);
    }

    // These carry no link cell values, so they must not pay a meta query.
    for (const kind of [
      RecordWriteOperationKind.buttonClick,
      RecordWriteOperationKind.deleteMany,
      RecordWriteOperationKind.archiveMany,
    ]) {
      expect(plugin.supports(kind), kind).toBe(false);
    }
  });

  it('checks the fields a form submit writes', async () => {
    const { plugin, assertForeignTablesReadable } = createPlugin();

    const result = await plugin.prepare(
      createContext(RecordWriteOperationKind.submit, {
        fieldValues: new Map([[LINK_FIELD_ID, 'foreign-1']]),
        fieldKeyType: 'id',
        typecast: true,
        recordCount: 1,
      })
    );

    expect(result.isOk()).toBe(true);
    expect(assertForeignTablesReadable).toHaveBeenCalledTimes(1);
    expect(assertForeignTablesReadable.mock.calls[0]![0]).toBe(TABLE_ID);
    expect(checkedFieldKeys(assertForeignTablesReadable)).toEqual([LINK_FIELD_ID]);
  });

  it('checks the fields an upsert writes', async () => {
    const { plugin, assertForeignTablesReadable } = createPlugin();

    const result = await plugin.prepare(
      createContext(RecordWriteOperationKind.upsertRecords, {
        recordsFieldValues: [new Map([[MATCH_FIELD_ID, 'a']]), new Map([[LINK_FIELD_ID, 'b']])],
        matchFieldId: MATCH_FIELD_ID,
        onConflict: 'update',
        fieldKeyType: 'id',
        typecast: false,
        recordCount: 2,
      })
    );

    expect(result.isOk()).toBe(true);
    expect(checkedFieldKeys(assertForeignTablesReadable)).toEqual([MATCH_FIELD_ID, LINK_FIELD_ID]);
  });

  it('checks a duplicated record and its streamed copy', async () => {
    const one = createPlugin();
    await one.plugin.prepare(
      createContext(RecordWriteOperationKind.duplicate, {
        sourceRecordId: {},
        fieldValues: new Map([[LINK_FIELD_ID, [{ id: 'rec1' }]]]),
        recordCount: 1,
      })
    );
    expect(checkedFieldKeys(one.assertForeignTablesReadable)).toEqual([LINK_FIELD_ID]);

    const stream = createPlugin();
    await stream.plugin.prepare(
      createContext(RecordWriteOperationKind.duplicateStream, {
        sourceRecordIds: [],
        recordsFieldValues: [new Map([[LINK_FIELD_ID, [{ id: 'rec1' }]]])],
        batchSize: 100,
        recordCount: 1,
      })
    );
    expect(checkedFieldKeys(stream.assertForeignTablesReadable)).toEqual([LINK_FIELD_ID]);
  });

  it('checks the link cells a restore re-inserts', async () => {
    const { plugin, assertForeignTablesReadable } = createPlugin();

    const result = await plugin.prepare(
      createContext(RecordWriteOperationKind.restoreMany, {
        recordsFieldValues: [
          new Map([[MATCH_FIELD_ID, 'k1']]),
          new Map([[LINK_FIELD_ID, ['foreign']]]),
        ],
        recordCount: 2,
      })
    );

    expect(result.isOk()).toBe(true);
    expect(checkedFieldKeys(assertForeignTablesReadable)).toEqual([MATCH_FIELD_ID, LINK_FIELD_ID]);
  });

  it('checks every field of an explicit updateMany payload', async () => {
    const { plugin, assertForeignTablesReadable } = createPlugin();

    await plugin.prepare(
      createContext(RecordWriteOperationKind.updateMany, {
        variant: 'explicit',
        recordUpdates: [
          { recordId: {}, fieldValues: new Map([[LINK_FIELD_ID, 'a']]) },
          { recordId: {}, fieldValues: new Map([[MATCH_FIELD_ID, 'b']]) },
        ],
        fieldKeyType: 'id',
        typecast: false,
        recordCount: 2,
      })
    );

    expect(checkedFieldKeys(assertForeignTablesReadable)).toEqual([LINK_FIELD_ID, MATCH_FIELD_ID]);
  });

  it('checks a streamed paste once, not per chunk', async () => {
    const { plugin, assertForeignTablesReadable } = createPlugin();

    const operation = await plugin.prepare(
      createContext(RecordWriteOperationKind.paste, {
        editableFieldIds: [{ toString: () => LINK_FIELD_ID }],
        updateRecordIds: [],
        updateRecordsFieldValues: [],
        createRecordsFieldValues: [],
        typecast: true,
        updateRecordCount: 0,
        createRecordCount: 2,
        recordCount: 2,
      })
    );
    expect(operation.isOk()).toBe(true);

    const chunk = await plugin.prepare(
      createContext(RecordWriteOperationKind.paste, {
        editableFieldIds: [{ toString: () => LINK_FIELD_ID }],
        updateRecordIds: [],
        updateRecordsFieldValues: [],
        createRecordsFieldValues: [new Map([[LINK_FIELD_ID, 'foreign-1']])],
        typecast: true,
        updateRecordCount: 0,
        createRecordCount: 1,
        recordCount: 1,
      }),
      operation._unsafeUnwrap()
    );

    expect(chunk.isOk()).toBe(true);
    expect(assertForeignTablesReadable).toHaveBeenCalledTimes(1);
  });

  it('skips the check when the payload carries no field values', async () => {
    const { plugin, assertForeignTablesReadable } = createPlugin();

    const result = await plugin.prepare(
      createContext(RecordWriteOperationKind.createStream, {
        recordsFieldValues: [],
        batchSize: 1000,
        recordCount: 2,
      })
    );

    expect(result.isOk()).toBe(true);
    expect(assertForeignTablesReadable).not.toHaveBeenCalled();
  });

  it('returns a forbidden domain error carrying the host localization', async () => {
    const { plugin, assertForeignTablesReadable } = createPlugin();
    assertForeignTablesReadable.mockRejectedValue(permissionDenied);

    const result = await plugin.prepare(
      createContext(RecordWriteOperationKind.createOne, {
        fieldValues: new Map([[LINK_FIELD_ID, 'foreign-1']]),
        fieldKeyType: 'id',
        typecast: false,
        recordCount: 1,
      })
    );

    expect(result.isErr()).toBe(true);
    const error = result._unsafeUnwrapErr() as DomainError;
    expect(error.code).toBe('cross_base_link.foreign_table_read_forbidden');
    expect(error.tags).toContain('forbidden');
    expect(error.details).toEqual({
      operation: RecordWriteOperationKind.createOne,
      tableId: TABLE_ID,
    });
    expect(error.localization).toEqual({
      i18nKey: 'httpErrors.permission.notAllowedOperation',
    });
  });

  it('rethrows a failure the link check does not own', async () => {
    const { plugin, assertForeignTablesReadable } = createPlugin();
    const failure = new Error('connection reset');
    assertForeignTablesReadable.mockRejectedValue(failure);

    await expect(
      plugin.prepare(
        createContext(RecordWriteOperationKind.createOne, {
          fieldValues: new Map([[LINK_FIELD_ID, 'foreign-1']]),
          fieldKeyType: 'id',
          typecast: false,
          recordCount: 1,
        })
      )
    ).rejects.toBe(failure);
  });
});
