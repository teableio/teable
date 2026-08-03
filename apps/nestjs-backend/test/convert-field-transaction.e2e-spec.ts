/* eslint-disable sonarjs/cognitive-complexity */
import type { INestApplication } from '@nestjs/common';
import { FieldType, Relationship } from '@teable/core';
import { PrismaService } from '@teable/db-main-prisma';
import { ClsService } from 'nestjs-cls';
import type { MockInstance } from 'vitest';
import { vi } from 'vitest';
import { DB_PROVIDER_SYMBOL } from '../src/db-provider/db.provider';
import type { IDbProvider } from '../src/db-provider/db.provider.interface';
import { FieldConvertingService } from '../src/features/field/field-calculate/field-converting.service';
import { FieldService } from '../src/features/field/field.service';
import { FieldOpenApiService } from '../src/features/field/open-api/field-open-api.service';
import type { IClsStore } from '../src/types/cls';
import { getError } from './utils/get-error';
import {
  createBase,
  createTable,
  createField,
  initApp,
  permanentDeleteBase,
  runWithTestUser,
} from './utils/init-app';

describe('Field convert transaction (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const appCtx = await initApp();
    app = appCtx.app;
  });

  afterAll(async () => {
    await app.close();
  });

  it('rolls back convert when calculation fails mid-transaction', async () => {
    const clsService = app.get<ClsService<IClsStore>>(ClsService);
    const fieldOpenApiService = app.get(FieldOpenApiService);
    const fieldConvertingService = app.get(FieldConvertingService);
    const prismaService = app.get(PrismaService);

    const base = await createBase({
      spaceId: globalThis.testConfig.spaceId,
      name: 'convert-field-tx',
    });

    let stageCalculateSpy: MockInstance | undefined;
    try {
      const table = await createTable(base.id, {
        name: 'ConvertTxTable',
        fields: [
          {
            name: 'Text',
            type: FieldType.SingleLineText,
          },
        ],
      });
      const fieldId = table.fields?.[0].id as string;

      stageCalculateSpy = vi
        .spyOn(fieldConvertingService, 'stageCalculate')
        .mockImplementationOnce(async () => {
          throw new Error('force-convert-failure');
        });

      const error = await getError(() =>
        runWithTestUser(clsService, () =>
          fieldOpenApiService.convertField(table.id, fieldId, {
            name: 'NumberAfterFail',
            type: FieldType.Number,
          })
        )
      );
      expect(error).toBeTruthy();

      const fieldAfter = await prismaService.field.findUniqueOrThrow({
        where: { id: fieldId },
        select: { type: true, name: true },
      });
      expect(fieldAfter.type).toBe(FieldType.SingleLineText);
      expect(fieldAfter.name).toBe('Text');
    } finally {
      stageCalculateSpy?.mockRestore();
      await permanentDeleteBase(base.id);
    }
  });

  it('keeps junction table/field when link convert fails and rolls back', async () => {
    const clsService = app.get<ClsService<IClsStore>>(ClsService);
    const fieldOpenApiService = app.get(FieldOpenApiService);
    const fieldConvertingService = app.get(FieldConvertingService);
    const prismaService = app.get(PrismaService);
    const dbProvider = app.get<IDbProvider>(DB_PROVIDER_SYMBOL);

    const base = await createBase({
      spaceId: globalThis.testConfig.spaceId,
      name: 'convert-link-tx',
    });

    let stageAlterSpy: MockInstance | undefined;
    try {
      const tableA = await createTable(base.id, {
        name: 'Host',
        fields: [
          {
            name: 'Name',
            type: FieldType.SingleLineText,
          },
        ],
      });
      const tableB = await createTable(base.id, {
        name: 'Foreign',
        fields: [
          {
            name: 'Name',
            type: FieldType.SingleLineText,
          },
        ],
      });

      const linkField = await createField(tableA.id, {
        name: 'LinkToForeign',
        type: FieldType.Link,
        options: {
          baseId: base.id,
          relationship: Relationship.ManyMany,
          foreignTableId: tableB.id,
        },
      });

      const linkRaw = await prismaService.field.findUniqueOrThrow({
        where: { id: linkField.id },
        select: { options: true },
      });
      const parsedOptions: Record<string, unknown> =
        (typeof linkRaw.options === 'string'
          ? (JSON.parse(linkRaw.options) as Record<string, unknown> | null)
          : (linkRaw.options as Record<string, unknown> | null)) ?? {};
      const fkHostTableName = parsedOptions.fkHostTableName as string | undefined;
      const symmetricFieldId = parsedOptions.symmetricFieldId as string | undefined;
      const relationship = parsedOptions.relationship as Relationship | undefined;
      const foreignKeyName = parsedOptions.foreignKeyName as string | undefined;
      const selfKeyName = parsedOptions.selfKeyName as string | undefined;
      const isOneWay = parsedOptions.isOneWay === true;
      expect(fkHostTableName).toBeTruthy();

      const isJunction =
        relationship === Relationship.ManyMany ||
        (relationship === Relationship.OneMany && isOneWay);
      const columnToCheck =
        relationship === Relationship.ManyOne
          ? foreignKeyName
          : relationship === Relationship.OneMany && !isOneWay
            ? selfKeyName
            : relationship === Relationship.OneOne
              ? foreignKeyName === '__id'
                ? selfKeyName
                : foreignKeyName
              : undefined;

      const checkTableExists = async (tableName: string) =>
        (
          await prismaService.$queryRawUnsafe<{ exists: boolean }[]>(
            dbProvider.checkTableExist(tableName)
          )
        )[0]?.exists ?? false;
      const checkColumnExists = async (tableName: string, columnName: string) =>
        dbProvider.checkColumnExist(tableName, columnName, prismaService.txClient());

      const beforeExists = isJunction
        ? await checkTableExists(fkHostTableName!)
        : columnToCheck
          ? await checkColumnExists(fkHostTableName!, columnToCheck)
          : false;
      expect(beforeExists).toBe(true);

      stageAlterSpy = vi
        .spyOn(fieldConvertingService, 'stageAlter')
        .mockImplementationOnce(async () => {
          throw new Error('force-link-convert-failure');
        });

      const error = await getError(() =>
        runWithTestUser(clsService, () =>
          fieldOpenApiService.convertField(tableA.id, linkField.id, {
            name: 'AfterFail',
            type: FieldType.SingleLineText,
          })
        )
      );
      expect(error).toBeTruthy();

      const afterField = await prismaService.field.findUniqueOrThrow({
        where: { id: linkField.id },
        select: { type: true, name: true, options: true },
      });
      expect(afterField.type).toBe(FieldType.Link);
      expect(afterField.name).toBe('LinkToForeign');

      if (symmetricFieldId) {
        const symmetricField = await prismaService.field.findUnique({
          where: { id: symmetricFieldId },
          select: { id: true },
        });
        expect(symmetricField?.id).toBe(symmetricFieldId);
      }

      const afterExists =
        isJunction && fkHostTableName
          ? await checkTableExists(fkHostTableName)
          : columnToCheck && fkHostTableName
            ? await checkColumnExists(fkHostTableName, columnToCheck)
            : false;
      expect(afterExists).toBe(true);
    } finally {
      stageAlterSpy?.mockRestore();
      await permanentDeleteBase(base.id);
    }
  });

  it('keeps column when delete field rolls back inside a single transaction', async () => {
    const clsService = app.get<ClsService<IClsStore>>(ClsService);
    const fieldOpenApiService = app.get(FieldOpenApiService);
    const prismaService = app.get(PrismaService);
    const dbProvider = app.get<IDbProvider>(DB_PROVIDER_SYMBOL);
    const fieldService = app.get(FieldService);

    const base = await createBase({
      spaceId: globalThis.testConfig.spaceId,
      name: 'delete-field-tx',
    });

    let alterSpy: MockInstance | undefined;
    try {
      const table = await createTable(base.id, {
        name: 'DeleteTx',
        fields: [
          {
            name: 'Keep',
            type: FieldType.SingleLineText,
          },
          {
            name: 'DropMe',
            type: FieldType.SingleLineText,
          },
        ],
      });
      const dropFieldId = table.fields?.find((f) => f.name === 'DropMe')?.id as string;
      expect(dropFieldId).toBeTruthy();

      const fieldRaw = await prismaService.field.findUniqueOrThrow({
        where: { id: dropFieldId },
        select: { dbFieldName: true },
      });

      const hasColumn = async () =>
        dbProvider.checkColumnExist(
          table.dbTableName,
          fieldRaw.dbFieldName,
          prismaService.txClient()
        );
      expect(await hasColumn()).toBe(true);

      const originalAlter = fieldService.alterTableDeleteField.bind(fieldService);
      alterSpy = vi
        .spyOn(fieldService, 'alterTableDeleteField')
        .mockImplementationOnce(async (...args) => {
          await originalAlter(...(args as Parameters<typeof originalAlter>));
          throw new Error('force-delete-failure');
        });

      const error = await getError(() =>
        runWithTestUser(clsService, () => fieldOpenApiService.deleteField(table.id, dropFieldId))
      );
      expect(error).toBeTruthy();

      const fieldAfter = await prismaService.field.findUnique({
        where: { id: dropFieldId },
        select: { id: true },
      });
      expect(fieldAfter?.id).toBe(dropFieldId);
      expect(await hasColumn()).toBe(true);
    } finally {
      alterSpy?.mockRestore();
      await permanentDeleteBase(base.id);
    }
  });
});
