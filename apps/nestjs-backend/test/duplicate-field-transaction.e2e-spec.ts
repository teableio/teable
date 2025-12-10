import type { INestApplication } from '@nestjs/common';
import { FieldType, Relationship } from '@teable/core';
import { PrismaService } from '@teable/db-main-prisma';
import { ClsService } from 'nestjs-cls';
import type { MockInstance } from 'vitest';
import { vi } from 'vitest';
import { DB_PROVIDER_SYMBOL } from '../src/db-provider/db.provider';
import type { IDbProvider } from '../src/db-provider/db.provider.interface';
import { FieldOpenApiService } from '../src/features/field/open-api/field-open-api.service';
import type { IClsStore } from '../src/types/cls';
import { getError } from './utils/get-error';
import {
  createBase,
  createTable,
  initApp,
  permanentDeleteBase,
  runWithTestUser,
} from './utils/init-app';

describe('Field duplicate transaction (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const appCtx = await initApp();
    app = appCtx.app;
  });

  afterAll(async () => {
    await app.close();
  });

  it('rolls back duplicateField when post-create steps fail', async () => {
    const prismaService = app.get(PrismaService);
    const fieldOpenApiService = app.get(FieldOpenApiService);
    const clsService = app.get<ClsService<IClsStore>>(ClsService);
    const dbProvider = app.get<IDbProvider>(DB_PROVIDER_SYMBOL);

    const base = await createBase({
      spaceId: globalThis.testConfig.spaceId,
      name: 'duplicate-field-tx',
    });

    let duplicateSpy: MockInstance | undefined;
    try {
      const foreignTable = await createTable(base.id, {
        name: 'foreign',
      });
      const hostTable = await createTable(base.id, {
        name: 'host',
        fields: [
          {
            name: 'Title',
            type: FieldType.SingleLineText,
          },
        ],
      });

      const foreignNameField = await runWithTestUser(clsService, () =>
        fieldOpenApiService.createField(foreignTable.id, {
          name: 'Name',
          type: FieldType.SingleLineText,
        })
      );

      const linkField = await runWithTestUser(clsService, () =>
        fieldOpenApiService.createField(hostTable.id, {
          name: 'Link',
          type: FieldType.Link,
          options: {
            baseId: base.id,
            foreignTableId: foreignTable.id,
            relationship: Relationship.ManyMany,
          },
        })
      );

      const lookupField = await runWithTestUser(clsService, () =>
        fieldOpenApiService.createField(hostTable.id, {
          name: 'Lookup name',
          type: FieldType.SingleLineText,
          isLookup: true,
          lookupOptions: {
            foreignTableId: foreignTable.id,
            linkFieldId: linkField.id,
            lookupFieldId: foreignNameField.id,
          },
        })
      );

      await runWithTestUser(clsService, () =>
        fieldOpenApiService.createField(hostTable.id, {
          name: 'Lookup length',
          type: FieldType.Formula,
          options: {
            expression: `LEN({${lookupField.id}})`,
          },
        })
      );

      const tableMeta = await prismaService.tableMeta.findUniqueOrThrow({
        where: { id: hostTable.id },
        select: { dbTableName: true },
      });

      const getColumns = async () =>
        (
          await prismaService.$queryRawUnsafe<{ name: string }[]>(
            dbProvider.columnInfo(tableMeta.dbTableName)
          )
        )
          .map(({ name }) => name)
          .sort();

      const columnsBefore = await getColumns();
      const fieldCountBefore = await prismaService.field.count({
        where: { tableId: hostTable.id, deletedTime: null },
      });

      duplicateSpy = vi
        .spyOn(fieldOpenApiService, 'duplicateFieldData')
        .mockImplementationOnce(async () => {
          throw new Error('force-duplicate-failure');
        });

      const error = await getError(() =>
        runWithTestUser(clsService, () =>
          fieldOpenApiService.duplicateField(hostTable.id, linkField.id, {
            name: 'Link Copy',
          })
        )
      );

      expect(error?.message).toBe('force-duplicate-failure');

      const fieldCountAfter = await prismaService.field.count({
        where: { tableId: hostTable.id, deletedTime: null },
      });
      expect(fieldCountAfter).toBe(fieldCountBefore);

      const columnsAfter = await getColumns();
      expect(columnsAfter).toEqual(columnsBefore);

      const copiedField = await prismaService.field.findFirst({
        where: { tableId: hostTable.id, name: 'Link Copy', deletedTime: null },
      });
      expect(copiedField).toBeNull();
    } finally {
      duplicateSpy?.mockRestore();
      await permanentDeleteBase(base.id);
    }
  });
});
