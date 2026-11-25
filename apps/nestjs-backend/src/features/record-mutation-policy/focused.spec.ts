import { FieldKeyType, FieldType, CellValueType, DbFieldType } from '@teable/core';
import type { IFieldVo } from '@teable/core';
import { SUPPORTEDTYPE } from '@teable/openapi';
import Knex from 'knex';
import { describe, expect, it, vi } from 'vitest';
import { BaseImportCsvQueueProcessor } from '../base/base-import-processor/base-import-csv.processor';
import { ImportTableCsvQueueProcessor } from '../import/open-api/import-csv.processor';
import { ImportOpenApiService } from '../import/open-api/import-open-api.service';
import { RecordCreateService } from '../record/record-modify/record-create.service';
import { RecordDeleteService } from '../record/record-modify/record-delete.service';
import { RecordUpdateService } from '../record/record-modify/record-update.service';
import { RecordService } from '../record/record.service';
import { SelectionService } from '../selection/selection.service';
import { TableDuplicateService } from '../table/table-duplicate.service';
import { RecordMutationPolicyService } from './record-mutation-policy.service';

const denied = new Error('Table rows are managed by a host policy');
const protectedTableId = 'tblProtected';

const protectedPolicy = () => {
  const policy = new RecordMutationPolicyService();
  policy.register('managed-rows', async ({ tableId, operation }) => {
    if (tableId === protectedTableId && operation !== 'update') throw denied;
  });
  return policy;
};

const denyAllPolicy = () => {
  const policy = new RecordMutationPolicyService();
  policy.register('deny', async () => {
    throw denied;
  });
  return policy;
};

const table = { id: protectedTableId, dbTableName: 'base.records' };
const records = [{ fields: { fldName: 'Name-only row' } }];

describe('Record mutation policies through legacy consumers', () => {
  it('isolates registry instances and rejects conflicting registration without replacing a policy', async () => {
    const policy = new RecordMutationPolicyService();
    const deny = async () => {
      throw denied;
    };
    policy.register('owned', deny);
    policy.register('owned', deny);
    expect(() => policy.register('owned', async () => undefined)).toThrow('already registered');
    const context = {
      tableId: protectedTableId,
      operation: 'create' as const,
      payload: { records },
    };
    await expect(policy.assertAllowed(context)).rejects.toBe(denied);
    await expect(new RecordMutationPolicyService().assertAllowed(context)).resolves.toBeUndefined();
  });

  it.each(['batchCreateRecords', 'createRecordsOnlySql', 'batchDeleteRecords'] as const)(
    'rejects direct %s before opening the physical writer or publishing operations',
    async (method) => {
      const withTableWrite = vi.fn();
      const service = Object.create(RecordService.prototype) as RecordService;
      Object.assign(service, {
        recordMutationPolicy: protectedPolicy(),
        recordActorStorageService: { withTableWrite },
      });
      const write =
        method === 'batchDeleteRecords'
          ? service.batchDeleteRecords(table.id, ['recExisting'])
          : method === 'batchCreateRecords'
            ? service.batchCreateRecords(table as never, records as never, FieldKeyType.Id, [])
            : service.createRecordsOnlySql(table as never, records, FieldKeyType.Id);
      await expect(write).rejects.toBe(denied);
      expect(withTableWrite).not.toHaveBeenCalled();
    }
  );

  it.each(['multipleCreateRecords', 'createRecordsOnlySql'] as const)(
    'rejects %s before typecasting can expand field choices',
    async (method) => {
      const getTableDomainById = vi.fn();
      const validateFieldsAndTypecast = vi.fn();
      const service = Object.create(RecordCreateService.prototype) as RecordCreateService;
      Object.assign(service, {
        recordMutationPolicy: protectedPolicy(),
        tableDomainQueryService: { getTableDomainById },
        shared: { validateFieldsAndTypecast },
      });
      await expect(service[method](table.id, { records, typecast: true })).rejects.toBe(denied);
      expect(getTableDomainById).not.toHaveBeenCalled();
      expect(validateFieldsAndTypecast).not.toHaveBeenCalled();
    }
  );

  it.each(['updateRecords', 'simpleUpdateRecords'] as const)(
    'rejects %s before order, typecasting, links or computed writes',
    async (method) => {
      const getTableDomainById = vi.fn();
      const service = Object.create(RecordUpdateService.prototype) as RecordUpdateService;
      Object.assign(service, {
        recordMutationPolicy: denyAllPolicy(),
        tableDomainQueryService: { getTableDomainById },
      });
      await expect(
        service[method](table.id, {
          records: [{ id: 'recExisting', fields: { fldEmail: 'other@example.test' } }],
          typecast: true,
        })
      ).rejects.toBe(denied);
      expect(getTableDomainById).not.toHaveBeenCalled();
    }
  );

  it('rejects deletion before related link tables can change', async () => {
    const getTableDomainById = vi.fn();
    const service = Object.create(RecordDeleteService.prototype) as RecordDeleteService;
    Object.assign(service, {
      recordMutationPolicy: protectedPolicy(),
      tableDomainQueryService: { getTableDomainById },
    });
    await expect(service.deleteRecord(table.id, 'recExisting')).rejects.toBe(denied);
    expect(getTableDomainById).not.toHaveBeenCalled();
  });

  it.each([false, true])(
    'keeps ordinary SQL-only CE writes functional (unrelated policy: %s)',
    async (registered) => {
      const policy = registered ? protectedPolicy() : new RecordMutationPolicyService();
      const knex = Knex({ client: 'pg' });
      const execute = vi.fn().mockResolvedValue(1);
      const service = Object.create(RecordService.prototype) as RecordService;
      Object.assign(service, {
        recordMutationPolicy: policy,
        cls: { get: () => ({ id: 'usrWriter', name: 'Writer' }) },
        creditCheck: async () => undefined,
        getFieldsByProjection: async () => [
          {
            id: 'fldName',
            name: 'Name',
            type: FieldType.SingleLineText,
            dbFieldName: 'name',
            convertCellValue2DBValue: (value: unknown) => value,
          },
        ],
        getWritableCreatedTimeFieldNames: async () => new Set(),
        getWritableCreatedByFieldNames: async () => new Set(),
        dbProvider: {
          batchInsertSql: (name: string, values: object[]) => knex(name).insert(values).toQuery(),
        },
        recordActorStorageService: {
          withTableWrite: async (_id: string, action: (meta: unknown) => Promise<unknown>) =>
            action({ id: 'tblOrdinary', dbTableName: 'base.ordinary', actorStorageVersion: 0 }),
        },
        databaseRouter: {
          dataPrismaTransactionForTable: async (
            _id: string,
            action: (tx: unknown) => Promise<unknown>
          ) => action({ $executeRawUnsafe: execute }),
        },
        eventEmitterService: { persistRecordCreateOperationAudit: async () => undefined },
      });
      try {
        await service.createRecordsOnlySql(
          { id: 'tblOrdinary' } as never,
          records,
          FieldKeyType.Id
        );
        expect(execute).toHaveBeenCalledOnce();
        expect(execute.mock.calls[0]![0]).toContain('insert into "base"."ordinary"');
        expect(execute.mock.calls[0]![0]).toContain('Name-only row');
      } finally {
        await knex.destroy();
      }
    }
  );

  it('denies CSV append before queue admission and denies an already queued worker job', async () => {
    const service = Object.create(ImportOpenApiService.prototype) as ImportOpenApiService;
    const queue = { getJobCountByTypes: vi.fn(), add: vi.fn() };
    Object.assign(service, {
      recordMutationPolicy: protectedPolicy(),
      importTableCsvChunkQueueProcessor: { queue },
    });
    const ro = {
      attachmentUrl: 'https://example.test/rows.csv',
      fileType: SUPPORTEDTYPE.CSV,
      insertConfig: { sourceColumnMap: {}, sourceWorkSheetKey: 'sheet', excludeFirstRow: false },
    };
    await expect(service.inplaceImportTable('bse', table.id, ro)).rejects.toBe(denied);
    expect(queue.getJobCountByTypes).not.toHaveBeenCalled();
    expect(queue.add).not.toHaveBeenCalled();
    const worker = Object.create(
      ImportTableCsvQueueProcessor.prototype
    ) as ImportTableCsvQueueProcessor;
    const createImportPresence = vi.fn();
    Object.assign(worker, { recordMutationPolicy: protectedPolicy(), createImportPresence });
    await expect(worker.process({ data: { table, ro } } as never)).rejects.toBe(denied);
    expect(createImportPresence).not.toHaveBeenCalled();
  });

  it('denies raw duplicate-table inserts before acquiring a writer or expanding SQL columns', async () => {
    const withTableWrite = vi.fn();
    const service = Object.create(TableDuplicateService.prototype) as TableDuplicateService;
    Object.assign(service, {
      recordMutationPolicy: protectedPolicy(),
      prismaService: { txClient: () => ({ tableMeta: { findFirstOrThrow: async () => table } }) },
      recordActorStorageService: { withTableWrite },
    });
    await expect(
      service.duplicateTableData('base.source', table.dbTableName, {}, {}, [], {} as never)
    ).rejects.toBe(denied);
    expect(withTableWrite).not.toHaveBeenCalled();
  });

  it('denies raw base-import chunks before FK/schema alterations or inserts', async () => {
    const withTableWrite = vi.fn();
    const processor = Object.create(BaseImportCsvQueueProcessor.prototype) as {
      handleChunk: (records: object[], config: object, excluded: string[]) => Promise<unknown>;
    };
    Object.assign(processor, {
      recordMutationPolicy: protectedPolicy(),
      recordActorStorageService: { withTableWrite },
    });
    await expect(
      processor.handleChunk(
        [{ __id: 'recImported', Name: 'Name-only row' }],
        {
          tableId: table.id,
          baseId: 'bse',
          fieldIdMap: {},
          attachmentsFields: [],
          fkMap: {},
        },
        []
      )
    ).rejects.toBe(denied);
    expect(withTableWrite).not.toHaveBeenCalled();
  });

  it('denies a mixed by-id paste before creating columns or changing existing custom values', async () => {
    const field = (id: string): IFieldVo => ({
      id,
      name: id,
      dbFieldName: id,
      type: FieldType.SingleLineText,
      cellValueType: CellValueType.String,
      dbFieldType: DbFieldType.Text,
      options: {},
      isComputed: false,
      isMultipleCellValue: false,
    });
    const createV1PasteByIdFields = vi.fn();
    const updateRecords = vi.fn();
    const createRecords = vi.fn();
    const service = Object.create(SelectionService.prototype) as SelectionService;
    Object.assign(service, {
      recordMutationPolicy: protectedPolicy(),
      thresholdConfig: { maxPasteCells: 100 },
      cls: { get: () => ['field|create', 'record|create'] },
      resolveRecordIdsBySelection: async () => ['recExisting'],
      resolveFieldsBySelection: async () => [field('fldName')],
      getRecordsByIdsForFields: async () => [{ id: 'recExisting', fields: { fldName: 'Old' } }],
      fieldSupplementService: { prepareCreateFields: async () => [field('fldExtra')] },
      createV1PasteByIdFields,
      recordOpenApiService: { updateRecords, createRecords },
    });
    await expect(
      service.pasteById(table.id, {
        content: [
          ['Changed', 'Extra'],
          ['New row', 'Extra new'],
        ],
        selection: { type: 'ids', ids: ['recExisting'] },
      } as never)
    ).rejects.toBe(denied);
    expect(createV1PasteByIdFields).not.toHaveBeenCalled();
    expect(updateRecords).not.toHaveBeenCalled();
    expect(createRecords).not.toHaveBeenCalled();
  });
});

describe('Range paste admission', () => {
  it('rejects row expansion before adding columns or updating existing custom cells', async () => {
    const expandColumns = vi.fn();
    const updateRecords = vi.fn();
    const field = {
      id: 'fldName',
      name: 'Name',
      isComputed: false,
    };
    const service = Object.create(SelectionService.prototype) as SelectionService;
    Object.assign(service, {
      recordMutationPolicy: protectedPolicy(),
      cls: {
        get: (key: string) =>
          key === 'permissions' ? ['field|create', 'record|create'] : undefined,
      },
      thresholdConfig: { maxPasteCells: 100 },
      parseRange: async () => ({ cellCount: 1 }),
      aggregationService: { performRowCount: async () => ({ rowCount: 1 }) },
      fieldService: { getFieldInstances: async () => [field] },
      recordService: {
        getRecordsFields: async () => [{ id: 'recExisting', fields: { fldName: 'Old' } }],
      },
      expandColumns,
      recordOpenApiService: { updateRecords },
    });
    await expect(
      service.paste(protectedTableId, {
        content: [
          ['Changed', 'New column'],
          ['New row', 'Extra value'],
        ],
        ranges: [
          [0, 0],
          [0, 0],
        ],
      } as never)
    ).rejects.toBe(denied);
    expect(expandColumns).not.toHaveBeenCalled();
    expect(updateRecords).not.toHaveBeenCalled();
  });
});
