/* eslint-disable sonarjs/no-identical-functions */
/* eslint-disable sonarjs/no-duplicate-string */
/* eslint-disable @typescript-eslint/naming-convention */
import { HttpException, HttpStatus } from '@nestjs/common';

import {
  CellValueType,
  DbFieldType,
  FieldType,
  getDefaultFormatting,
  type IFieldVo,
} from '@teable/core';
import type * as V2ContractHttp from '@teable/v2-contract-http';
import { v2CoreTokens } from '@teable/v2-core';
import { describe, expect, it, vi } from 'vitest';

// Mapping tests inject their service dependencies explicitly; keep database and
// application bootstrap code outside this unit test boundary.
vi.mock('@teable/db-main-prisma', () => ({ PrismaService: class PrismaService {} }));
vi.mock('../../data-loader/data-loader.service', () => ({
  DataLoaderService: class DataLoaderService {},
}));
vi.mock('../../v2/v2-container.service', () => ({
  V2ContainerService: class V2ContainerService {},
}));
vi.mock('../../v2/v2-execution-context.factory', () => ({
  V2ExecutionContextFactory: class V2ExecutionContextFactory {},
}));
vi.mock('../field-calculate/field-supplement.service', () => ({
  FieldSupplementService: class FieldSupplementService {},
}));

const {
  executeDeleteFieldEndpoint,
  executeDuplicateFieldEndpoint,
  executeUpdateFieldEndpoint,
  executeUpdateRecordEndpoint,
} = vi.hoisted(() => ({
  executeDeleteFieldEndpoint: vi.fn(),
  executeDuplicateFieldEndpoint: vi.fn(),
  executeUpdateFieldEndpoint: vi.fn(),
  executeUpdateRecordEndpoint: vi.fn(),
}));

vi.mock('@teable/v2-contract-http-implementation/handlers', () => ({
  executeDeleteFieldEndpoint,
  executeDuplicateFieldEndpoint,
  executeUpdateFieldEndpoint,
  executeUpdateRecordEndpoint,
}));

vi.mock('@teable/v2-contract-http', async (importOriginal) => {
  const original = await importOriginal<typeof V2ContractHttp>();
  return {
    ...original,
    mapFieldToDto: (field: unknown, primaryFieldId?: unknown) => {
      const testDto = (field as { __testDto?: Record<string, unknown> }).__testDto;
      if (testDto) return { isErr: () => false, value: testDto };
      return original.mapFieldToDto(field as never, primaryFieldId as never);
    },
  };
});

import { FieldOpenApiV2Service } from './field-open-api-v2.service';

type ITestFieldOpenApiV2Service = {
  mapLegacyCreateFieldToV2: (
    ro: Record<string, unknown>,
    table?: {
      getField: (
        predicate: (candidate: {
          id: () => { equals: (id: unknown) => boolean };
          relationship: () => { toString: () => string };
        }) => boolean
      ) =>
        | {
            isErr: () => false;
            value: { relationship: () => { toString: () => string } };
          }
        | {
            isErr: () => true;
          };
    }
  ) => Record<string, unknown>;
  mapConvertFieldToV2: (
    ro: Record<string, unknown>,
    currentField?: Record<string, unknown>
  ) => Record<string, unknown>;
  mapLegacyUpdateFieldToV2: (
    ro: Record<string, unknown>,
    currentField?: Record<string, unknown>
  ) => Record<string, unknown>;
  normalizeFieldVo: (field: unknown) => IFieldVo;
  createField: (tableId: string, fieldRo: Record<string, unknown>) => Promise<IFieldVo>;
  createFields: (tableId: string, fieldRos: Array<Record<string, unknown>>) => Promise<IFieldVo[]>;
  extractFieldVoFromTableDto: (
    tableDto: {
      fields: Array<Record<string, unknown>>;
    },
    fieldId: string
  ) => Promise<IFieldVo>;
  hasDuplicatedDbFieldName: (
    table: { getFields: () => Array<unknown> },
    dbFieldName: string
  ) => boolean;
  completeLegacyLinkDbConfigForCreate: (
    v2Field: Record<string, unknown>,
    currentTable: {
      dbTableName: () => {
        isErr: () => boolean;
        value: { value: () => { isErr: () => boolean; value: string } };
      };
    },
    tableQueryService: {
      getById: () => Promise<{
        isErr: () => boolean;
        value: {
          dbTableName: () => {
            isErr: () => boolean;
            value: { value: () => { isErr: () => boolean; value: string } };
          };
        };
      }>;
    },
    context: Record<string, unknown>
  ) => Promise<Record<string, unknown>>;
};

const createService = () =>
  new FieldOpenApiV2Service(
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never
  ) as unknown as ITestFieldOpenApiV2Service;

const createV2ContainerService = (commandBus: unknown, tableQueryService: unknown) => {
  const tracer = {
    startSpan: vi.fn(() => ({
      setAttribute: vi.fn(),
      setAttributes: vi.fn(),
      recordError: vi.fn(),
      end: vi.fn(),
    })),
    withSpan: vi.fn(async (_span, callback: () => Promise<unknown>) => callback()),
    getActiveSpan: vi.fn(),
  };
  const container = {
    resolve: vi.fn((token: { description?: string }) => {
      if (token.description === 'v2.core.tracer') {
        return tracer;
      }
      if (token.description === 'v2.core.commandBus') {
        return commandBus;
      }
      if (token.description === 'v2.core.tableQueryService') {
        return tableQueryService;
      }
      return undefined;
    }),
  };

  return {
    getContainerForTable: vi.fn().mockResolvedValue(container),
    getContainer: vi.fn().mockResolvedValue(container),
  };
};

const createFieldSupplementService = () => ({
  assertSameSpaceLinkTarget: vi.fn(),
});

describe('FieldOpenApiV2Service deleteField', () => {
  it('delegates delete state handling to the v2 delete endpoint', async () => {
    const tableId = `tbl${'a'.repeat(16)}`;
    const fieldId = `fld${'b'.repeat(16)}`;
    const baseId = `bse${'d'.repeat(16)}`;
    const context: Record<string, unknown> = {};
    executeDeleteFieldEndpoint.mockResolvedValue({
      status: 200,
      body: { ok: true },
    });
    const commandBus = {
      execute: vi.fn().mockResolvedValue({ isErr: () => false }),
    };
    const tableQueryService = {
      getById: vi.fn().mockResolvedValue({
        isErr: () => false,
        value: {
          baseId: () => ({ toString: () => baseId }),
        },
      }),
    };
    const container = {
      resolve: vi.fn((token: symbol) => {
        if (token === v2CoreTokens.commandBus) return commandBus;
        if (token === v2CoreTokens.tableQueryService) return tableQueryService;
        throw new Error(`Unexpected token ${String(token)}`);
      }),
    };
    const dataLoaderService = {
      field: {
        invalidateTables: vi.fn(),
      },
    };
    const service = new FieldOpenApiV2Service(
      {
        getContainerForTable: vi.fn().mockResolvedValue(container),
      } as never,
      {
        createContext: vi.fn().mockResolvedValue(context),
      } as never,
      dataLoaderService as never,
      {
        get: vi.fn((key: string) => (key === 'user.id' ? `usr${'f'.repeat(16)}` : undefined)),
      } as never,
      {} as never,
      {} as never
    );

    await service.deleteField(tableId, fieldId);

    expect(executeDeleteFieldEndpoint).toHaveBeenCalledWith(
      context,
      {
        baseId,
        tableId,
        fieldId,
      },
      commandBus
    );
    expect(dataLoaderService.field.invalidateTables).toHaveBeenCalledWith([tableId]);
  });
});

describe('FieldOpenApiV2Service getSnapshotBulk', () => {
  const createSnapshotField = (fieldId: string, dto: IFieldVo, version = 9) => ({
    id: () => ({ toString: () => fieldId }),
    isProvisionPending: () => false,
    version: () => ({
      isErr: () => false,
      isOk: () => true,
      value: { toNumber: () => version },
    }),
    get __testDto() {
      return dto;
    },
  });

  it('maps GetFieldSnapshots without a Prisma reread', async () => {
    const tableId = `tbl${'a'.repeat(16)}`;
    const fieldId = `fld${'b'.repeat(16)}`;
    const currentField = { id: fieldId, name: 'Current name' } as IFieldVo;
    const field = createSnapshotField(fieldId, currentField);
    const execute = vi.fn(async () => ({
      isErr: () => false,
      value: {
        snapshots: [{ id: fieldId, version: 9, field }],
        fields: [field],
        primaryFieldId: { equals: () => false },
      },
    }));
    const prismaService = {
      txClient: vi.fn(),
    };
    const service = new FieldOpenApiV2Service(
      { getContainerForTable: vi.fn(async () => ({ resolve: () => ({ execute }) })) } as never,
      { createContext: vi.fn(async () => ({})) } as never,
      {} as never,
      {} as never,
      {} as never,
      prismaService as never,
      {} as never
    );

    const snapshots = await service.getSnapshotBulk(tableId, [fieldId]);
    expect(snapshots).toEqual([
      {
        id: fieldId,
        v: 9,
        type: 'json0',
        data: expect.objectContaining({ id: fieldId, name: 'Current name' }),
      },
    ]);
    expect(prismaService.txClient).not.toHaveBeenCalled();
    expect(
      execute.mock.calls[0]?.[1].fieldIds?.map((id: { toString(): string }) => id.toString())
    ).toEqual([fieldId]);
  });

  it('returns an empty bulk when GetFieldSnapshots omits version-less fields', async () => {
    const tableId = `tbl${'a'.repeat(16)}`;
    const fieldId = `fld${'b'.repeat(16)}`;
    const execute = vi.fn(async () => ({
      isErr: () => false,
      value: {
        snapshots: [],
        fields: [],
      },
    }));
    const service = new FieldOpenApiV2Service(
      { getContainerForTable: vi.fn(async () => ({ resolve: () => ({ execute }) })) } as never,
      { createContext: vi.fn(async () => ({})) } as never,
      {} as never,
      {} as never,
      {} as never,
      { txClient: vi.fn() } as never,
      {} as never
    );

    await expect(service.getSnapshotBulk(tableId, [fieldId])).resolves.toEqual([]);
  });

  it('fills missing cross-base baseId on conditional snapshots without listing host fields', async () => {
    const tableId = `tbl${'a'.repeat(16)}`;
    const foreignTableId = `tbl${'b'.repeat(16)}`;
    const hostBaseId = `bse${'a'.repeat(16)}`;
    const foreignBaseId = `bse${'b'.repeat(16)}`;
    const fieldId = `fld${'c'.repeat(16)}`;
    const currentField = {
      id: fieldId,
      name: 'Cross-base rollup',
      type: FieldType.ConditionalRollup,
      options: { foreignTableId, expression: 'countall({values})' },
    } as IFieldVo;
    const field = createSnapshotField(fieldId, currentField);
    const execute = vi.fn(async () => ({
      isErr: () => false,
      value: {
        snapshots: [{ id: fieldId, version: 9, field }],
        fields: [field],
        primaryFieldId: { equals: () => false },
      },
    }));
    const tableMeta = {
      findUnique: vi.fn(async () => ({ baseId: hostBaseId })),
      findMany: vi.fn(async () => [{ id: foreignTableId, baseId: foreignBaseId }]),
    };
    const service = new FieldOpenApiV2Service(
      { getContainerForTable: vi.fn(async () => ({ resolve: () => ({ execute }) })) } as never,
      { createContext: vi.fn(async () => ({})) } as never,
      {} as never,
      {} as never,
      {} as never,
      { txClient: () => ({ tableMeta }) } as never,
      {} as never
    );

    const snapshots = await service.getSnapshotBulk(tableId, [fieldId]);
    expect(snapshots).toHaveLength(1);
    expect(snapshots[0]?.data.options).toMatchObject({ baseId: foreignBaseId, foreignTableId });
    expect(execute).toHaveBeenCalledTimes(1);
    expect(tableMeta.findMany).toHaveBeenCalledTimes(1);
  });

  it('hydrates lookup snapshot choices from the source field once per foreign table', async () => {
    const tableId = `tbl${'a'.repeat(16)}`;
    const foreignTableId = `tbl${'b'.repeat(16)}`;
    const sourceFieldId = `fld${'d'.repeat(16)}`;
    let sourceChoices = [{ id: 'choBefore', name: 'Before', color: 'blueBright' }];
    const lookupFields = Array.from({ length: 22 }, (_, index) => ({
      id: `fld${String(index).padStart(16, '0')}`,
      name: `Lookup ${index}`,
      type: 'singleLineText',
      isLookup: true,
      lookupOptions: { foreignTableId, lookupFieldId: sourceFieldId },
      options: { choices: [{ name: 'Before' }] },
    }));
    const execute = vi.fn(
      async (
        _context: unknown,
        query: { tableId: { toString(): string }; fieldIds?: ReadonlyArray<{ toString(): string }> }
      ) => {
        const id = query.tableId.toString();
        if (id === tableId) {
          const fields = lookupFields.map((dto) => createSnapshotField(dto.id, dto as IFieldVo));
          return {
            isErr: () => false,
            value: {
              snapshots: fields.map((field, index) => ({
                id: lookupFields[index]!.id,
                version: 1,
                field,
              })),
              fields,
              primaryFieldId: { equals: () => false },
            },
          };
        }
        return {
          isErr: () => false,
          value: {
            fields: [
              createSnapshotField(sourceFieldId, {
                id: sourceFieldId,
                name: 'Status',
                type: 'singleSelect',
                options: { choices: sourceChoices },
              } as IFieldVo),
            ],
            primaryFieldId: { equals: () => false },
          },
        };
      }
    );
    const service = new FieldOpenApiV2Service(
      { getContainerForTable: vi.fn(async () => ({ resolve: () => ({ execute }) })) } as never,
      { createContext: vi.fn(async () => ({})) } as never,
      {} as never,
      {} as never,
      {} as never,
      {
        txClient: () => ({
          field: { findMany: async () => [] },
          tableMeta: {
            findUnique: async () => ({ baseId: `bse${'a'.repeat(16)}` }),
            findMany: async () => [],
          },
        }),
      } as never,
      {} as never
    );

    const before = await service.getSnapshotBulk(
      tableId,
      lookupFields.map((field) => field.id)
    );
    expect(before).toHaveLength(22);
    expect(before[0]?.data).toMatchObject({
      type: 'singleSelect',
      options: { choices: [{ name: 'Before' }] },
    });
    expect(execute.mock.calls.map(([, query]) => query.tableId.toString())).toEqual([
      tableId,
      foreignTableId,
      tableId,
    ]);
    expect(execute.mock.calls[1]?.[1].fieldIds?.map((id) => id.toString())).toEqual([
      sourceFieldId,
    ]);

    sourceChoices = [
      { id: 'choBefore', name: 'Before', color: 'blueBright' },
      { id: 'choAfter', name: 'After', color: 'greenBright' },
    ];
    const after = await service.getSnapshotBulk(
      tableId,
      lookupFields.map((field) => field.id)
    );
    expect(after[0]?.data.options).toMatchObject({
      choices: [{ name: 'Before' }, { name: 'After' }],
    });
    expect(
      execute.mock.calls.filter(([, query]) => query.tableId.toString() === foreignTableId)
    ).toHaveLength(2);
  });

  it('retries snapshot bulk when host lookup version changes during source hydration', async () => {
    const tableId = `tbl${'a'.repeat(16)}`;
    const foreignTableId = `tbl${'b'.repeat(16)}`;
    const lookupId = `fld${'0'.repeat(16)}`;
    const sourceFieldId = `fld${'d'.repeat(16)}`;
    let hostVersion = 1;
    const hostDto = (): IFieldVo =>
      ({
        id: lookupId,
        name: 'Lookup',
        isLookup: true,
        type: hostVersion === 1 ? 'singleLineText' : 'number',
        cellValueType: hostVersion === 1 ? 'string' : 'number',
        lookupOptions: { foreignTableId, lookupFieldId: sourceFieldId },
        options: {},
      }) as IFieldVo;
    const execute = vi.fn(async (_context: unknown, query: { tableId: { toString(): string } }) => {
      const id = query.tableId.toString();
      if (id === tableId) {
        const field = createSnapshotField(lookupId, hostDto(), hostVersion);
        return {
          isErr: () => false,
          value: {
            snapshots: [{ id: lookupId, version: hostVersion, field }],
            fields: [field],
            primaryFieldId: { equals: () => false },
          },
        };
      }
      hostVersion = 2;
      return {
        isErr: () => false,
        value: {
          fields: [
            createSnapshotField(sourceFieldId, {
              id: sourceFieldId,
              name: 'Amount',
              type: 'number',
              cellValueType: 'number',
              options: {},
            } as IFieldVo),
          ],
          primaryFieldId: { equals: () => false },
        },
      };
    });
    const service = new FieldOpenApiV2Service(
      { getContainerForTable: vi.fn(async () => ({ resolve: () => ({ execute }) })) } as never,
      { createContext: vi.fn(async () => ({})) } as never,
      {} as never,
      {} as never,
      {} as never,
      {
        txClient: () => ({
          field: { findMany: async () => [] },
          tableMeta: {
            findUnique: async () => ({ baseId: `bse${'a'.repeat(16)}` }),
            findMany: async () => [],
          },
        }),
      } as never,
      {} as never
    );

    const snapshots = await service.getSnapshotBulk(tableId, [lookupId]);
    expect(snapshots).toHaveLength(1);
    expect(snapshots[0]).toMatchObject({
      id: lookupId,
      v: 2,
      data: { type: 'number', cellValueType: 'number' },
    });
  });

  it('rejects snapshot bulk with conflict when host versions never stabilize', async () => {
    const tableId = `tbl${'a'.repeat(16)}`;
    const foreignTableId = `tbl${'b'.repeat(16)}`;
    const lookupId = `fld${'0'.repeat(16)}`;
    const sourceFieldId = `fld${'d'.repeat(16)}`;
    let hostVersion = 1;
    const hostDto = (): IFieldVo =>
      ({
        id: lookupId,
        name: 'Lookup',
        isLookup: true,
        type: hostVersion === 1 ? 'singleLineText' : 'number',
        cellValueType: hostVersion === 1 ? 'string' : 'number',
        lookupOptions: { foreignTableId, lookupFieldId: sourceFieldId },
        options: {},
      }) as IFieldVo;
    const execute = vi.fn(async (_context: unknown, query: { tableId: { toString(): string } }) => {
      const id = query.tableId.toString();
      if (id === tableId) {
        const field = createSnapshotField(lookupId, hostDto(), hostVersion);
        return {
          isErr: () => false,
          value: {
            snapshots: [{ id: lookupId, version: hostVersion, field }],
            fields: [field],
            primaryFieldId: { equals: () => false },
          },
        };
      }
      hostVersion += 1;
      return {
        isErr: () => false,
        value: {
          fields: [
            createSnapshotField(sourceFieldId, {
              id: sourceFieldId,
              name: 'Amount',
              type: 'number',
              cellValueType: 'number',
              options: {},
            } as IFieldVo),
          ],
          primaryFieldId: { equals: () => false },
        },
      };
    });
    const service = new FieldOpenApiV2Service(
      { getContainerForTable: vi.fn(async () => ({ resolve: () => ({ execute }) })) } as never,
      { createContext: vi.fn(async () => ({})) } as never,
      {} as never,
      {} as never,
      {} as never,
      {
        txClient: () => ({
          field: { findMany: async () => [] },
          tableMeta: {
            findUnique: async () => ({ baseId: `bse${'a'.repeat(16)}` }),
            findMany: async () => [],
          },
        }),
      } as never,
      {} as never
    );

    const error = await service.getSnapshotBulk(tableId, [lookupId]).catch((caught) => caught);
    expect(error).toBeInstanceOf(HttpException);
    expect((error as HttpException).getStatus()).toBe(HttpStatus.CONFLICT);
    expect(error).toMatchObject({ message: 'Field snapshot changed during hydration' });
  });
});

describe('FieldOpenApiV2Service lookup metadata reads (T7180)', () => {
  const hostTableId = `tbl${'a'.repeat(16)}`;
  const foreignTableId = `tbl${'b'.repeat(16)}`;
  const otherTableId = `tbl${'c'.repeat(16)}`;
  const sourceFieldId = `fld${'d'.repeat(16)}`;
  const otherSourceFieldId = `fld${'e'.repeat(16)}`;
  const lookupFields = Array.from({ length: 22 }, (_, index) => ({
    id: `fld${String(index).padStart(16, '0')}`,
    name: `Lookup ${index}`,
    type: 'singleLineText',
    isLookup: true,
    lookupOptions: {
      foreignTableId: index === 21 ? otherTableId : foreignTableId,
      lookupFieldId: index === 21 ? otherSourceFieldId : sourceFieldId,
    },
    options: {},
  }));

  const setup = (nestedSource = false) => {
    let sourceChoices = [{ id: 'choFirst', name: 'First', color: 'redBright' }];
    let failForeign = false;
    let requestId = 0;
    let mappedFields = 0;
    const execute = vi.fn(
      async (
        _context: unknown,
        query: {
          tableId: { toString(): string };
          fieldIds?: ReadonlyArray<{ toString(): string }>;
        }
      ) => {
        const id = query.tableId.toString();
        if (id === foreignTableId && failForeign) throw new Error('Foreign metadata unavailable');
        const dtos =
          id === hostTableId
            ? lookupFields
            : [
                {
                  id: id === otherTableId ? otherSourceFieldId : sourceFieldId,
                  name: 'Source',
                  ...(nestedSource && id === foreignTableId
                    ? {
                        isLookup: true,
                        lookupOptions: {
                          foreignTableId: otherTableId,
                          lookupFieldId: otherSourceFieldId,
                        },
                      }
                    : {}),
                  type: id === otherTableId ? 'number' : 'singleSelect',
                  options:
                    id === otherTableId
                      ? { formatting: { type: 'decimal', precision: 3 } }
                      : { choices: sourceChoices },
                },
              ];
        return {
          isErr: () => false,
          value: {
            fields: dtos.map((dto) => ({
              id: () => ({ toString: () => dto.id }),
              version: () => ({
                isErr: () => false,
                isOk: () => true,
                value: { toNumber: () => 1 },
              }),
              get __testDto() {
                mappedFields++;
                return dto;
              },
            })),
            primaryFieldId: undefined,
            view: undefined,
          },
        };
      }
    );
    const contextFactory = { createContext: vi.fn(async () => ({ requestId: ++requestId })) };
    const service = new FieldOpenApiV2Service(
      { getContainerForTable: vi.fn(async () => ({ resolve: () => ({ execute }) })) } as never,
      contextFactory as never,
      {} as never,
      {} as never,
      {} as never,
      {
        txClient: () => ({
          field: { findMany: async () => lookupFields.map(({ id }) => ({ id, version: 1 })) },
        }),
      } as never,
      {} as never
    );
    return {
      service,
      execute,
      contextFactory,
      mappedFieldCount: () => mappedFields,
      changeSource: () => {
        sourceChoices = [{ id: 'choSecond', name: 'Second', color: 'blueBright' }];
      },
      failSource: (fail: boolean) => {
        failForeign = fail;
      },
    };
  };

  it('loads each foreign table once for a 22-lookup field list, preserving distinct field results', async () => {
    const { service, execute, contextFactory, mappedFieldCount } = setup();
    const fields = await service.getFields(hostTableId);
    expect(fields).toHaveLength(22);
    expect(mappedFieldCount()).toBe(24);
    expect(execute.mock.calls.map(([, query]) => query.tableId.toString())).toEqual([
      hostTableId,
      foreignTableId,
      otherTableId,
    ]);
    expect(execute.mock.calls[0]?.[1].fieldIds).toBeUndefined();
    expect(execute.mock.calls[1]?.[1].fieldIds?.map((id) => id.toString())).toEqual([
      sourceFieldId,
    ]);
    expect(execute.mock.calls[2]?.[1].fieldIds?.map((id) => id.toString())).toEqual([
      otherSourceFieldId,
    ]);
    expect(contextFactory.createContext).toHaveBeenCalledTimes(1);
    const context = execute.mock.calls[0][0];
    expect(execute.mock.calls.every(([queryContext]) => queryContext === context)).toBe(true);
    expect(fields[0]).toMatchObject({
      type: 'singleSelect',
      options: { choices: [{ name: 'First' }] },
    });
    expect(fields[21]).toMatchObject({
      type: 'number',
      options: { formatting: { precision: 3 } },
    });
    expect(fields[0].options).not.toBe(fields[1].options);
  });

  it('shares reads through nested lookup hydration as well as direct references', async () => {
    const { service, execute } = setup(true);
    const fields = await service.getFields(hostTableId);
    expect(fields.every((field) => field.type === 'number')).toBe(true);
    expect(execute.mock.calls.map(([, query]) => query.tableId.toString())).toEqual([
      hostTableId,
      foreignTableId,
      otherTableId,
    ]);
    expect(execute.mock.calls[0]?.[1].fieldIds).toBeUndefined();
    expect(execute.mock.calls[1]?.[1].fieldIds?.map((id) => id.toString())).toEqual([
      sourceFieldId,
    ]);
    expect(execute.mock.calls[2]?.[1].fieldIds?.map((id) => id.toString())).toEqual([
      otherSourceFieldId,
    ]);
  });

  it('reuses an in-flight foreign field read when nested hydration requests the same field', async () => {
    const hostTableId = `tbl${'h'.repeat(16)}`;
    const tableA = `tbl${'a'.repeat(16)}`;
    const tableB = `tbl${'b'.repeat(16)}`;
    const fieldA = `fld${'a'.repeat(16)}`;
    const fieldB = `fld${'b'.repeat(16)}`;
    const hostDirectId = `fld${'1'.padStart(16, '0')}`;
    const hostNestedId = `fld${'2'.padStart(16, '0')}`;
    let releaseB = () => undefined as void;
    const bGate = new Promise<void>((resolve) => {
      releaseB = resolve;
    });
    let bQueries = 0;
    let bStarted = () => undefined as void;
    const bStartedAt = new Promise<void>((resolve) => {
      bStarted = resolve;
    });
    const execute = vi.fn(async (_context: unknown, query: { tableId: { toString(): string } }) => {
      const id = query.tableId.toString();
      const dto =
        id === hostTableId
          ? [
              {
                id: hostDirectId,
                isLookup: true,
                lookupOptions: { foreignTableId: tableB, lookupFieldId: fieldB },
                type: 'singleLineText',
                options: {},
              },
              {
                id: hostNestedId,
                isLookup: true,
                lookupOptions: { foreignTableId: tableA, lookupFieldId: fieldA },
                type: 'singleLineText',
                options: {},
              },
            ]
          : id === tableA
            ? [
                {
                  id: fieldA,
                  isLookup: true,
                  lookupOptions: { foreignTableId: tableB, lookupFieldId: fieldB },
                  type: 'singleLineText',
                  options: {},
                },
              ]
            : [
                {
                  id: fieldB,
                  type: 'number',
                  cellValueType: 'number',
                  options: {},
                },
              ];
      if (id === tableB) {
        bQueries++;
        bStarted();
        await bGate;
      }
      return {
        isErr: () => false,
        value: {
          fields: dto.map((field) => ({
            id: () => ({ toString: () => field.id }),
            get __testDto() {
              return field;
            },
          })),
          primaryFieldId: { equals: () => false },
        },
      };
    });
    const service = new FieldOpenApiV2Service(
      { getContainerForTable: vi.fn(async () => ({ resolve: () => ({ execute }) })) } as never,
      { createContext: vi.fn(async () => ({})) } as never,
      {} as never,
      {} as never,
      {} as never,
      {
        txClient: () => ({
          field: { findMany: async () => [] },
        }),
      } as never,
      {} as never
    );

    const pending = service.getFields(hostTableId);
    await bStartedAt;
    await Promise.resolve();
    await Promise.resolve();
    expect(bQueries).toBe(1);
    releaseB();
    const fields = await pending;
    expect(bQueries).toBe(1);
    expect(fields).toHaveLength(2);
    expect(fields.every((field) => field.type === 'number')).toBe(true);
  });

  it('reads changed foreign metadata on the next operation even for the same service instance', async () => {
    const { service, execute, changeSource } = setup();
    await service.getFields(hostTableId);
    changeSource();
    const fields = await service.getFields(hostTableId);
    expect(fields[0]).toMatchObject({ options: { choices: [{ name: 'Second' }] } });
    expect(
      execute.mock.calls.filter(([, query]) => query.tableId.toString() === foreignTableId)
    ).toHaveLength(2);
  });

  it('shares a rejected foreign read for one operation and retries it on the next operation', async () => {
    const { service, execute, failSource } = setup();
    failSource(true);
    const fields = await service.getFields(hostTableId);
    expect(fields[0].type).toBe('singleLineText');
    expect(fields[21].type).toBe('number');
    expect(
      execute.mock.calls.filter(([, query]) => query.tableId.toString() === foreignTableId)
    ).toHaveLength(1);
    failSource(false);
    const recovered = await service.getFields(hostTableId);
    expect(recovered[0].type).toBe('singleSelect');
    expect(
      execute.mock.calls.filter(([, query]) => query.tableId.toString() === foreignTableId)
    ).toHaveLength(2);
  });

  it('does not coalesce concurrent operations with different execution contexts', async () => {
    const { service, execute, contextFactory } = setup();
    await Promise.all([service.getFields(hostTableId), service.getFields(hostTableId)]);
    expect(contextFactory.createContext).toHaveBeenCalledTimes(2);
    const foreignCalls = execute.mock.calls.filter(
      ([, query]) => query.tableId.toString() === foreignTableId
    );
    expect(foreignCalls).toHaveLength(2);
    expect(foreignCalls[0][0]).not.toBe(foreignCalls[1][0]);
  });
});

describe('FieldOpenApiV2Service updateField', () => {
  it('invalidates foreign table field cache for partial link field updates', async () => {
    const tableId = `tbl${'a'.repeat(16)}`;
    const foreignTableId = `tbl${'b'.repeat(16)}`;
    const fieldId = `fld${'c'.repeat(16)}`;
    const context: Record<string, unknown> = {};
    const fieldDto = {
      id: fieldId,
      type: 'link',
      name: 'Linked table',
      options: {
        relationship: 'manyMany',
        foreignTableId,
        lookupFieldId: `fld${'d'.repeat(16)}`,
        symmetricFieldId: `fld${'e'.repeat(16)}`,
      },
    };
    executeUpdateFieldEndpoint.mockResolvedValue({
      status: 200,
      body: { ok: true },
    });
    const commandBus = {};
    const domainField = {
      id: () => ({ toString: () => fieldId }),
      __testDto: fieldDto,
    };
    const queryBus = {
      execute: vi.fn().mockResolvedValue({
        isErr: () => false,
        value: {
          fields: [domainField],
          primaryFieldId: undefined,
          view: undefined,
        },
      }),
    };
    const container = {
      resolve: vi.fn((token: symbol) => {
        if (token === v2CoreTokens.commandBus) return commandBus;
        if (token === v2CoreTokens.queryBus) return queryBus;
        throw new Error(`Unexpected token ${String(token)}`);
      }),
    };
    const dataLoaderService = {
      field: {
        invalidateTables: vi.fn(),
      },
    };
    const service = new FieldOpenApiV2Service(
      {
        getContainerForTable: vi.fn().mockResolvedValue(container),
      } as never,
      {
        createContext: vi.fn().mockResolvedValue(context),
      } as never,
      dataLoaderService as never,
      {
        get: vi.fn((key: string) => (key === 'user.id' ? `usr${'f'.repeat(16)}` : undefined)),
      } as never,
      {} as never,
      {} as never
    );

    await service.updateField(tableId, fieldId, { name: 'Renamed linked table' });

    expect(executeUpdateFieldEndpoint).toHaveBeenCalledWith(
      context,
      {
        tableId,
        fieldId,
        field: {
          name: 'Renamed linked table',
        },
      },
      commandBus
    );
    expect(dataLoaderService.field.invalidateTables).toHaveBeenCalledWith([
      tableId,
      foreignTableId,
    ]);
  });
});

describe('FieldOpenApiV2Service mapConvertFieldToV2', () => {
  it('maps lookup convert options with filter/sort/limit', () => {
    const service = createService();
    const mapped = service.mapConvertFieldToV2({
      type: 'lookup',
      isLookup: true,
      lookupOptions: {
        linkFieldId: 'fldLink000000000001',
        lookupFieldId: 'fldLookup000000001',
        foreignTableId: 'tblForeign00000001',
        filter: {
          conjunction: 'and',
          filterSet: [{ fieldId: 'fldStatus000000001', operator: 'is', value: 'Active' }],
        },
        sort: { fieldId: 'fldScore0000000001', order: 'desc' },
        limit: 5,
      },
    });

    expect(mapped).toEqual({
      type: 'lookup',
      options: {
        linkFieldId: 'fldLink000000000001',
        lookupFieldId: 'fldLookup000000001',
        foreignTableId: 'tblForeign00000001',
        filter: {
          conjunction: 'and',
          filterSet: [{ fieldId: 'fldStatus000000001', operator: 'is', value: 'Active' }],
        },
        sort: { fieldId: 'fldScore0000000001', order: 'desc' },
        limit: 5,
      },
    });
  });

  it('clears lookup filter/sort/limit when convert payload omits them', () => {
    const service = createService();
    const mapped = service.mapConvertFieldToV2(
      {
        type: 'number',
        isLookup: true,
        lookupOptions: {
          linkFieldId: 'fldLink000000000001',
          lookupFieldId: 'fldLookup000000001',
          foreignTableId: 'tblForeign00000001',
        },
      },
      {
        type: 'number',
        isLookup: true,
        lookupOptions: {
          linkFieldId: 'fldLink000000000001',
          lookupFieldId: 'fldLookup000000001',
          foreignTableId: 'tblForeign00000001',
          filter: {
            conjunction: 'and',
            filterSet: [{ fieldId: 'fldStatus000000001', operator: 'is', value: 'Active' }],
          },
          sort: { fieldId: 'fldScore0000000001', order: 'desc' },
          limit: 5,
        },
      }
    );

    expect(mapped).toEqual({
      type: 'lookup',
      options: {
        linkFieldId: 'fldLink000000000001',
        lookupFieldId: 'fldLookup000000001',
        foreignTableId: 'tblForeign00000001',
        filter: undefined,
        sort: undefined,
        limit: undefined,
      },
    });
  });

  it('maps lookup-of-formula convert payloads as lookup, not host formula', () => {
    const service = createService();
    const mapped = service.mapConvertFieldToV2(
      {
        type: 'formula',
        isLookup: true,
        lookupOptions: {
          linkFieldId: 'fldLink000000000001',
          lookupFieldId: 'fldLookup000000001',
          foreignTableId: 'tblForeign00000001',
        },
        options: {
          expression: 'CONCATENATE({fldForeignText0001}, " / ", {fldForeignCode0001})',
          formatting: { precision: 4, type: 'decimal' },
        },
      },
      {
        type: 'formula',
        isLookup: true,
        cellValueType: 'number',
        isMultipleCellValue: false,
        lookupOptions: {
          linkFieldId: 'fldLink000000000001',
          lookupFieldId: 'fldLookup000000001',
          foreignTableId: 'tblForeign00000001',
        },
        options: {
          expression: 'CONCATENATE({fldForeignText0001}, " / ", {fldForeignCode0001})',
          formatting: { precision: 2, type: 'decimal' },
        },
      }
    );

    expect(mapped).toEqual({
      type: 'lookup',
      options: {
        linkFieldId: 'fldLink000000000001',
        lookupFieldId: 'fldLookup000000001',
        foreignTableId: 'tblForeign00000001',
      },
      innerOptions: {
        formatting: { precision: 4, type: 'decimal' },
      },
    });
  });

  it('maps rollup convert options with foreignTableId and showAs', () => {
    const service = createService();
    const mapped = service.mapConvertFieldToV2({
      type: 'rollup',
      options: {
        linkFieldId: 'fldLink000000000001',
        lookupFieldId: 'fldLookup000000001',
        foreignTableId: 'tblForeign00000001',
        expression: 'sum({values})',
        formatting: { type: 'decimal', precision: 2 },
        showAs: { type: 'bar', color: 'yellowBright', showValue: true, maxValue: 100 },
        timeZone: 'utc',
      },
    });

    expect(mapped).toEqual({
      type: 'rollup',
      options: {
        expression: 'sum({values})',
        formatting: { type: 'decimal', precision: 2 },
        showAs: { type: 'bar', color: 'yellowBright', showValue: true, maxValue: 100 },
        timeZone: 'utc',
      },
      config: {
        linkFieldId: 'fldLink000000000001',
        lookupFieldId: 'fldLookup000000001',
        foreignTableId: 'tblForeign00000001',
      },
    });
  });

  it('maps rollup convert config from lookupOptions when options omit link ids', () => {
    const service = createService();
    const mapped = service.mapConvertFieldToV2({
      type: 'rollup',
      options: {
        expression: 'countall({values})',
      },
      lookupOptions: {
        linkFieldId: 'fldLink000000000001',
        lookupFieldId: 'fldLookup000000001',
        foreignTableId: 'tblForeign00000001',
      },
    });

    expect(mapped).toEqual({
      type: 'rollup',
      options: {
        expression: 'countall({values})',
      },
      config: {
        linkFieldId: 'fldLink000000000001',
        lookupFieldId: 'fldLookup000000001',
        foreignTableId: 'tblForeign00000001',
      },
    });
  });

  it('maps rollup convert filter from lookupOptions (T6179)', () => {
    const service = createService();
    const filter = {
      conjunction: 'and',
      filterSet: [{ fieldId: 'fldStatus000000001', operator: 'is', value: '待开始' }],
    };
    const mapped = service.mapConvertFieldToV2({
      type: 'rollup',
      options: {
        expression: 'countall({values})',
      },
      lookupOptions: {
        linkFieldId: 'fldLink000000000001',
        lookupFieldId: 'fldLookup000000001',
        foreignTableId: 'tblForeign00000001',
        filter,
      },
    });

    expect(mapped).toEqual({
      type: 'rollup',
      options: {
        expression: 'countall({values})',
      },
      config: {
        linkFieldId: 'fldLink000000000001',
        lookupFieldId: 'fldLookup000000001',
        foreignTableId: 'tblForeign00000001',
        filter,
      },
    });
  });

  it('preserves existing rollup filter when convert omits lookupOptions (T6179)', () => {
    const service = createService();
    const filter = {
      conjunction: 'and',
      filterSet: [{ fieldId: 'fldStatus000000001', operator: 'is', value: 'Active' }],
    };
    const mapped = service.mapConvertFieldToV2(
      {
        type: 'rollup',
        options: {
          linkFieldId: 'fldLink000000000001',
          lookupFieldId: 'fldLookup000000001',
          foreignTableId: 'tblForeign00000001',
          expression: 'sum({values})',
        },
      },
      {
        type: 'rollup',
        options: {
          expression: 'countall({values})',
        },
        lookupOptions: {
          linkFieldId: 'fldLink000000000001',
          lookupFieldId: 'fldLookup000000001',
          foreignTableId: 'tblForeign00000001',
          filter,
        },
      }
    );

    expect(mapped).toEqual({
      type: 'rollup',
      options: {
        expression: 'sum({values})',
        showAs: null,
      },
      config: {
        linkFieldId: 'fldLink000000000001',
        lookupFieldId: 'fldLookup000000001',
        foreignTableId: 'tblForeign00000001',
        filter,
      },
    });
  });

  it('clears rollup filter when lookupOptions is present without filter (T6179)', () => {
    const service = createService();
    const filter = {
      conjunction: 'and',
      filterSet: [{ fieldId: 'fldStatus000000001', operator: 'is', value: 'Active' }],
    };
    const mapped = service.mapConvertFieldToV2(
      {
        type: 'rollup',
        options: {
          expression: 'countall({values})',
        },
        lookupOptions: {
          linkFieldId: 'fldLink000000000001',
          lookupFieldId: 'fldLookup000000001',
          foreignTableId: 'tblForeign00000001',
        },
      },
      {
        type: 'rollup',
        options: {
          expression: 'countall({values})',
        },
        lookupOptions: {
          linkFieldId: 'fldLink000000000001',
          lookupFieldId: 'fldLookup000000001',
          foreignTableId: 'tblForeign00000001',
          filter,
        },
      }
    );

    expect(mapped).toEqual({
      type: 'rollup',
      options: {
        expression: 'countall({values})',
        showAs: null,
      },
      config: {
        linkFieldId: 'fldLink000000000001',
        lookupFieldId: 'fldLookup000000001',
        foreignTableId: 'tblForeign00000001',
        filter: null,
      },
    });
  });

  it('maps conditionalRollup convert options with showAs', () => {
    const service = createService();
    const mapped = service.mapConvertFieldToV2({
      type: 'conditionalRollup',
      options: {
        foreignTableId: 'tblForeign00000001',
        lookupFieldId: 'fldLookup000000001',
        expression: 'array_compact({values})',
        filter: {
          conjunction: 'and',
          filterSet: [{ fieldId: 'fldStatus000000001', operator: 'is', value: 'Active' }],
        },
        sort: { fieldId: 'fldScore0000000001', order: 'asc' },
        limit: 1,
        showAs: { type: 'email' },
      },
      cellValueType: 'string',
      isMultipleCellValue: true,
    });

    expect(mapped).toEqual({
      type: 'conditionalRollup',
      cellValueType: 'string',
      isMultipleCellValue: true,
      options: {
        expression: 'array_compact({values})',
        showAs: { type: 'email' },
      },
      config: {
        foreignTableId: 'tblForeign00000001',
        lookupFieldId: 'fldLookup000000001',
        condition: {
          filter: {
            conjunction: 'and',
            filterSet: [{ fieldId: 'fldStatus000000001', operator: 'is', value: 'Active' }],
          },
          sort: { fieldId: 'fldScore0000000001', order: 'asc' },
          limit: 1,
        },
      },
    });
  });

  it('preserves cross-base id on conditionalRollup convert (T7064)', () => {
    const service = createService();
    const mapped = service.mapConvertFieldToV2({
      type: 'conditionalRollup',
      options: {
        baseId: 'bseForeign000000001',
        foreignTableId: 'tblForeign00000001',
        lookupFieldId: 'fldLookup000000001',
        expression: 'sum({values})',
        filter: {
          conjunction: 'and',
          filterSet: [{ fieldId: 'fldStatus000000001', operator: 'is', value: 'Active' }],
        },
      },
    });

    expect(mapped).toMatchObject({
      type: 'conditionalRollup',
      config: {
        baseId: 'bseForeign000000001',
        foreignTableId: 'tblForeign00000001',
        lookupFieldId: 'fldLookup000000001',
      },
    });
  });

  it('preserves cross-base id on conditional lookup convert (T7064)', () => {
    const service = createService();
    const mapped = service.mapConvertFieldToV2({
      type: 'number',
      isLookup: true,
      isConditionalLookup: true,
      lookupOptions: {
        baseId: 'bseForeign000000001',
        foreignTableId: 'tblForeign00000001',
        lookupFieldId: 'fldLookup000000001',
        filter: {
          conjunction: 'and',
          filterSet: [{ fieldId: 'fldStatus000000001', operator: 'is', value: 'Active' }],
        },
      },
    });

    expect(mapped).toMatchObject({
      type: 'conditionalLookup',
      options: {
        baseId: 'bseForeign000000001',
        foreignTableId: 'tblForeign00000001',
        lookupFieldId: 'fldLookup000000001',
      },
    });
  });

  it('omits incomplete conditionalRollup result type in convert payload', () => {
    const service = createService();
    const mapped = service.mapConvertFieldToV2({
      type: 'conditionalRollup',
      options: {
        foreignTableId: 'tblForeign00000001',
        lookupFieldId: 'fldLookup000000001',
        expression: 'sum({values})',
        filter: {
          conjunction: 'and',
          filterSet: [{ fieldId: 'fldStatus000000001', operator: 'is', value: 'Active' }],
        },
      },
      cellValueType: 'number',
    });

    expect(mapped).toEqual({
      type: 'conditionalRollup',
      options: {
        expression: 'sum({values})',
      },
      config: {
        foreignTableId: 'tblForeign00000001',
        lookupFieldId: 'fldLookup000000001',
        condition: {
          filter: {
            conjunction: 'and',
            filterSet: [{ fieldId: 'fldStatus000000001', operator: 'is', value: 'Active' }],
          },
        },
      },
    });
  });

  it('maps conditional lookup convert with carried result type from current field', () => {
    const service = createService();
    const mapped = service.mapConvertFieldToV2(
      {
        type: 'formula',
        isLookup: true,
        isConditionalLookup: true,
        lookupOptions: {
          foreignTableId: 'tblForeign00000001',
          lookupFieldId: 'fldLookup000000001',
          filter: {
            conjunction: 'and',
            filterSet: [{ fieldId: 'fldStatus000000001', operator: 'is', value: 'Active' }],
          },
        },
        options: {
          expression: 'NOW()',
        },
      },
      {
        type: 'formula',
        cellValueType: 'dateTime',
        isMultipleCellValue: true,
        lookupOptions: {
          foreignTableId: 'tblForeign00000001',
          lookupFieldId: 'fldLookup000000001',
          filter: {
            conjunction: 'and',
            filterSet: [{ fieldId: 'fldStatus000000001', operator: 'is', value: 'Active' }],
          },
          sort: { fieldId: 'fldScore0000000001', order: 'desc' },
          limit: 1,
        },
      }
    );

    expect(mapped).toEqual({
      type: 'conditionalLookup',
      cellValueType: 'dateTime',
      isMultipleCellValue: true,
      options: {
        foreignTableId: 'tblForeign00000001',
        lookupFieldId: 'fldLookup000000001',
        condition: {
          filter: {
            conjunction: 'and',
            filterSet: [{ fieldId: 'fldStatus000000001', operator: 'is', value: 'Active' }],
          },
        },
        innerType: 'formula',
        innerOptions: {
          expression: 'NOW()',
        },
      },
    });
  });

  it('does not carry string result type fallback for formula conditional lookup with formatting', () => {
    const service = createService();
    const mapped = service.mapConvertFieldToV2(
      {
        type: 'formula',
        isLookup: true,
        isConditionalLookup: true,
        lookupOptions: {
          foreignTableId: 'tblForeign00000001',
          lookupFieldId: 'fldLookup000000001',
          filter: {
            conjunction: 'and',
            filterSet: [{ fieldId: 'fldStatus000000001', operator: 'is', value: 'Active' }],
          },
        },
        options: {
          expression: 'NOW()',
          formatting: { date: 'YYYY-MM-DD', time: 'HH:mm', timeZone: 'Asia/Shanghai' },
        },
      },
      {
        type: 'formula',
        cellValueType: 'string',
        isMultipleCellValue: true,
      }
    );

    expect(mapped).toEqual({
      type: 'conditionalLookup',
      isMultipleCellValue: true,
      options: {
        foreignTableId: 'tblForeign00000001',
        lookupFieldId: 'fldLookup000000001',
        condition: {
          filter: {
            conjunction: 'and',
            filterSet: [{ fieldId: 'fldStatus000000001', operator: 'is', value: 'Active' }],
          },
        },
        innerType: 'formula',
        innerOptions: {
          expression: 'NOW()',
          formatting: { date: 'YYYY-MM-DD', time: 'HH:mm', timeZone: 'Asia/Shanghai' },
        },
      },
    });
  });

  it('omits rollup config when config keys are incomplete', () => {
    const service = createService();
    const mapped = service.mapConvertFieldToV2({
      type: 'rollup',
      options: {
        expression: 'sum({values})',
        showAs: { type: 'email' },
      },
    });

    expect(mapped).toEqual({
      type: 'rollup',
      options: {
        expression: 'sum({values})',
        showAs: { type: 'email' },
      },
    });
  });

  it('marks rollup showAs for clearing when options are replaced', () => {
    const service = createService();
    const mapped = service.mapConvertFieldToV2(
      {
        type: 'rollup',
        options: {
          expression: 'concatenate({values})',
        },
      },
      {
        type: 'rollup',
        options: {
          showAs: { type: 'email' },
        },
      }
    );

    expect(mapped).toEqual({
      type: 'rollup',
      options: {
        expression: 'concatenate({values})',
        showAs: null,
      },
    });
  });

  it('marks formula showAs for clearing when options are replaced', () => {
    const service = createService();
    const mapped = service.mapConvertFieldToV2(
      {
        type: 'formula',
        options: {
          expression: '"text"',
        },
      },
      {
        type: 'formula',
        options: {
          showAs: { type: 'email' },
        },
      }
    );

    expect(mapped).toEqual({
      type: 'formula',
      options: {
        expression: '"text"',
        showAs: null,
      },
    });
  });

  it('marks singleLineText showAs for clearing on default pass-through mapping', () => {
    const service = createService();
    const mapped = service.mapConvertFieldToV2(
      {
        type: 'singleLineText',
        options: {},
      },
      {
        type: 'singleLineText',
        options: {
          showAs: { type: 'email' },
        },
      }
    );

    expect(mapped).toEqual({
      type: 'singleLineText',
      options: {
        showAs: null,
      },
    });
  });

  it('marks formula showAs for clearing on update mapping', () => {
    const service = createService();
    const mapped = service.mapLegacyUpdateFieldToV2(
      {
        type: 'formula',
        options: {
          expression: '"text"',
        },
      },
      {
        type: 'formula',
        options: {
          showAs: { type: 'email' },
        },
      }
    );

    expect(mapped).toEqual({
      type: 'formula',
      options: {
        expression: '"text"',
        showAs: null,
      },
    });
  });

  it('marks singleLineText showAs for clearing on update mapping', () => {
    const service = createService();
    const mapped = service.mapLegacyUpdateFieldToV2(
      {
        type: 'singleLineText',
        options: {},
      },
      {
        type: 'singleLineText',
        options: {
          showAs: { type: 'email' },
        },
      }
    );

    expect(mapped).toEqual({
      type: 'singleLineText',
      options: {
        showAs: null,
      },
    });
  });
});

describe('FieldOpenApiV2Service mapLegacyCreateFieldToV2', () => {
  it('applies legacy default names when create payload omits name', () => {
    const service = createService();

    expect(
      service.mapLegacyCreateFieldToV2({
        type: 'singleSelect',
      })
    ).toMatchObject({
      type: 'singleSelect',
      name: 'Select',
    });

    expect(
      service.mapLegacyCreateFieldToV2({
        type: 'createdTime',
      })
    ).toMatchObject({
      type: 'createdTime',
      name: 'Created Time',
    });

    expect(
      service.mapLegacyCreateFieldToV2({
        type: 'user',
        options: { isMultiple: true },
      })
    ).toMatchObject({
      type: 'user',
      name: 'Collaborators',
    });
  });

  it('does not prefill legacy default names for semantic lookup fields', () => {
    const service = createService();

    expect(
      service.mapLegacyCreateFieldToV2({
        type: 'singleLineText',
        isLookup: true,
        lookupOptions: {
          foreignTableId: 'tblForeign00000001',
          lookupFieldId: 'fldLookup000000001',
          linkFieldId: 'fldLink000000000001',
        },
      })
    ).toEqual({
      id: expect.any(String),
      type: 'lookup',
      legacyMultiplicityDerivation: true,
      options: {
        foreignTableId: 'tblForeign00000001',
        lookupFieldId: 'fldLookup000000001',
        linkFieldId: 'fldLink000000000001',
      },
    });
  });

  it('passes dbFieldName through create payload', () => {
    const service = createService();
    const mapped = service.mapLegacyCreateFieldToV2({
      type: 'singleLineText',
      name: 'TextField',
      dbFieldName: 'fldCustomCreateField001',
    });

    expect(mapped).toMatchObject({
      type: 'singleLineText',
      name: 'TextField',
      dbFieldName: 'fldCustomCreateField001',
    });
  });

  it('passes aiConfig through create payload', () => {
    const service = createService();
    const mapped = service.mapLegacyCreateFieldToV2({
      type: 'singleLineText',
      aiConfig: {
        type: 'summary',
        sourceFieldId: 'fldSource000000001',
      },
    });

    expect(mapped).toMatchObject({
      type: 'singleLineText',
      aiConfig: {
        type: 'summary',
        sourceFieldId: 'fldSource000000001',
      },
    });
  });

  it('does not keep legacy false lookup multiplicity without link relationship context', () => {
    const service = createService();
    const mapped = service.mapLegacyCreateFieldToV2({
      type: 'singleLineText',
      isLookup: true,
      isMultipleCellValue: false,
      lookupOptions: {
        foreignTableId: 'tblForeign00000001',
        lookupFieldId: 'fldLookup000000001',
        linkFieldId: 'fldLink000000000001',
      },
    });

    expect(mapped).toMatchObject({
      type: 'lookup',
      options: {
        foreignTableId: 'tblForeign00000001',
        lookupFieldId: 'fldLookup000000001',
        linkFieldId: 'fldLink000000000001',
      },
    });
    expect(mapped).not.toHaveProperty('isMultipleCellValue');
  });

  it('does not derive lookup multiplicity at openapi mapping layer', () => {
    const service = createService();
    const mapped = service.mapLegacyCreateFieldToV2({
      type: 'multipleSelect',
      isLookup: true,
      lookupOptions: {
        foreignTableId: 'tblForeign00000001',
        lookupFieldId: 'fldLookup000000001',
        linkFieldId: 'fldLink000000000001',
      },
    });

    expect(mapped).toMatchObject({
      type: 'lookup',
      options: {
        foreignTableId: 'tblForeign00000001',
        lookupFieldId: 'fldLookup000000001',
        linkFieldId: 'fldLink000000000001',
      },
    });
    expect(mapped).not.toHaveProperty('isMultipleCellValue');
  });

  it('marks legacy lookup create payload to derive multiplicity in domain layer', () => {
    const service = createService();
    const mapped = service.mapLegacyCreateFieldToV2({
      type: 'singleLineText',
      isLookup: true,
      lookupOptions: {
        foreignTableId: 'tblForeign00000001',
        lookupFieldId: 'fldLookup000000001',
        linkFieldId: 'fldLink000000000001',
      },
    });

    expect(mapped).toMatchObject({
      type: 'lookup',
      legacyMultiplicityDerivation: true,
    });
  });

  it('keeps explicit true lookup multiplicity from legacy payload', () => {
    const service = createService();
    const mapped = service.mapLegacyCreateFieldToV2({
      type: 'date',
      isLookup: true,
      isMultipleCellValue: true,
      lookupOptions: {
        foreignTableId: 'tblForeign00000001',
        lookupFieldId: 'fldLookup000000001',
        linkFieldId: 'fldLink000000000001',
      },
    });

    expect(mapped).toMatchObject({
      type: 'lookup',
      isMultipleCellValue: true,
      options: {
        foreignTableId: 'tblForeign00000001',
        lookupFieldId: 'fldLookup000000001',
        linkFieldId: 'fldLink000000000001',
      },
    });
  });

  it('strips formula expression from lookup create innerOptions', () => {
    const service = createService();
    const mapped = service.mapLegacyCreateFieldToV2({
      type: 'formula',
      isLookup: true,
      options: {
        expression: 'CONCATENATE({fldForeignText0001}, " / ", {fldForeignCode0001})',
        timeZone: 'Asia/Shanghai',
        formatting: { type: 'decimal', precision: 0 },
        showAs: { type: 'url' },
      },
      lookupOptions: {
        foreignTableId: 'tblForeign00000001',
        lookupFieldId: 'fldLookup000000001',
        linkFieldId: 'fldLink000000000001',
      },
    });

    expect(mapped).toEqual({
      id: expect.any(String),
      type: 'lookup',
      legacyMultiplicityDerivation: true,
      options: {
        foreignTableId: 'tblForeign00000001',
        lookupFieldId: 'fldLookup000000001',
        linkFieldId: 'fldLink000000000001',
      },
      innerOptions: {
        formatting: { type: 'decimal', precision: 0 },
        showAs: { type: 'url' },
      },
    });
  });

  it('keeps structural select options out of lookup convert innerOptions', () => {
    const service = createService();
    const mapped = service.mapConvertFieldToV2({
      type: 'singleSelect',
      isLookup: true,
      options: {
        choices: [],
      },
      lookupOptions: {
        foreignTableId: 'tblForeign00000001',
        lookupFieldId: 'fldLookup000000001',
        linkFieldId: 'fldLink000000000001',
      },
    });

    expect(mapped).toEqual({
      type: 'lookup',
      options: {
        foreignTableId: 'tblForeign00000001',
        lookupFieldId: 'fldLookup000000001',
        linkFieldId: 'fldLink000000000001',
      },
    });
  });

  it('T6901 maps convert of a select lookup onto a number lookup target', () => {
    const service = createService();
    const mapped = service.mapConvertFieldToV2(
      {
        type: 'number',
        isLookup: true,
        options: {
          formatting: { type: 'decimal', precision: 0 },
        },
        lookupOptions: {
          foreignTableId: 'tblForeign00000001',
          lookupFieldId: 'fldNumber0000000001',
          linkFieldId: 'fldLink000000000001',
        },
      },
      {
        type: 'singleSelect',
        isLookup: true,
        lookupOptions: {
          foreignTableId: 'tblForeign00000001',
          lookupFieldId: 'fldSelect0000000001',
          linkFieldId: 'fldLink000000000001',
        },
      }
    );

    expect(mapped).toEqual({
      type: 'lookup',
      options: {
        foreignTableId: 'tblForeign00000001',
        lookupFieldId: 'fldNumber0000000001',
        linkFieldId: 'fldLink000000000001',
      },
      innerOptions: {
        formatting: { type: 'decimal', precision: 0 },
      },
    });
  });

  it('maps conditional lookup create payload to v2 conditionalLookup input', () => {
    const service = createService();
    const mapped = service.mapLegacyCreateFieldToV2({
      type: 'number',
      isLookup: true,
      isConditionalLookup: true,
      options: {
        formatting: {
          type: 'currency',
          precision: 1,
          symbol: '¥',
        },
      },
      lookupOptions: {
        foreignTableId: 'tblForeign00000001',
        lookupFieldId: 'fldLookup000000001',
        filter: {
          conjunction: 'and',
          filterSet: [{ fieldId: 'fldStatus000000001', operator: 'is', value: 'Active' }],
        },
      },
    });

    expect(mapped).toMatchObject({
      type: 'conditionalLookup',
      options: {
        foreignTableId: 'tblForeign00000001',
        lookupFieldId: 'fldLookup000000001',
        condition: {
          filter: {
            conjunction: 'and',
            filterSet: [{ fieldId: 'fldStatus000000001', operator: 'is', value: 'Active' }],
          },
        },
      },
    });
    expect(mapped.id).toEqual(expect.stringMatching(/^fld[\da-zA-Z]{16}$/));
  });

  it('omits incomplete conditionalRollup result type in create payload', () => {
    const service = createService();
    const mapped = service.mapLegacyCreateFieldToV2({
      type: 'conditionalRollup',
      cellValueType: 'number',
      options: {
        foreignTableId: 'tblForeign00000001',
        lookupFieldId: 'fldLookup000000001',
        expression: 'sum({values})',
        filter: {
          conjunction: 'and',
          filterSet: [{ fieldId: 'fldStatus000000001', operator: 'is', value: 'Active' }],
        },
      },
    });

    expect(mapped).toEqual({
      id: expect.any(String),
      type: 'conditionalRollup',
      options: {
        expression: 'sum({values})',
      },
      config: {
        foreignTableId: 'tblForeign00000001',
        lookupFieldId: 'fldLookup000000001',
        condition: {
          filter: {
            conjunction: 'and',
            filterSet: [{ fieldId: 'fldStatus000000001', operator: 'is', value: 'Active' }],
          },
        },
      },
    });
  });

  it('preserves cross-base id on conditional lookup create (T7064)', () => {
    const service = createService();
    const mapped = service.mapLegacyCreateFieldToV2({
      type: 'number',
      isLookup: true,
      isConditionalLookup: true,
      lookupOptions: {
        baseId: 'bseForeign000000001',
        foreignTableId: 'tblForeign00000001',
        lookupFieldId: 'fldLookup000000001',
        filter: {
          conjunction: 'and',
          filterSet: [{ fieldId: 'fldStatus000000001', operator: 'is', value: 'Active' }],
        },
      },
    });

    expect(mapped).toMatchObject({
      type: 'conditionalLookup',
      options: {
        baseId: 'bseForeign000000001',
        foreignTableId: 'tblForeign00000001',
        lookupFieldId: 'fldLookup000000001',
      },
    });
  });

  it('preserves cross-base id on conditionalRollup create (T7064)', () => {
    const service = createService();
    const mapped = service.mapLegacyCreateFieldToV2({
      type: 'conditionalRollup',
      options: {
        baseId: 'bseForeign000000001',
        foreignTableId: 'tblForeign00000001',
        lookupFieldId: 'fldLookup000000001',
        expression: 'sum({values})',
        filter: {
          conjunction: 'and',
          filterSet: [{ fieldId: 'fldStatus000000001', operator: 'is', value: 'Active' }],
        },
      },
    });

    expect(mapped).toMatchObject({
      type: 'conditionalRollup',
      config: {
        baseId: 'bseForeign000000001',
        foreignTableId: 'tblForeign00000001',
        lookupFieldId: 'fldLookup000000001',
      },
    });
  });

  it('maps rollup create payload and splits config from options', () => {
    const service = createService();
    const mapped = service.mapLegacyCreateFieldToV2({
      id: 'fldCreate0000000001',
      type: 'rollup',
      options: {
        linkFieldId: 'fldLink000000000001',
        lookupFieldId: 'fldLookup000000001',
        foreignTableId: 'tblForeign00000001',
        expression: 'sum({values})',
      },
    });

    expect(mapped).toEqual({
      id: 'fldCreate0000000001',
      type: 'rollup',
      options: {
        expression: 'sum({values})',
      },
      config: {
        linkFieldId: 'fldLink000000000001',
        lookupFieldId: 'fldLookup000000001',
        foreignTableId: 'tblForeign00000001',
      },
    });
  });

  it('keeps link db config fields in create payload', () => {
    const service = createService();
    const mapped = service.mapLegacyCreateFieldToV2({
      type: 'link',
      options: {
        relationship: 'manyMany',
        foreignTableId: 'tblForeign00000001',
        lookupFieldId: 'fldLookup000000001',
        symmetricFieldId: 'fldSymmetric0000001',
        fkHostTableName: 'bseTestBaseId.junction_custom',
        selfKeyName: '__fk_fldSymmetric0000001',
        foreignKeyName: '__fk_fldCreate0000001',
      },
    });

    expect(mapped).toMatchObject({
      type: 'link',
      options: {
        relationship: 'manyMany',
        foreignTableId: 'tblForeign00000001',
        lookupFieldId: 'fldLookup000000001',
        symmetricFieldId: 'fldSymmetric0000001',
        fkHostTableName: 'bseTestBaseId.junction_custom',
        selfKeyName: '__fk_fldSymmetric0000001',
        foreignKeyName: '__fk_fldCreate0000001',
      },
    });
  });

  it('normalizes UTC to utc in create payload options', () => {
    const service = createService();
    const mapped = service.mapLegacyCreateFieldToV2({
      type: 'formula',
      options: {
        expression: 'NOW()',
        timeZone: 'UTC',
        formatting: {
          date: 'YYYY-MM-DD',
          time: 'HH:mm',
          timeZone: 'UTC',
        },
      },
    });

    expect(mapped).toMatchObject({
      type: 'formula',
      options: {
        expression: 'NOW()',
        timeZone: 'utc',
        formatting: {
          date: 'YYYY-MM-DD',
          time: 'HH:mm',
          timeZone: 'utc',
        },
      },
    });
  });

  it('fills link db config for manyOne when legacy payload misses it', async () => {
    const service = createService();
    const mapped = service.mapLegacyCreateFieldToV2({
      id: 'fldCreate0000000001',
      type: 'link',
      options: {
        relationship: 'manyOne',
        foreignTableId: 'tblForeign00000001',
        lookupFieldId: 'fldLookup000000001',
      },
    });

    const currentTable = {
      dbTableName: () => ({
        isErr: () => false,
        value: {
          value: () => ({ isErr: () => false, value: 'bseTestBaseId.tblCurrentTable0001' }),
        },
      }),
    };

    const completed = await service.completeLegacyLinkDbConfigForCreate(
      mapped,
      currentTable,
      {
        getById: async () => ({
          isErr: () => true,
          value: currentTable,
        }),
      },
      {}
    );

    expect(completed).toMatchObject({
      type: 'link',
      options: {
        relationship: 'manyOne',
        fkHostTableName: 'bseTestBaseId.tblCurrentTable0001',
        selfKeyName: '__id',
        foreignKeyName: '__fk_fldCreate0000000001',
      },
    });
  });

  it('fills link db config for two-way oneMany from foreign table db name', async () => {
    const service = createService();
    const mapped = service.mapLegacyCreateFieldToV2({
      id: 'fldCreate0000000002',
      type: 'link',
      options: {
        relationship: 'oneMany',
        isOneWay: false,
        foreignTableId: 'tblAbCdEfGhIjKlMn01',
        lookupFieldId: 'fldLookup000000002',
      },
    });

    const currentTable = {
      dbTableName: () => ({
        isErr: () => false,
        value: {
          value: () => ({ isErr: () => false, value: 'bseTestBaseId.tblCurrentTable0002' }),
        },
      }),
    };

    const completed = await service.completeLegacyLinkDbConfigForCreate(
      mapped,
      currentTable,
      {
        getById: async () => ({
          isErr: () => false,
          value: {
            dbTableName: () => ({
              isErr: () => false,
              value: {
                value: () => ({
                  isErr: () => false,
                  value: 'bseTestBaseId.tblForeignPhysical0002',
                }),
              },
            }),
          },
        }),
      },
      {}
    );

    expect(completed).toMatchObject({
      type: 'link',
      options: {
        relationship: 'oneMany',
        isOneWay: false,
        fkHostTableName: 'bseTestBaseId.tblForeignPhysical0002',
      },
    });
    expect((completed.options as { selfKeyName: string }).selfKeyName).toMatch(/^__fk_/);
    expect((completed.options as { foreignKeyName: string }).foreignKeyName).toBe('__id');
    expect((completed.options as { symmetricFieldId?: string }).symmetricFieldId).toMatch(/^fld/);
  });
});

describe('FieldOpenApiV2Service normalizeFieldVo', () => {
  const createNormalizeService = () =>
    new FieldOpenApiV2Service(
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      createFieldSupplementService() as never,
      {} as never
    ) as unknown as ITestFieldOpenApiV2Service;

  it('derives cellValueType, dbFieldType for singleLineText field', () => {
    const service = createNormalizeService();
    const vo = service.normalizeFieldVo({
      id: 'fldTest0000000001',
      name: 'Text Field',
      type: 'singleLineText',
      dbFieldName: 'text_field',
      options: {},
    });

    expect(vo.cellValueType).toBe(CellValueType.String);
    expect(vo.dbFieldType).toBe(DbFieldType.Text);
    expect(vo.dbFieldName).toBe('text_field');
  });

  it('derives cellValueType, dbFieldType for number field', () => {
    const service = createNormalizeService();
    const vo = service.normalizeFieldVo({
      id: 'fldTest0000000002',
      name: 'Number Field',
      type: 'number',
      dbFieldName: 'number_field',
      options: { formatting: { type: 'decimal', precision: 2 } },
    });

    expect(vo.cellValueType).toBe(CellValueType.Number);
    expect(vo.dbFieldType).toBe(DbFieldType.Real);
    expect(vo.dbFieldName).toBe('number_field');
  });

  it('derives cellValueType, dbFieldType for checkbox field', () => {
    const service = createNormalizeService();
    const vo = service.normalizeFieldVo({
      id: 'fldTest0000000003',
      name: 'Checkbox',
      type: 'checkbox',
      dbFieldName: 'checkbox_field',
      options: {},
    });

    expect(vo.cellValueType).toBe(CellValueType.Boolean);
    expect(vo.dbFieldType).toBe(DbFieldType.Boolean);
  });

  it('derives cellValueType, dbFieldType for date field', () => {
    const service = createNormalizeService();
    const vo = service.normalizeFieldVo({
      id: 'fldTest0000000004',
      name: 'Date',
      type: 'date',
      dbFieldName: 'date_field',
      options: {},
    });

    expect(vo.cellValueType).toBe(CellValueType.DateTime);
    expect(vo.dbFieldType).toBe(DbFieldType.DateTime);
  });

  it('derives isMultipleCellValue and JSON dbFieldType for multipleSelect', () => {
    const service = createNormalizeService();
    const vo = service.normalizeFieldVo({
      id: 'fldTest0000000005',
      name: 'Multi Select',
      type: 'multipleSelect',
      dbFieldName: 'multi_select',
      options: { choices: [] },
    });

    expect(vo.cellValueType).toBe(CellValueType.String);
    expect(vo.isMultipleCellValue).toBe(true);
    expect(vo.dbFieldType).toBe(DbFieldType.Json);
  });

  it('derives JSON dbFieldType for link field', () => {
    const service = createNormalizeService();
    const vo = service.normalizeFieldVo({
      id: 'fldTest0000000006',
      name: 'Link',
      type: 'link',
      dbFieldName: 'link_field',
      options: { foreignTableId: 'tblForeign00000001', relationship: 'manyMany' },
    });

    expect(vo.cellValueType).toBe(CellValueType.String);
    expect(vo.dbFieldType).toBe(DbFieldType.Json);
  });

  it('preserves cellValueType when already present (formula/rollup)', () => {
    const service = createNormalizeService();
    const vo = service.normalizeFieldVo({
      id: 'fldTest0000000007',
      name: 'Rollup',
      type: 'rollup',
      dbFieldName: 'rollup_field',
      cellValueType: 'number',
      isMultipleCellValue: false,
      options: { expression: 'sum({values})' },
      config: {
        linkFieldId: 'fldLink000000000001',
        lookupFieldId: 'fldLookup000000001',
        foreignTableId: 'tblForeign00000001',
      },
    });

    expect(vo.cellValueType).toBe(CellValueType.Number);
    expect(vo.dbFieldType).toBe(DbFieldType.Real);
  });

  it('applies legacy number formatting fallback for numeric rollup expressions', () => {
    const service = createNormalizeService();
    const vo = service.normalizeFieldVo({
      id: 'fldRollupNormalize0002',
      name: 'Rollup Numeric Fallback',
      type: 'rollup',
      dbFieldName: 'rollup_numeric_fallback',
      cellValueType: 'string',
      options: { expression: 'sum({values})' },
      config: {
        linkFieldId: 'fldLink000000000001',
        lookupFieldId: 'fldLookup000000001',
        foreignTableId: 'tblForeign00000001',
      },
    });

    expect((vo.options as Record<string, unknown>).formatting).toEqual(
      getDefaultFormatting(CellValueType.Number)
    );
  });

  it('does not override existing rollup formatting when expression is numeric', () => {
    const service = createNormalizeService();
    const vo = service.normalizeFieldVo({
      id: 'fldRollupNormalize0003',
      name: 'Rollup Keep Formatting',
      type: 'rollup',
      dbFieldName: 'rollup_keep_formatting',
      options: {
        expression: 'sum({values})',
        formatting: { type: 'decimal', precision: 5 },
      },
      config: {
        linkFieldId: 'fldLink000000000001',
        lookupFieldId: 'fldLookup000000001',
        foreignTableId: 'tblForeign00000001',
      },
    });

    expect((vo.options as Record<string, unknown>).formatting).toEqual({
      type: 'decimal',
      precision: 5,
    });
  });

  it('derives rating field as number type', () => {
    const service = createNormalizeService();
    const vo = service.normalizeFieldVo({
      id: 'fldTest0000000008',
      name: 'Rating',
      type: 'rating',
      dbFieldName: 'rating_field',
      options: { icon: 'star', color: 'yellowBright', max: 5 },
    });

    expect(vo.cellValueType).toBe(CellValueType.Number);
    expect(vo.dbFieldType).toBe(DbFieldType.Real);
  });

  it('derives autoNumber field as number/integer type', () => {
    const service = createNormalizeService();
    const vo = service.normalizeFieldVo({
      id: 'fldTest0000000009',
      name: 'AutoNumber',
      type: 'autoNumber',
      dbFieldName: 'auto_number',
      options: { expression: 'ROW()' },
    });

    expect(vo.cellValueType).toBe(CellValueType.Number);
    expect(vo.dbFieldType).toBe(DbFieldType.Integer);
  });

  it('strips symmetricFieldId from OneWay link fields', () => {
    const service = createNormalizeService();
    const vo = service.normalizeFieldVo({
      id: 'fldTest0000000011',
      name: 'OneWay Link',
      type: 'link',
      dbFieldName: 'oneway_link',
      options: {
        foreignTableId: 'tblForeign00000001',
        relationship: 'oneMany',
        isOneWay: true,
        symmetricFieldId: 'fldooa6hL67OXgi4cHj',
      },
    });

    expect(vo.type).toBe('link');
    expect((vo.options as Record<string, unknown>).isOneWay).toBe(true);
    expect((vo.options as Record<string, unknown>).symmetricFieldId).toBeUndefined();
    expect((vo.options as Record<string, unknown>).foreignTableId).toBe('tblForeign00000001');
  });

  it('preserves symmetricFieldId for TwoWay link fields', () => {
    const service = createNormalizeService();
    const vo = service.normalizeFieldVo({
      id: 'fldTest0000000012',
      name: 'TwoWay Link',
      type: 'link',
      dbFieldName: 'twoway_link',
      options: {
        foreignTableId: 'tblForeign00000001',
        relationship: 'manyMany',
        symmetricFieldId: 'fldSymmetric000001',
      },
    });

    expect(vo.type).toBe('link');
    expect((vo.options as Record<string, unknown>).symmetricFieldId).toBe('fldSymmetric000001');
  });

  it('keeps unique undefined when missing', () => {
    const service = createNormalizeService();
    const vo = service.normalizeFieldVo({
      id: 'fldTest0000000010',
      name: 'Text',
      type: 'singleLineText',
      options: {},
    });

    expect(vo.unique).toBeUndefined();
  });

  it('omits false isMultipleCellValue for v1 compatibility', () => {
    const service = createNormalizeService();
    const vo = service.normalizeFieldVo({
      id: 'fldButtonNormalize0001',
      name: 'Button',
      type: 'button',
      dbFieldName: 'button_field',
      isMultipleCellValue: false,
      options: {
        label: 'Run',
        color: 'red',
      },
    });

    expect(vo.isMultipleCellValue).toBeUndefined();
  });

  it('omits false isPrimary for v1 compatibility', () => {
    const service = createNormalizeService();
    const vo = service.normalizeFieldVo({
      id: 'fldPrimaryNormalize0001',
      name: 'Secondary Text',
      type: 'singleLineText',
      dbFieldName: 'secondary_text',
      isPrimary: false,
      options: {},
    });

    expect(vo.isPrimary).toBeUndefined();
  });

  it('strips undefined keys from options payload', () => {
    const service = createNormalizeService();
    const vo = service.normalizeFieldVo({
      id: 'fldButtonNormalize0002',
      name: 'Button',
      type: 'button',
      dbFieldName: 'button_field_2',
      options: {
        label: 'Run',
        workflow: undefined,
      },
    });

    expect(vo.options).toEqual({
      label: 'Run',
    });
  });

  it('omits false isMultipleCellValue for rollup field output compatibility', () => {
    const service = createNormalizeService();
    const vo = service.normalizeFieldVo({
      id: 'fldRollupNormalize0001',
      name: 'Rollup',
      type: 'rollup',
      dbFieldName: 'rollup_field',
      cellValueType: 'number',
      isMultipleCellValue: false,
      options: { expression: 'sum({values})' },
      config: {
        linkFieldId: 'fldLink000000000001',
        lookupFieldId: 'fldLookup000000001',
        foreignTableId: 'tblForeign00000001',
      },
    });

    expect(vo.isMultipleCellValue).toBeUndefined();
    expect(vo.cellValueType).toBe(CellValueType.Number);
  });

  it('flattens cross-base id onto conditionalRollup options (T7064)', () => {
    const service = createNormalizeService();
    const vo = service.normalizeFieldVo({
      id: 'fldCondRollup0000001',
      name: 'Cross Base Rollup',
      type: 'conditionalRollup',
      options: { expression: 'sum({values})' },
      config: {
        baseId: 'bseForeign000000001',
        foreignTableId: 'tblForeign00000001',
        lookupFieldId: 'fldLookup000000001',
        condition: {
          filter: {
            conjunction: 'and',
            filterSet: [{ fieldId: 'fldStatus000000001', operator: 'is', value: 'Active' }],
          },
        },
      },
    });

    expect(vo.options).toMatchObject({
      baseId: 'bseForeign000000001',
      foreignTableId: 'tblForeign00000001',
      lookupFieldId: 'fldLookup000000001',
      expression: 'sum({values})',
    });
  });

  it('flattens cross-base id onto conditional lookup options (T7064)', () => {
    const service = createNormalizeService();
    const vo = service.normalizeFieldVo({
      id: 'fldCondLookup0000001',
      name: 'Cross Base Lookup',
      type: 'conditionalLookup',
      innerType: 'number',
      options: {
        baseId: 'bseForeign000000001',
        foreignTableId: 'tblForeign00000001',
        lookupFieldId: 'fldLookup000000001',
        condition: {
          filter: {
            conjunction: 'and',
            filterSet: [{ fieldId: 'fldStatus000000001', operator: 'is', value: 'Active' }],
          },
        },
      },
    });

    expect(vo.isConditionalLookup).toBe(true);
    expect(vo.lookupOptions).toMatchObject({
      baseId: 'bseForeign000000001',
      foreignTableId: 'tblForeign00000001',
      lookupFieldId: 'fldLookup000000001',
    });
  });

  it('normalizes lookup options to empty object when source options are null', () => {
    const service = createNormalizeService();
    const vo = service.normalizeFieldVo({
      id: 'fldLookupNormalize0001',
      name: 'Lookup Field',
      type: 'singleLineText',
      isLookup: true,
      options: null,
      lookupOptions: {
        foreignTableId: 'tblForeign00000001',
        lookupFieldId: 'fldSource000000001',
        linkFieldId: 'fldLink0000000001',
      },
    });

    expect(vo.options).toEqual({});
  });

  it('reads a field through the v2 field list and preserves lookup link metadata', async () => {
    const fieldDtos = [
      {
        id: 'fldLink000000000001',
        name: 'Link',
        type: 'link',
        options: {
          relationship: 'manyMany',
          foreignTableId: 'tblForeign00000001',
          fkHostTableName: 'bseBase.tblJunction',
          selfKeyName: '__fk_self',
          foreignKeyName: '__fk_foreign',
        },
      },
      {
        id: 'fldLookup000000001',
        name: 'Lookup',
        type: 'singleLineText',
        isLookup: true,
        lookupOptions: {
          linkFieldId: 'fldLink000000000001',
          foreignTableId: 'tblForeign00000001',
          lookupFieldId: 'fldSource000000001',
        },
        options: null,
      },
    ];
    const queryBus = {
      execute: vi.fn().mockResolvedValue({
        isErr: () => false,
        value: {
          fields: fieldDtos.map((dto) => ({
            id: () => ({ toString: () => dto.id }),
            __testDto: dto,
          })),
          primaryFieldId: undefined,
          view: undefined,
        },
      }),
    };
    const container = { resolve: vi.fn(() => queryBus) };
    const service = new FieldOpenApiV2Service(
      { getContainerForTable: vi.fn().mockResolvedValue(container) } as never,
      { createContext: vi.fn().mockResolvedValue({}) } as never,
      {} as never,
      {} as never,
      createFieldSupplementService() as never,
      {} as never
    ) as unknown as ITestFieldOpenApiV2Service;
    const vo = await (
      service as unknown as {
        getFieldFromV2: (tableId: string, fieldId: string) => Promise<IFieldVo>;
      }
    ).getFieldFromV2('tbl3sYKYH4tDz0IEg91', 'fldLookup000000001');

    expect(vo.lookupOptions).toMatchObject({
      linkFieldId: 'fldLink000000000001',
      relationship: 'manyMany',
      foreignTableId: 'tblForeign00000001',
      fkHostTableName: 'bseBase.tblJunction',
      selfKeyName: '__fk_self',
      foreignKeyName: '__fk_foreign',
    });
  });

  it('preserves oneMany lookup-of-user multiplicity from the DTO', () => {
    const service = createNormalizeService();
    const vo = service.normalizeFieldVo({
      id: 'fldLookupUser000001',
      name: 'Owners',
      type: 'user',
      isLookup: true,
      isComputed: true,
      isMultipleCellValue: true,
      dbFieldType: 'JSON',
      options: { isMultiple: false, shouldNotify: false },
      lookupOptions: {
        foreignTableId: 'tblForeign00000001',
        linkFieldId: 'fldLink000000000001',
        lookupFieldId: 'fldOwner0000000001',
        relationship: 'oneMany',
      },
    });

    expect(vo.isMultipleCellValue).toBe(true);
    expect(vo.dbFieldType).toBe(DbFieldType.Json);
  });
});

describe('FieldOpenApiV2Service createField', () => {
  it('reuses the created domain table instead of remapping the full table dto', async () => {
    const commandBus = {
      execute: vi.fn().mockResolvedValue({
        isErr: () => false,
        value: {
          table: { kind: 'domainTable' },
        },
      }),
    };
    const tableQueryService = {
      getById: vi.fn().mockResolvedValue({
        isErr: () => false,
        value: {
          baseId: () => ({
            toString: () => 'bseTestBaseId',
          }),
        },
      }),
    };
    const service = new FieldOpenApiV2Service(
      createV2ContainerService(commandBus, tableQueryService) as never,
      { createContext: async () => ({ requestId: 'reqTestId' }) } as never,
      { field: { invalidateTables: vi.fn() } } as never,
      {} as never,
      createFieldSupplementService() as never,
      {} as never
    ) as unknown as ITestFieldOpenApiV2Service;

    vi.spyOn(service as object, 'hasDuplicatedDbFieldName' as never).mockReturnValue(false);
    vi.spyOn(service as object, 'completeLegacyLinkDbConfigForCreate' as never).mockImplementation(
      async (field) => field as Record<string, unknown>
    );

    const extractFieldVoFromDomainTable = vi
      .spyOn(service as object, 'extractFieldVoFromDomainTable' as never)
      .mockResolvedValue({
        id: 'fldCreated000000001',
        name: 'Created Field',
        type: 'singleLineText',
      } as IFieldVo);
    const createdField = await service.createField('tbl3sYKYH4tDz0IEg91', {
      type: 'singleLineText',
      name: 'Created Field',
    });

    expect(createdField).toMatchObject({
      id: 'fldCreated000000001',
      name: 'Created Field',
      type: 'singleLineText',
    });
    expect(commandBus.execute).toHaveBeenCalledTimes(1);
    expect(extractFieldVoFromDomainTable).toHaveBeenCalledWith(
      { kind: 'domainTable' },
      expect.stringMatching(/^fld/),
      { requestId: 'reqTestId' }
    );
  });

  it('falls back to v2 field read for lookup fields to preserve legacy response shape', async () => {
    const commandBus = {
      execute: vi.fn().mockResolvedValue({
        isErr: () => false,
        value: {
          table: { kind: 'domainTable' },
        },
      }),
    };
    const tableQueryService = {
      getById: vi.fn().mockResolvedValue({
        isErr: () => false,
        value: {
          baseId: () => ({
            toString: () => 'bseTestBaseId',
          }),
        },
      }),
    };
    const service = new FieldOpenApiV2Service(
      createV2ContainerService(commandBus, tableQueryService) as never,
      { createContext: async () => ({ requestId: 'reqTestId' }) } as never,
      { field: { invalidateTables: vi.fn() } } as never,
      {} as never,
      createFieldSupplementService() as never,
      {} as never
    ) as unknown as ITestFieldOpenApiV2Service;

    vi.spyOn(service as object, 'hasDuplicatedDbFieldName' as never).mockReturnValue(false);
    vi.spyOn(service as object, 'completeLegacyLinkDbConfigForCreate' as never).mockImplementation(
      async () =>
        ({
          id: 'fldLookup000000001',
          type: 'lookup',
          options: {
            foreignTableId: 'tblForeign00000001',
            lookupFieldId: 'fldSource000000001',
            linkFieldId: 'fldLink000000000001',
          },
        }) as Record<string, unknown>
    );

    vi.spyOn(service as object, 'extractFieldVoFromDomainTable' as never).mockResolvedValue({
      id: 'fldLookup000000001',
      name: 'Lookup Field',
      type: 'singleLineText',
    } as IFieldVo);
    const getFieldFromV2 = vi
      .spyOn(service as object, 'getFieldFromV2' as never)
      .mockResolvedValue({
        id: 'fldLookup000000001',
        name: 'Lookup Field',
        type: 'singleLineText',
        isLookup: true,
        dbFieldType: DbFieldType.Json,
        isMultipleCellValue: true,
      } as IFieldVo);

    const createdField = await service.createField('tbl3sYKYH4tDz0IEg91', {
      type: 'singleLineText',
      isLookup: true,
      lookupOptions: {
        foreignTableId: 'tblForeign00000001',
        lookupFieldId: 'fldSource000000001',
        linkFieldId: 'fldLink000000000001',
      },
    });

    expect(getFieldFromV2).toHaveBeenCalledWith('tbl3sYKYH4tDz0IEg91', 'fldLookup000000001', {
      requestId: 'reqTestId',
    });
    expect(createdField).toMatchObject({
      id: 'fldLookup000000001',
      isLookup: true,
      dbFieldType: DbFieldType.Json,
      isMultipleCellValue: true,
    });
  });
});

describe('FieldOpenApiV2Service createFields', () => {
  it('reuses the created domain table for non-lookup fields and falls back to v2 reads for lookup fields', async () => {
    const commandBus = {
      execute: vi.fn().mockResolvedValue({
        isErr: () => false,
        value: {
          table: { kind: 'domainTable' },
        },
      }),
    };
    const tableQueryService = {
      getById: vi.fn().mockResolvedValue({
        isErr: () => false,
        value: {
          baseId: () => ({
            toString: () => 'bseTestBaseId',
          }),
        },
      }),
    };
    const service = new FieldOpenApiV2Service(
      createV2ContainerService(commandBus, tableQueryService) as never,
      { createContext: async () => ({ requestId: 'reqTestId' }) } as never,
      { field: { invalidateTables: vi.fn() } } as never,
      {} as never,
      createFieldSupplementService() as never,
      {} as never
    ) as unknown as ITestFieldOpenApiV2Service;

    vi.spyOn(service as object, 'hasDuplicatedDbFieldName' as never).mockReturnValue(false);
    vi.spyOn(service as object, 'completeLegacyLinkDbConfigForCreate' as never).mockImplementation(
      async (field) => field as Record<string, unknown>
    );

    vi.spyOn(service as object, 'extractFieldVoFromDomainTable' as never)
      .mockResolvedValueOnce({
        id: 'fldText000000000001',
        name: 'Text Field',
        type: 'singleLineText',
      } as IFieldVo)
      .mockResolvedValueOnce({
        id: 'fldLookup000000001',
        name: 'Lookup Field',
        type: 'singleLineText',
      } as IFieldVo);
    const getFieldFromV2 = vi
      .spyOn(service as object, 'getFieldFromV2' as never)
      .mockResolvedValue({
        id: 'fldLookup000000001',
        name: 'Lookup Field',
        type: 'singleLineText',
        isLookup: true,
        dbFieldType: DbFieldType.Json,
        isMultipleCellValue: true,
      } as IFieldVo);

    const createdFields = await service.createFields('tbl3sYKYH4tDz0IEg91', [
      {
        id: 'fldText000000000001',
        type: 'singleLineText',
        name: 'Text Field',
      },
      {
        id: 'fldLookup000000001',
        type: 'number',
        isLookup: true,
        lookupOptions: {
          foreignTableId: 'tblForeign00000001',
          lookupFieldId: 'fldSource000000001',
          linkFieldId: 'fldLink000000000001',
        },
      },
    ]);

    expect(createdFields).toEqual([
      {
        id: 'fldText000000000001',
        name: 'Text Field',
        type: 'singleLineText',
      },
      {
        id: 'fldLookup000000001',
        name: 'Lookup Field',
        type: 'singleLineText',
        isLookup: true,
        dbFieldType: DbFieldType.Json,
        isMultipleCellValue: true,
      },
    ]);
    expect(commandBus.execute).toHaveBeenCalledTimes(1);
    expect(getFieldFromV2).toHaveBeenCalledWith('tbl3sYKYH4tDz0IEg91', 'fldLookup000000001', {
      requestId: 'reqTestId',
    });
  });
});

describe('FieldOpenApiV2Service hasDuplicatedDbFieldName', () => {
  it('returns true when dbFieldName already exists in table', () => {
    const service = createService();
    const table = {
      getFields: () => [
        {
          dbFieldName: () => ({
            andThen: (
              fn: (name: { value: () => { isOk: () => boolean; value: string } }) => unknown
            ) => fn({ value: () => ({ isOk: () => true, value: 'fld_existing_db_name' }) }),
          }),
        },
      ],
    };

    expect(service.hasDuplicatedDbFieldName(table, 'fld_existing_db_name')).toBe(true);
  });

  it('returns false when dbFieldName does not exist in table', () => {
    const service = createService();
    const table = {
      getFields: () => [
        {
          dbFieldName: () => ({
            andThen: (
              fn: (name: { value: () => { isOk: () => boolean; value: string } }) => unknown
            ) => fn({ value: () => ({ isOk: () => true, value: 'fld_other_db_name' }) }),
          }),
        },
      ],
    };

    expect(service.hasDuplicatedDbFieldName(table, 'fld_missing_db_name')).toBe(false);
  });
});

describe('overlayStoredPendingState (T6581)', () => {
  type IOverlayTestService = {
    overlayStoredPendingState: (vos: Array<Record<string, unknown>>) => Promise<void>;
  };

  const createServiceWithFieldRows = (rows: Array<{ id: string; isPending: boolean | null }>) => {
    const findMany = vi.fn(async () => rows);
    const prismaService = { txClient: () => ({ field: { findMany } }) };
    const service = new FieldOpenApiV2Service(
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      prismaService as never
    ) as unknown as IOverlayTestService;
    return { service, findMany };
  };

  it('replaces the forced pending default with the stored state', async () => {
    const { service, findMany } = createServiceWithFieldRows([
      { id: 'fldFormula00000000', isPending: null },
      { id: 'fldRollup000000000', isPending: true },
    ]);
    const formulaVo = { id: 'fldFormula00000000', isComputed: true, isPending: true };
    const rollupVo = { id: 'fldRollup000000000', isComputed: true, isPending: true };
    const textVo = { id: 'fldText0000000000', type: 'singleLineText' };

    await service.overlayStoredPendingState([formulaVo, rollupVo, textVo]);

    expect(findMany).toHaveBeenCalledWith({
      where: { id: { in: ['fldFormula00000000', 'fldRollup000000000'] } },
      select: { id: true, isPending: true },
    });
    expect(formulaVo).not.toHaveProperty('isPending');
    expect(rollupVo.isPending).toBe(true);
    expect(textVo).not.toHaveProperty('isPending');
  });

  it('skips the query when no computed fields are present', async () => {
    const { service, findMany } = createServiceWithFieldRows([]);
    const textVo = { id: 'fldText0000000000', type: 'singleLineText' };

    await service.overlayStoredPendingState([textVo]);

    expect(findMany).not.toHaveBeenCalled();
  });

  it('clears pending for computed fields missing a stored row', async () => {
    const { service } = createServiceWithFieldRows([]);
    const formulaVo = { id: 'fldFormula00000000', isComputed: true, isPending: true };

    await service.overlayStoredPendingState([formulaVo]);

    expect(formulaVo).not.toHaveProperty('isPending');
  });
});

describe('T7141 lookup unique legacy boundary', () => {
  const references = {
    foreignTableId: 'tblForeign00000001',
    lookupFieldId: 'fldLookup000000001',
  };
  const filter = {
    conjunction: 'and',
    filterSet: [{ fieldId: 'fldStatus000000001', operator: 'is', value: 'Active' }],
  };

  it.each([true, false])(
    'preserves regular lookup isUnique=%s on create and convert',
    (isUnique) => {
      const service = createService();
      const ro = {
        type: 'user',
        isLookup: true,
        lookupOptions: { ...references, linkFieldId: 'fldLink000000000001', isUnique },
      };
      expect(service.mapLegacyCreateFieldToV2(ro)).toMatchObject({
        type: 'lookup',
        options: { ...ro.lookupOptions },
      });
      expect(
        service.mapConvertFieldToV2(ro, {
          ...ro,
          lookupOptions: { ...ro.lookupOptions, isUnique: !isUnique },
        })
      ).toMatchObject({ type: 'lookup', options: { ...ro.lookupOptions } });
    }
  );

  it.each([true, false])(
    'preserves conditional lookup isUnique=%s on create and convert',
    (isUnique) => {
      const service = createService();
      const ro = {
        type: 'user',
        isLookup: true,
        isConditionalLookup: true,
        lookupOptions: { ...references, filter, isUnique },
      };
      const expected = {
        type: 'conditionalLookup',
        options: { ...references, isUnique, condition: { filter } },
      };
      expect(service.mapLegacyCreateFieldToV2(ro)).toMatchObject(expected);
      expect(
        service.mapConvertFieldToV2(ro, {
          ...ro,
          lookupOptions: { ...ro.lookupOptions, isUnique: !isUnique },
        })
      ).toMatchObject(expected);
    }
  );

  it.each([true, false])(
    'preserves regular and both conditional DTO shapes on read: %s',
    (isUnique) => {
      const service = new FieldOpenApiV2Service(
        {} as never,
        {} as never,
        {} as never,
        {} as never,
        createFieldSupplementService() as never,
        {} as never
      ) as unknown as ITestFieldOpenApiV2Service;
      const common = {
        id: 'fldLookup000000001',
        name: 'Lookup',
        isLookup: true,
        isMultipleCellValue: true,
      };
      const regular = service.normalizeFieldVo({
        ...common,
        type: 'user',
        options: { isMultiple: true },
        lookupOptions: { ...references, linkFieldId: 'fldLink000000000001', isUnique },
      });
      expect(regular.lookupOptions).toMatchObject({ ...references, isUnique });
      for (const dto of [
        {
          ...common,
          type: 'conditionalLookup',
          innerType: 'user',
          innerOptions: { isMultiple: true },
          options: { ...references, isUnique, condition: { filter } },
        },
        {
          ...common,
          type: 'user',
          options: { isMultiple: true },
          conditionalLookupOptions: { ...references, isUnique, condition: { filter } },
        },
      ]) {
        const conditional = service.normalizeFieldVo(dto);
        expect(conditional.isConditionalLookup).toBe(true);
        expect(conditional.lookupOptions).toMatchObject({ ...references, isUnique, filter });
      }
    }
  );
});
