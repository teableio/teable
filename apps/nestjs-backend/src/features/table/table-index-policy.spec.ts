import { CellValueType, FieldType } from '@teable/core';
import { TableIndex } from '@teable/openapi';
import { describe, expect, it, vi } from 'vitest';
vi.mock('sharp', () => ({ default: vi.fn() }));

vi.mock('@sentry/nestjs', () => ({
  withScope: vi.fn((callback: (scope: unknown) => void) =>
    callback({ setTag: vi.fn(), setContext: vi.fn(), setLevel: vi.fn() })
  ),
  captureMessage: vi.fn(),
  captureException: vi.fn(),
}));

import type { IFieldInstance } from '../field/model/factory';
import { selectSearchIndexFields, TableIndexService } from './table-index.service';

const tableId = 'tblSearchIndexPolicy';
const dbTableName = 'bseSearchIndexPolicy.tblSearchIndexPolicy';

const textField = {
  id: 'fldText',
  dbFieldName: 'Text',
  type: FieldType.SingleLineText,
  cellValueType: CellValueType.String,
  isMultipleCellValue: false,
  isStructuredCellValue: false,
} as unknown as IFieldInstance;

const otherField = {
  ...textField,
  id: 'fldOther',
  dbFieldName: 'Other',
} as IFieldInstance;

const createService = (input?: {
  storedPolicy?: unknown;
  txPolicy?: unknown;
  activated?: boolean;
}) => {
  const findFirstOrThrow = vi
    .fn()
    .mockImplementation(({ select }) =>
      select?.searchIndexPolicy
        ? { searchIndexPolicy: input?.storedPolicy ?? null }
        : { dbTableName }
    );
  const txFindFirstOrThrow = vi.fn().mockResolvedValue({
    dbTableName,
    searchIndexPolicy: input?.txPolicy ?? null,
  });
  const prismaService = {
    tableMeta: {
      findFirstOrThrow,
      update: vi.fn().mockResolvedValue({}),
    },
    field: {
      findMany: vi.fn().mockResolvedValue([]),
    },
    txClient: () => ({
      tableMeta: {
        findUniqueOrThrow: vi.fn().mockResolvedValue({ dbTableName }),
        findFirstOrThrow: txFindFirstOrThrow,
      },
    }),
  };
  const searchIndexBuilder = {
    createSingleIndexSql: vi.fn().mockReturnValue('CREATE INDEX ...'),
    getCreateIndexSql: vi.fn().mockReturnValue([]),
    getDropIndexSql: vi.fn().mockReturnValue('DROP INDEX ...'),
    getExistTableIndexSql: vi.fn().mockReturnValue('SELECT ...'),
    getIndexInfoSql: vi.fn().mockReturnValue('SELECT ...'),
    getAbnormalIndex: vi.fn(),
    getDeleteSingleIndexSql: vi.fn(),
    getUpdateSingleIndexNameSql: vi.fn(),
  };
  const databaseRouter = {
    queryDataPrismaForTable: vi.fn().mockResolvedValue([{ exists: input?.activated ?? false }]),
    dataPrismaTransactionForTable: vi.fn(),
    executeDataPrismaForTable: vi.fn(),
  };
  const service = new TableIndexService(
    {} as never,
    prismaService as never,
    databaseRouter as never,
    { bigTransactionTimeout: 1000 } as never,
    { searchIndex: () => searchIndexBuilder } as never,
    undefined,
    undefined,
    undefined
  );

  return { service, prismaService, databaseRouter, searchIndexBuilder };
};

describe('search index policy', () => {
  it('selects every field for all_fields', () => {
    expect(
      selectSearchIndexFields([textField, otherField], {
        version: 1,
        searchScope: 'all_fields',
        fields: [],
      })
    ).toEqual([textField, otherField]);
  });

  it('keeps only selected field ids for selected_fields', () => {
    expect(
      selectSearchIndexFields([textField, otherField], {
        version: 1,
        searchScope: 'selected_fields',
        fields: [otherField.id],
      })
    ).toEqual([otherField]);
  });

  it('defaults to all_fields when no policy is stored', async () => {
    const { service } = createService();

    await expect(service.getSearchIndexPolicy(tableId)).resolves.toEqual({
      version: 1,
      searchScope: 'all_fields',
      fields: [],
    });
  });

  it('returns the stored selected_fields policy', async () => {
    const { service } = createService({
      storedPolicy: {
        version: 1,
        searchScope: 'selected_fields',
        fields: [textField.id],
      },
    });

    await expect(service.getSearchIndexPolicy(tableId)).resolves.toEqual({
      version: 1,
      searchScope: 'selected_fields',
      fields: [textField.id],
    });
  });

  it('rejects duplicate field ids', async () => {
    const { service } = createService();

    await expect(
      service.updateSearchIndexPolicy(tableId, {
        searchScope: 'selected_fields',
        fields: [textField.id, textField.id],
      })
    ).rejects.toThrow('Duplicate fields in search index policy');
  });

  it('rejects fields that cannot produce a search index', async () => {
    const { service } = createService();
    vi.spyOn(
      service as unknown as {
        getSearchIndexCandidateFields: (tableId: string) => Promise<IFieldInstance[]>;
      },
      'getSearchIndexCandidateFields'
    ).mockResolvedValue([textField]);

    await expect(
      service.updateSearchIndexPolicy(tableId, {
        searchScope: 'selected_fields',
        fields: ['fldMissing'],
      })
    ).rejects.toThrow('Fields are not eligible for the search index: fldMissing');
  });

  it('persists the policy and rebuilds an active index', async () => {
    const { service, prismaService } = createService({ activated: true });
    vi.spyOn(
      service as unknown as {
        getSearchIndexCandidateFields: (tableId: string) => Promise<IFieldInstance[]>;
      },
      'getSearchIndexCandidateFields'
    ).mockResolvedValue([textField]);
    const repair = vi.spyOn(service, 'repairIndex').mockResolvedValue();

    await expect(
      service.updateSearchIndexPolicy(tableId, {
        searchScope: 'selected_fields',
        fields: [textField.id],
      })
    ).resolves.toEqual({
      version: 1,
      searchScope: 'selected_fields',
      fields: [textField.id],
    });

    expect(prismaService.tableMeta.update).toHaveBeenCalledWith({
      where: { id: tableId },
      data: {
        searchIndexPolicy: {
          version: 1,
          searchScope: 'selected_fields',
          fields: [textField.id],
        },
      },
    });
    expect(repair).toHaveBeenCalledWith(tableId, TableIndex.search);
  });

  it('does not create an index for a field outside selected_fields', async () => {
    const { service, databaseRouter } = createService({
      activated: true,
      txPolicy: {
        version: 1,
        searchScope: 'selected_fields',
        fields: [otherField.id],
      },
    });

    await service.createSearchFieldSingleIndex(tableId, textField);

    expect(databaseRouter.executeDataPrismaForTable).not.toHaveBeenCalled();
  });

  it('creates an index for a selected field', async () => {
    const { service, databaseRouter } = createService({
      activated: true,
      txPolicy: {
        version: 1,
        searchScope: 'selected_fields',
        fields: [textField.id],
      },
    });

    await service.createSearchFieldSingleIndex(tableId, textField);

    expect(databaseRouter.executeDataPrismaForTable).toHaveBeenCalledWith(
      tableId,
      'CREATE INDEX ...',
      undefined
    );
  });
});
