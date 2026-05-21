import type { ConfigService } from '@nestjs/config';
import { HttpErrorCode, type IFilter } from '@teable/core';
import type { PrismaService } from '@teable/db-main-prisma';
import { beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('@teable/db-main-prisma', () => ({ PrismaService: class PrismaService {} }));

let ViewDataSafetyLimitService: typeof import('./view-data-safety-limit.service').ViewDataSafetyLimitService;

const filterItem = {
  fieldId: 'fldTest',
  operator: 'is',
  value: 'x',
  isSymbol: false,
};

const createService = (
  env: Record<string, unknown>,
  options: { currentViewCount?: number } = {}
) => {
  const count = vi.fn().mockResolvedValue(options.currentViewCount ?? 0);
  const configService = {
    get: vi.fn((key: string) => env[key]),
  } as unknown as ConfigService;
  const prismaService = {
    txClient: () => ({
      view: { count },
    }),
  } as unknown as PrismaService;

  return {
    service: new ViewDataSafetyLimitService(configService, prismaService),
    count,
  };
};

const expectLimitError = (error: unknown, domainCode: string) => {
  expect(error).toMatchObject({
    code: HttpErrorCode.VALIDATION_ERROR,
    data: {
      domainCode,
    },
  });
};

describe('ViewDataSafetyLimitService', () => {
  beforeAll(async () => {
    ({ ViewDataSafetyLimitService } = await import('./view-data-safety-limit.service'));
  }, 30_000);

  it('rejects creating a view when the table has reached the views-per-table limit', async () => {
    const { service, count } = createService(
      { TABLE_LIMIT_VIEWS_PER_TABLE_MAX: '2' },
      { currentViewCount: 2 }
    );

    await expect(service.ensureCanCreateView('tblTest')).rejects.toSatisfy((error: unknown) => {
      expectLimitError(error, 'validation.limit.views_per_table_max');
      return true;
    });
    expect(count).toHaveBeenCalledWith({ where: { tableId: 'tblTest', deletedTime: null } });
  });

  it('allows creating a view at the views-per-table boundary', async () => {
    const { service } = createService(
      { TABLE_LIMIT_VIEWS_PER_TABLE_MAX: '2' },
      { currentViewCount: 1 }
    );

    await expect(service.ensureCanCreateView('tblTest')).resolves.toBeUndefined();
  });

  it.each([
    [
      'validation.limit.name_max_length',
      { TABLE_LIMIT_NAME_MAX_LENGTH: '3' },
      () => ({ name: 'Long' }),
    ],
    [
      'validation.limit.description_max_length',
      { TABLE_LIMIT_DESCRIPTION_MAX_LENGTH: '3' },
      () => ({ description: 'Long' }),
    ],
    [
      'validation.limit.view_filter_items_max',
      { TABLE_LIMIT_VIEW_FILTER_ITEMS_MAX: '1' },
      () => ({
        filter: {
          conjunction: 'and',
          filterSet: [filterItem, filterItem],
        } as unknown as IFilter,
      }),
    ],
    [
      'validation.limit.view_filter_depth_max',
      { TABLE_LIMIT_VIEW_FILTER_DEPTH_MAX: '1' },
      () => ({
        filter: {
          conjunction: 'and',
          filterSet: [{ conjunction: 'and', filterSet: [filterItem] }],
        } as unknown as IFilter,
      }),
    ],
    [
      'validation.limit.view_sort_items_max',
      { TABLE_LIMIT_VIEW_SORT_ITEMS_MAX: '1' },
      () => ({
        sort: {
          sortObjs: [
            { fieldId: 'fldA', order: 'asc' },
            { fieldId: 'fldB', order: 'desc' },
          ],
        },
      }),
    ],
    [
      'validation.limit.view_group_items_max',
      { TABLE_LIMIT_VIEW_GROUP_ITEMS_MAX: '1' },
      () => ({
        group: [
          { fieldId: 'fldA', order: 'asc' },
          { fieldId: 'fldB', order: 'desc' },
        ],
      }),
    ],
    [
      'validation.limit.view_options_max_bytes',
      { TABLE_LIMIT_VIEW_OPTIONS_MAX_BYTES: '4' },
      () => ({ options: { rowHeight: 1 } }),
    ],
  ])('rejects %s for view payloads', (expectedCode, env, payloadFactory) => {
    const { service } = createService(env);

    try {
      service.ensureViewPayload(payloadFactory());
      throw new Error('Expected limit error');
    } catch (error) {
      expectLimitError(error, expectedCode);
    }
  });

  it('validates serialized view property updates', () => {
    const { service } = createService({ TABLE_LIMIT_VIEW_SORT_ITEMS_MAX: '1' });

    try {
      service.ensureSerializedProperties({
        sort: JSON.stringify({
          sortObjs: [
            { fieldId: 'fldA', order: 'asc' },
            { fieldId: 'fldB', order: 'desc' },
          ],
        }),
      });
      throw new Error('Expected limit error');
    } catch (error) {
      expectLimitError(error, 'validation.limit.view_sort_items_max');
    }
  });
});
