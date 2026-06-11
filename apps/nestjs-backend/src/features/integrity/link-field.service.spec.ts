import { FieldType, Relationship } from '@teable/core';
import { describe, expect, it, vi } from 'vitest';
import { LinkFieldIntegrityService } from './link-field.service';

const ordersTable = 'bseTest.orders';
const customerField = 'customer';
const junctionTable = 'bseTest.junction_fldLink';

describe('LinkFieldIntegrityService', () => {
  it('checks link data through the data database', async () => {
    const metaQueryRawUnsafe = vi.fn();
    const dataQueryRawUnsafe = vi.fn().mockResolvedValue([{ id: 'recA' }]);
    const prismaService = {
      tableMeta: {
        findFirstOrThrow: vi.fn().mockResolvedValue({
          name: 'Orders',
          dbTableName: ordersTable,
        }),
      },
      $queryRawUnsafe: metaQueryRawUnsafe,
    };
    const dataPrismaService = {
      $queryRawUnsafe: dataQueryRawUnsafe,
    };
    const checkLinks = vi.fn().mockReturnValue('select inconsistent links');
    const dbProvider = {
      checkColumnExist: vi.fn().mockResolvedValue(true),
      integrityQuery: vi.fn().mockReturnValue({
        checkLinks,
      }),
    };
    const service = new LinkFieldIntegrityService(
      prismaService as never,
      dataPrismaService as never,
      dbProvider as never
    );

    const issues = await service.getIssues('tblOrders', {
      id: 'fldLink',
      name: 'Customer',
      type: FieldType.Link,
      dbFieldName: customerField,
      isMultipleCellValue: true,
      options: {
        relationship: Relationship.ManyMany,
        fkHostTableName: junctionTable,
        selfKeyName: '__fk_self',
        foreignKeyName: '__fk_foreign',
        foreignTableId: 'tblCustomers',
      },
    } as never);

    expect(dbProvider.checkColumnExist).toHaveBeenCalledWith(
      ordersTable,
      customerField,
      dataPrismaService
    );
    expect(dataQueryRawUnsafe).toHaveBeenCalledWith('select inconsistent links');
    expect(metaQueryRawUnsafe).not.toHaveBeenCalled();
    expect(issues).toHaveLength(1);
  });

  it('fixes link data through the data database', async () => {
    const dataExecuteRawUnsafe = vi.fn().mockResolvedValue(1);
    const dataPrismaService = {
      $executeRawUnsafe: dataExecuteRawUnsafe,
    };
    const fixLinks = vi.fn().mockReturnValue('update inconsistent links');
    const dbProvider = {
      checkColumnExist: vi.fn().mockResolvedValue(true),
      integrityQuery: vi.fn().mockReturnValue({
        fixLinks,
      }),
    };
    const service = new LinkFieldIntegrityService(
      {} as never,
      dataPrismaService as never,
      dbProvider as never
    );

    const result = await (
      service as unknown as {
        fixLinks: (params: {
          recordIds: string[];
          dbTableName: string;
          foreignDbTableName: string;
          fkHostTableName: string;
          lookupDbFieldName: string;
          selfKeyName: string;
          foreignKeyName: string;
          linkDbFieldName: string;
          isMultiValue: boolean;
        }) => Promise<number>;
      }
    ).fixLinks({
      recordIds: ['recA'],
      dbTableName: ordersTable,
      foreignDbTableName: 'bseTest.customers',
      fkHostTableName: junctionTable,
      lookupDbFieldName: 'name',
      selfKeyName: '__fk_self',
      foreignKeyName: '__fk_foreign',
      linkDbFieldName: customerField,
      isMultiValue: true,
    });

    expect(dbProvider.checkColumnExist).toHaveBeenCalledWith(
      ordersTable,
      customerField,
      dataPrismaService
    );
    expect(dataExecuteRawUnsafe).toHaveBeenCalledWith('update inconsistent links');
    expect(result).toBe(1);
  });
});
