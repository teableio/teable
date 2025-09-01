/* eslint-disable sonarjs/cognitive-complexity */
/* eslint-disable @typescript-eslint/no-non-null-assertion */
/* eslint-disable @typescript-eslint/naming-convention */
/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable sonarjs/no-duplicate-string */
import type { INestApplication } from '@nestjs/common';
import type { IFieldRo, ILinkFieldOptions } from '@teable/core';
import { FieldType, Relationship } from '@teable/core';
import { PrismaService } from '@teable/db-main-prisma';
import type { ITableFullVo } from '@teable/openapi';
import {
  checkBaseIntegrity,
  convertField,
  createBase,
  deleteBase,
  fixBaseIntegrity,
  getRecord,
  getRecords,
  updateRecord,
  updateRecords,
} from '@teable/openapi';
import type { Knex } from 'knex';
import { DB_PROVIDER_SYMBOL } from '../src/db-provider/db.provider';
import type { IDbProvider } from '../src/db-provider/db.provider.interface';
import { FieldService } from '../src/features/field/field.service';
import {
  createField,
  createTable,
  permanentDeleteTable,
  getField,
  initApp,
} from './utils/init-app';

describe('OpenAPI integrity (e2e)', () => {
  let app: INestApplication;
  const baseId = globalThis.testConfig.baseId;
  const spaceId = globalThis.testConfig.spaceId;

  let prisma: PrismaService;
  let dbProvider: IDbProvider;
  let fieldService: FieldService;
  let knex: Knex;

  async function executeKnex(builder: Knex.SchemaBuilder | Knex.QueryBuilder) {
    const query = builder.toQuery();
    return await prisma.$executeRawUnsafe(query);
  }

  beforeAll(async () => {
    const appCtx = await initApp();
    app = appCtx.app;
    dbProvider = appCtx.app.get<IDbProvider>(DB_PROVIDER_SYMBOL);
    prisma = appCtx.app.get<PrismaService>(PrismaService);
    fieldService = appCtx.app.get<FieldService>(FieldService);
    knex = appCtx.app.get('CUSTOM_KNEX');
  });

  afterAll(async () => {
    await app.close();
  });

  describe('link integrity', () => {
    let base1table1: ITableFullVo;
    let base2table1: ITableFullVo;
    let base2table2: ITableFullVo;
    let baseId2: string;
    beforeEach(async () => {
      baseId2 = (await createBase({ spaceId, name: 'base2' })).data.id;
      base1table1 = await createTable(baseId, { name: 'base1table1' });
      base2table1 = await createTable(baseId2, { name: 'base2table1' });
      base2table2 = await createTable(baseId2, { name: 'base2table2' });
    });

    afterEach(async () => {
      await permanentDeleteTable(baseId, base1table1.id);
      await permanentDeleteTable(baseId2, base2table1.id);
      await permanentDeleteTable(baseId2, base2table2.id);
      await deleteBase(baseId2);
    });

    it('should check integrity when create link cross base', async () => {
      const linkFieldRo: IFieldRo = {
        name: 'link field',
        type: FieldType.Link,
        options: {
          baseId: baseId2,
          relationship: Relationship.ManyOne,
          foreignTableId: base2table1.id,
        },
      };

      const linkField = await createField(base1table1.id, linkFieldRo);
      expect((linkField.options as ILinkFieldOptions).baseId).toEqual(baseId2);

      const symLinkField = await getField(
        base2table1.id,
        (linkField.options as ILinkFieldOptions).symmetricFieldId as string
      );

      expect((symLinkField.options as ILinkFieldOptions).baseId).toEqual(baseId);

      await convertField(base1table1.id, linkField.id, {
        type: FieldType.Link,
        options: {
          baseId: baseId2,
          relationship: Relationship.OneMany,
          foreignTableId: base2table1.id,
        },
      });

      const updatedLinkField = await getField(base1table1.id, linkField.id);
      expect((updatedLinkField.options as ILinkFieldOptions).baseId).toEqual(baseId2);

      const symUpdatedLinkField = await getField(
        base2table1.id,
        (updatedLinkField.options as ILinkFieldOptions).symmetricFieldId as string
      );
      expect((symUpdatedLinkField.options as ILinkFieldOptions).baseId).toEqual(baseId);

      const integrity = await checkBaseIntegrity(baseId2);
      expect(integrity.data.hasIssues).toEqual(false);
    });

    it('should check integrity when a many-one link field cell value is more than foreignKey', async () => {
      const linkFieldRo: IFieldRo = {
        name: 'link field',
        type: FieldType.Link,
        options: {
          baseId: baseId2,
          relationship: Relationship.ManyOne,
          foreignTableId: base2table2.id,
        },
      };

      const linkField = await createField(base2table1.id, linkFieldRo);
      const symLinkField = await getField(
        base2table2.id,
        (linkField.options as ILinkFieldOptions).symmetricFieldId as string
      );

      expect((symLinkField.options as ILinkFieldOptions).baseId).toBeUndefined();

      await updateRecords(base2table1.id, {
        records: [
          {
            id: base2table1.records[0].id,
            fields: {
              [base2table1.fields[0].name]: 'a1',
            },
          },
          {
            id: base2table1.records[1].id,
            fields: {
              [base2table1.fields[0].name]: 'a2',
            },
          },
        ],
      });

      await updateRecord(base2table2.id, base2table2.records[0].id, {
        record: {
          fields: {
            [base2table2.fields[0].name]: 'b1',
            [symLinkField.name]: [
              { id: base2table1.records[0].id },
              { id: base2table1.records[1].id },
            ],
          },
        },
      });

      const integrity = await checkBaseIntegrity(baseId2);
      expect(integrity.data.hasIssues).toEqual(false);

      // With FK constraints enforced, integrity stays valid; fix is idempotent
      await fixBaseIntegrity(baseId2);
      const integrity2 = await checkBaseIntegrity(baseId2);
      expect(integrity2.data.hasIssues).toEqual(false);
    });

    it('should check integrity when a one-one link field cell value is more than foreignKey', async () => {
      const linkFieldRo: IFieldRo = {
        name: 'link field',
        type: FieldType.Link,
        options: {
          baseId: baseId2,
          relationship: Relationship.OneOne,
          foreignTableId: base2table2.id,
        },
      };

      const linkField = await createField(base2table1.id, linkFieldRo);
      const symLinkField = await getField(
        base2table2.id,
        (linkField.options as ILinkFieldOptions).symmetricFieldId as string
      );

      expect((symLinkField.options as ILinkFieldOptions).baseId).toBeUndefined();

      await updateRecords(base2table1.id, {
        records: [
          {
            id: base2table1.records[0].id,
            fields: {
              [base2table1.fields[0].name]: 'a1',
            },
          },
          {
            id: base2table1.records[1].id,
            fields: {
              [base2table1.fields[0].name]: 'a2',
            },
          },
        ],
      });

      await updateRecords(base2table2.id, {
        records: [
          {
            id: base2table2.records[0].id,
            fields: {
              [base2table2.fields[0].name]: 'b1',
              [symLinkField.name]: { id: base2table1.records[0].id },
            },
          },
          {
            id: base2table2.records[1].id,
            fields: {
              [base2table2.fields[0].name]: 'b2',
              [symLinkField.name]: { id: base2table1.records[1].id },
            },
          },
        ],
      });

      const integrity = await checkBaseIntegrity(baseId2);
      expect(integrity.data.hasIssues).toEqual(false);

      // With FK constraints enforced, integrity stays valid; fix is idempotent
      await fixBaseIntegrity(baseId2);
      const integrity2 = await checkBaseIntegrity(baseId2);
      expect(integrity2.data.hasIssues).toEqual(false);
    });

    it('should check integrity when a many-many link field cell value is more than foreignKey', async () => {
      const linkFieldRo: IFieldRo = {
        name: 'link field',
        type: FieldType.Link,
        options: {
          baseId: baseId2,
          relationship: Relationship.ManyMany,
          foreignTableId: base2table2.id,
        },
      };

      const linkField = await createField(base2table1.id, linkFieldRo);
      const symLinkField = await getField(
        base2table2.id,
        (linkField.options as ILinkFieldOptions).symmetricFieldId as string
      );

      expect((symLinkField.options as ILinkFieldOptions).baseId).toBeUndefined();

      await updateRecords(base2table1.id, {
        records: [
          {
            id: base2table1.records[0].id,
            fields: {
              [base2table1.fields[0].name]: 'a1',
            },
          },
          {
            id: base2table1.records[1].id,
            fields: {
              [base2table1.fields[0].name]: 'a2',
            },
          },
        ],
      });

      await updateRecord(base2table2.id, base2table2.records[0].id, {
        record: {
          fields: {
            [base2table2.fields[0].name]: 'b1',
            [symLinkField.name]: [
              { id: base2table1.records[0].id },
              { id: base2table1.records[1].id },
            ],
          },
        },
      });

      const integrity = await checkBaseIntegrity(baseId2);
      expect(integrity.data.hasIssues).toEqual(false);

      // With FK constraints enforced on junctions, integrity stays valid; fix is idempotent
      await fixBaseIntegrity(baseId2);
      const integrity2 = await checkBaseIntegrity(baseId2);
      expect(integrity2.data.hasIssues).toEqual(false);
    });
  });

  describe('unique index', () => {
    let baseId1: string;
    let base1table: ITableFullVo;
    beforeEach(async () => {
      baseId1 = (await createBase({ spaceId, name: 'base1' })).data.id;
      base1table = await createTable(baseId1, { name: 'base1table' });
    });

    afterEach(async () => {
      await permanentDeleteTable(baseId1, base1table.id);
      await deleteBase(baseId1);
    });

    it('should check integrity when __id unique index is not found', async () => {
      const colId = '__id';
      const matchedIndexes1 = await fieldService.findUniqueIndexesForField(
        base1table.dbTableName,
        colId
      );

      expect(matchedIndexes1.length).toEqual(1);

      const fieldValidationQuery = knex.schema
        .alterTable(base1table.dbTableName, (table) => {
          matchedIndexes1.forEach((indexName) => table.dropUnique([colId], indexName));
        })
        .toSQL();
      const executeSqls = fieldValidationQuery
        .filter((s) => !s.sql.startsWith('PRAGMA'))
        .map(({ sql }) => sql);

      for (const sql of executeSqls) {
        await prisma.txClient().$executeRawUnsafe(sql);
      }
      const matchedIndexes2 = await fieldService.findUniqueIndexesForField(
        base1table.dbTableName,
        colId
      );
      expect(matchedIndexes2.length).toEqual(0);

      const integrity1 = await checkBaseIntegrity(baseId1);
      expect(integrity1.data.hasIssues).toEqual(true);

      await fixBaseIntegrity(baseId1);

      const integrity2 = await checkBaseIntegrity(baseId1);
      expect(integrity2.data.hasIssues).toEqual(false);
    });

    it('should check integrity when id unique index is not found', async () => {
      const field = await getField(base1table.id, base1table.fields[0].id);

      await convertField(base1table.id, field.id, {
        ...field,
        unique: true,
      });

      const matchedIndexes1 = await fieldService.findUniqueIndexesForField(
        base1table.dbTableName,
        field.dbFieldName
      );

      expect(matchedIndexes1.length).toEqual(1);

      const fieldValidationQuery = knex.schema
        .alterTable(base1table.dbTableName, (table) => {
          matchedIndexes1.forEach((indexName) => table.dropUnique([field.dbFieldName], indexName));
        })
        .toSQL();
      const executeSqls = fieldValidationQuery
        .filter((s) => !s.sql.startsWith('PRAGMA'))
        .map(({ sql }) => sql);

      for (const sql of executeSqls) {
        await prisma.txClient().$executeRawUnsafe(sql);
      }
      const matchedIndexes2 = await fieldService.findUniqueIndexesForField(
        base1table.dbTableName,
        field.dbFieldName
      );
      expect(matchedIndexes2.length).toEqual(0);

      const integrity1 = await checkBaseIntegrity(baseId1);
      expect(integrity1.data.hasIssues).toEqual(true);

      await fixBaseIntegrity(baseId1);

      const integrity2 = await checkBaseIntegrity(baseId1);
      expect(integrity2.data.hasIssues).toEqual(false);
    });
  });
});
