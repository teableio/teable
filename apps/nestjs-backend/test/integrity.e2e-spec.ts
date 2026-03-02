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
  IntegrityIssueType,
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
    const compiled = builder.toSQL();
    const sqlItems = Array.isArray(compiled) ? compiled : [compiled];
    const statements = sqlItems
      .map(({ sql, bindings }) => ({
        sql,
        bindings: bindings || [],
      }))
      .filter(({ sql }) => sql && !sql.startsWith('PRAGMA'));

    let result: unknown;
    for (const { sql, bindings } of statements) {
      const executableSql = knex.raw(sql, bindings).toQuery();
      result = await prisma.$executeRawUnsafe(executableSql);
    }
    return result;
  }

  async function getColumnValue(tableName: string, columnName: string, recordId: string) {
    const query = knex(tableName).select(columnName).where('__id', recordId).toQuery();
    const rows = await prisma.$queryRawUnsafe<Record<string, string | null>[]>(query);
    return rows[0]?.[columnName] ?? null;
  }

  async function getJunctionForeignIds(
    tableName: string,
    selfKeyName: string,
    foreignKeyName: string,
    selfId: string
  ) {
    const query = knex(tableName).select(foreignKeyName).where(selfKeyName, selfId).toQuery();
    const rows = await prisma.$queryRawUnsafe<Record<string, string | null>[]>(query);
    return rows.map((row) => row[foreignKeyName]).filter(Boolean) as string[];
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

      const integrity = await checkBaseIntegrity(baseId2, base2table1.id);
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

      const integrity = await checkBaseIntegrity(baseId2, base2table2.id);
      expect(integrity.data.hasIssues).toEqual(false);

      // test multiple link
      await executeKnex(
        dbProvider.integrityQuery().updateJsonField({
          recordIds: [base2table2.records[0].id],
          dbTableName: base2table2.dbTableName,
          field: symLinkField.dbFieldName,
          value: 'xxx',
          arrayIndex: 0,
        })
      );

      const record = await getRecord(base2table2.id, base2table2.records[0].id);
      expect(record.data.fields[symLinkField.name]).toEqual([
        { id: 'xxx', title: 'a1' },
        { id: base2table1.records[1].id, title: 'a2' },
      ]);

      const integrity2 = await checkBaseIntegrity(baseId2, base2table2.id);
      expect(integrity2.data.hasIssues).toEqual(true);
      expect(integrity2.data.linkFieldIssues.length).toEqual(1);

      await fixBaseIntegrity(baseId2, base2table2.id);

      const integrity3 = await checkBaseIntegrity(baseId2, base2table2.id);
      expect(integrity3.data.hasIssues).toEqual(false);

      // test single link
      await executeKnex(
        dbProvider.integrityQuery().updateJsonField({
          recordIds: [base2table1.records[0].id],
          dbTableName: base2table1.dbTableName,
          field: linkField.dbFieldName,
          value: 'xxx',
        })
      );

      const record2 = await getRecord(base2table1.id, base2table1.records[0].id);
      expect(record2.data.fields[linkField.name]).toEqual({ id: 'xxx', title: 'b1' });

      const integrity4 = await checkBaseIntegrity(baseId2, base2table2.id);
      expect(integrity4.data.hasIssues).toEqual(true);

      await fixBaseIntegrity(baseId2, base2table2.id);

      const integrity5 = await checkBaseIntegrity(baseId2, base2table2.id);
      expect(integrity5.data.hasIssues).toEqual(false);
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

      const integrity = await checkBaseIntegrity(baseId2, base2table2.id);
      expect(integrity.data.hasIssues).toEqual(false);

      // test multiple link
      await executeKnex(
        dbProvider.integrityQuery().updateJsonField({
          recordIds: [base2table2.records[0].id, base2table2.records[1].id],
          dbTableName: base2table2.dbTableName,
          field: symLinkField.dbFieldName,
          value: 'xxx',
        })
      );

      const records = await getRecords(base2table2.id);
      expect(records.data.records[0].fields[symLinkField.name]).toEqual({ id: 'xxx', title: 'a1' });
      expect(records.data.records[1].fields[symLinkField.name]).toEqual({ id: 'xxx', title: 'a2' });

      const integrity2 = await checkBaseIntegrity(baseId2, base2table2.id);
      expect(integrity2.data.hasIssues).toEqual(true);
      expect(integrity2.data.linkFieldIssues.length).toEqual(1);

      await fixBaseIntegrity(baseId2, base2table2.id);

      const integrity3 = await checkBaseIntegrity(baseId2, base2table2.id);
      expect(integrity3.data.hasIssues).toEqual(false);

      // test single link
      await executeKnex(
        dbProvider.integrityQuery().updateJsonField({
          recordIds: [base2table1.records[0].id, base2table1.records[1].id],
          dbTableName: base2table1.dbTableName,
          field: linkField.dbFieldName,
          value: 'xxx',
        })
      );

      const records2 = await getRecords(base2table1.id);
      expect(records2.data.records[0].fields[linkField.name]).toEqual({ id: 'xxx', title: 'b1' });
      expect(records2.data.records[1].fields[linkField.name]).toEqual({ id: 'xxx', title: 'b2' });

      const integrity4 = await checkBaseIntegrity(baseId2, base2table2.id);
      expect(integrity4.data.hasIssues).toEqual(true);

      await fixBaseIntegrity(baseId2, base2table2.id);

      const integrity5 = await checkBaseIntegrity(baseId2, base2table2.id);
      expect(integrity5.data.hasIssues).toEqual(false);
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

      const integrity = await checkBaseIntegrity(baseId2, base2table2.id);
      expect(integrity.data.hasIssues).toEqual(false);

      // test multiple link
      await executeKnex(
        dbProvider.integrityQuery().updateJsonField({
          recordIds: [base2table2.records[0].id],
          dbTableName: base2table2.dbTableName,
          field: symLinkField.dbFieldName,
          value: 'xxx',
          arrayIndex: 0,
        })
      );

      const record = await getRecord(base2table2.id, base2table2.records[0].id);
      expect(record.data.fields[symLinkField.name]).toEqual([
        { id: 'xxx', title: 'a1' },
        { id: base2table1.records[1].id, title: 'a2' },
      ]);

      const integrity2 = await checkBaseIntegrity(baseId2, base2table2.id);
      expect(integrity2.data.hasIssues).toEqual(true);
      expect(integrity2.data.linkFieldIssues.length).toEqual(1);

      await fixBaseIntegrity(baseId2, base2table2.id);

      const integrity3 = await checkBaseIntegrity(baseId2, base2table2.id);
      expect(integrity3.data.hasIssues).toEqual(false);

      // test single link
      await executeKnex(
        dbProvider.integrityQuery().updateJsonField({
          recordIds: [base2table1.records[0].id],
          dbTableName: base2table1.dbTableName,
          field: linkField.dbFieldName,
          value: 'xxx',
          arrayIndex: 0,
        })
      );

      const record2 = await getRecord(base2table1.id, base2table1.records[0].id);
      expect(record2.data.fields[linkField.name]).toEqual([{ id: 'xxx', title: 'b1' }]);

      const integrity4 = await checkBaseIntegrity(baseId2, base2table2.id);
      expect(integrity4.data.hasIssues).toEqual(true);

      await fixBaseIntegrity(baseId2, base2table2.id);

      const integrity5 = await checkBaseIntegrity(baseId2, base2table2.id);
      expect(integrity5.data.hasIssues).toEqual(false);
    });

    it('should surface and fix missing foreign key columns during link integrity check', async () => {
      const linkFieldRo: IFieldRo = {
        name: 'many many link',
        type: FieldType.Link,
        options: {
          baseId: baseId2,
          relationship: Relationship.ManyMany,
          foreignTableId: base2table2.id,
        },
      };

      const linkField = await createField(base2table1.id, linkFieldRo);
      const options = linkField.options as ILinkFieldOptions;

      await executeKnex(
        knex.schema.alterTable(options.fkHostTableName, (table) => {
          table.dropColumn(options.foreignKeyName);
        })
      );

      const integrity = await checkBaseIntegrity(baseId2, base2table1.id);
      const issues = integrity.data.linkFieldIssues.flatMap((item) => item.issues);
      expect(
        issues.some(
          (issue) =>
            issue.type === IntegrityIssueType.ForeignKeyNotFound && issue.fieldId === linkField.id
        )
      ).toEqual(true);

      await fixBaseIntegrity(baseId2, base2table1.id);

      const integrityAfterFix = await checkBaseIntegrity(baseId2, base2table1.id);
      expect(integrityAfterFix.data.hasIssues).toEqual(false);
    });

    it('should rebuild missing junction table during link integrity fix', async () => {
      const linkFieldRo: IFieldRo = {
        name: 'many many link (drop table)',
        type: FieldType.Link,
        options: {
          baseId: baseId2,
          relationship: Relationship.ManyMany,
          foreignTableId: base2table2.id,
        },
      };

      const linkField = await createField(base2table1.id, linkFieldRo);
      const options = linkField.options as ILinkFieldOptions;

      await executeKnex(knex.schema.dropTable(options.fkHostTableName));

      const integrity = await checkBaseIntegrity(baseId2, base2table1.id);
      const issues = integrity.data.linkFieldIssues.flatMap((item) => item.issues);
      expect(
        issues.some(
          (issue) =>
            issue.type === IntegrityIssueType.ForeignKeyHostTableNotFound &&
            issue.fieldId === linkField.id
        )
      ).toEqual(true);

      await fixBaseIntegrity(baseId2, base2table1.id);

      const integrityAfterFix = await checkBaseIntegrity(baseId2, base2table1.id);
      expect(integrityAfterFix.data.hasIssues).toEqual(false);
    });

    it('should restore missing foreign key columns for ManyOne link host', async () => {
      const linkFieldRo: IFieldRo = {
        name: 'many one link (drop column)',
        type: FieldType.Link,
        options: {
          baseId: baseId2,
          relationship: Relationship.ManyOne,
          foreignTableId: base2table2.id,
        },
      };

      const linkField = await createField(base2table1.id, linkFieldRo);
      const options = linkField.options as ILinkFieldOptions;

      await executeKnex(
        knex.schema.alterTable(options.fkHostTableName, (table) => {
          table.dropColumn(options.foreignKeyName);
          table.dropColumn(`${options.foreignKeyName}_order`);
        })
      );

      const integrity = await checkBaseIntegrity(baseId2, base2table1.id);
      const issues = integrity.data.linkFieldIssues.flatMap((item) => item.issues);
      expect(
        issues.some(
          (issue) =>
            issue.type === IntegrityIssueType.ForeignKeyNotFound && issue.fieldId === linkField.id
        )
      ).toEqual(true);

      await fixBaseIntegrity(baseId2, base2table1.id);

      const integrityAfterFix = await checkBaseIntegrity(baseId2, base2table1.id);
      expect(integrityAfterFix.data.hasIssues).toEqual(false);
    });

    it('should backfill ManyOne foreign key values from link cell data', async () => {
      const linkFieldRo: IFieldRo = {
        name: 'many one link backfill',
        type: FieldType.Link,
        options: {
          baseId: baseId2,
          relationship: Relationship.ManyOne,
          foreignTableId: base2table2.id,
        },
      };

      const linkField = await createField(base2table1.id, linkFieldRo);
      const options = linkField.options as ILinkFieldOptions;

      await updateRecord(base2table2.id, base2table2.records[0].id, {
        record: {
          fields: {
            [base2table2.fields[0].name]: 'b1',
          },
        },
      });

      await updateRecord(base2table1.id, base2table1.records[0].id, {
        record: {
          fields: {
            [linkField.name]: { id: base2table2.records[0].id },
          },
        },
      });

      await executeKnex(
        knex.schema.alterTable(options.fkHostTableName, (table) => {
          table.dropColumn(options.foreignKeyName);
        })
      );

      await fixBaseIntegrity(baseId2, base2table1.id);

      const fkValue = await getColumnValue(
        options.fkHostTableName,
        options.foreignKeyName,
        base2table1.records[0].id
      );
      expect(fkValue).toEqual(base2table2.records[0].id);

      const record = await getRecord(base2table1.id, base2table1.records[0].id);
      expect(record.data.fields[linkField.name]).toEqual(
        expect.objectContaining({ id: base2table2.records[0].id })
      );
    });

    it('should backfill OneMany (two-way) foreign key values from link cell data', async () => {
      const linkFieldRo: IFieldRo = {
        name: 'one many link backfill',
        type: FieldType.Link,
        options: {
          baseId: baseId2,
          relationship: Relationship.OneMany,
          foreignTableId: base2table2.id,
        },
      };

      const linkField = await createField(base2table1.id, linkFieldRo);
      const options = linkField.options as ILinkFieldOptions;

      await updateRecord(base2table1.id, base2table1.records[0].id, {
        record: {
          fields: {
            [linkField.name]: [
              { id: base2table2.records[0].id },
              { id: base2table2.records[1].id },
            ],
          },
        },
      });

      await executeKnex(
        knex.schema.alterTable(options.fkHostTableName, (table) => {
          table.dropColumn(options.selfKeyName);
        })
      );

      await fixBaseIntegrity(baseId2, base2table1.id);

      const fkValue1 = await getColumnValue(
        options.fkHostTableName,
        options.selfKeyName,
        base2table2.records[0].id
      );
      const fkValue2 = await getColumnValue(
        options.fkHostTableName,
        options.selfKeyName,
        base2table2.records[1].id
      );
      expect([fkValue1, fkValue2]).toEqual([base2table1.records[0].id, base2table1.records[0].id]);

      const record = await getRecord(base2table1.id, base2table1.records[0].id);
      const linkIds = (record.data.fields[linkField.name] as { id: string }[])
        .map((item) => item.id)
        .sort();
      expect(linkIds).toEqual([base2table2.records[0].id, base2table2.records[1].id].sort());
    });

    it('should backfill OneMany (one-way) junction rows from link cell data', async () => {
      const linkFieldRo: IFieldRo = {
        name: 'one way link backfill',
        type: FieldType.Link,
        options: {
          baseId: baseId2,
          relationship: Relationship.OneMany,
          foreignTableId: base2table2.id,
          isOneWay: true,
        },
      };

      const linkField = await createField(base2table1.id, linkFieldRo);
      const options = linkField.options as ILinkFieldOptions;

      await updateRecord(base2table1.id, base2table1.records[0].id, {
        record: {
          fields: {
            [linkField.name]: [
              { id: base2table2.records[0].id },
              { id: base2table2.records[1].id },
            ],
          },
        },
      });

      await executeKnex(knex.schema.dropTable(options.fkHostTableName));

      await fixBaseIntegrity(baseId2, base2table1.id);

      const foreignIds = await getJunctionForeignIds(
        options.fkHostTableName,
        options.selfKeyName,
        options.foreignKeyName,
        base2table1.records[0].id
      );
      expect(foreignIds.sort()).toEqual(
        [base2table2.records[0].id, base2table2.records[1].id].sort()
      );

      const record = await getRecord(base2table1.id, base2table1.records[0].id);
      const linkIds = (record.data.fields[linkField.name] as { id: string }[])
        .map((item) => item.id)
        .sort();
      expect(linkIds).toEqual([base2table2.records[0].id, base2table2.records[1].id].sort());
    });

    it('should backfill ManyMany junction rows when foreign key column is missing', async () => {
      const linkFieldRo: IFieldRo = {
        name: 'many many link backfill (drop column)',
        type: FieldType.Link,
        options: {
          baseId: baseId2,
          relationship: Relationship.ManyMany,
          foreignTableId: base2table2.id,
        },
      };

      const linkField = await createField(base2table1.id, linkFieldRo);
      const options = linkField.options as ILinkFieldOptions;

      await updateRecord(base2table1.id, base2table1.records[0].id, {
        record: {
          fields: {
            [linkField.name]: [
              { id: base2table2.records[0].id },
              { id: base2table2.records[1].id },
            ],
          },
        },
      });

      await executeKnex(
        knex.schema.alterTable(options.fkHostTableName, (table) => {
          table.dropForeign(options.foreignKeyName, `fk_${options.foreignKeyName}`);
          table.dropColumn(options.foreignKeyName);
        })
      );

      await fixBaseIntegrity(baseId2, base2table1.id);

      const foreignIds = await getJunctionForeignIds(
        options.fkHostTableName,
        options.selfKeyName,
        options.foreignKeyName,
        base2table1.records[0].id
      );
      expect(foreignIds.sort()).toEqual(
        [base2table2.records[0].id, base2table2.records[1].id].sort()
      );

      const record = await getRecord(base2table1.id, base2table1.records[0].id);
      const linkIds = (record.data.fields[linkField.name] as { id: string }[])
        .map((item) => item.id)
        .sort();
      expect(linkIds).toEqual([base2table2.records[0].id, base2table2.records[1].id].sort());
    });

    it('should backfill ManyMany junction rows when junction table is missing', async () => {
      const linkFieldRo: IFieldRo = {
        name: 'many many link backfill (drop table)',
        type: FieldType.Link,
        options: {
          baseId: baseId2,
          relationship: Relationship.ManyMany,
          foreignTableId: base2table2.id,
        },
      };

      const linkField = await createField(base2table1.id, linkFieldRo);
      const options = linkField.options as ILinkFieldOptions;

      await updateRecord(base2table1.id, base2table1.records[0].id, {
        record: {
          fields: {
            [linkField.name]: [
              { id: base2table2.records[0].id },
              { id: base2table2.records[1].id },
            ],
          },
        },
      });

      await executeKnex(knex.schema.dropTable(options.fkHostTableName));

      await fixBaseIntegrity(baseId2, base2table1.id);

      const foreignIds = await getJunctionForeignIds(
        options.fkHostTableName,
        options.selfKeyName,
        options.foreignKeyName,
        base2table1.records[0].id
      );
      expect(foreignIds.sort()).toEqual(
        [base2table2.records[0].id, base2table2.records[1].id].sort()
      );

      const record = await getRecord(base2table1.id, base2table1.records[0].id);
      const linkIds = (record.data.fields[linkField.name] as { id: string }[])
        .map((item) => item.id)
        .sort();
      expect(linkIds).toEqual([base2table2.records[0].id, base2table2.records[1].id].sort());
    });

    it('should backfill OneOne foreign key values from link cell data', async () => {
      const linkFieldRo: IFieldRo = {
        name: 'one one link backfill',
        type: FieldType.Link,
        options: {
          baseId: baseId2,
          relationship: Relationship.OneOne,
          foreignTableId: base2table2.id,
        },
      };

      const linkField = await createField(base2table1.id, linkFieldRo);
      const options = linkField.options as ILinkFieldOptions;

      await updateRecord(base2table2.id, base2table2.records[0].id, {
        record: {
          fields: {
            [base2table2.fields[0].name]: 'b1',
          },
        },
      });

      await updateRecord(base2table1.id, base2table1.records[0].id, {
        record: {
          fields: {
            [linkField.name]: { id: base2table2.records[0].id },
          },
        },
      });

      await executeKnex(
        knex.schema.alterTable(options.fkHostTableName, (table) => {
          table.dropColumn(options.foreignKeyName);
        })
      );

      await fixBaseIntegrity(baseId2, base2table1.id);

      const fkValue = await getColumnValue(
        options.fkHostTableName,
        options.foreignKeyName,
        base2table1.records[0].id
      );
      expect(fkValue).toEqual(base2table2.records[0].id);

      const record = await getRecord(base2table1.id, base2table1.records[0].id);
      expect(record.data.fields[linkField.name]).toEqual(
        expect.objectContaining({ id: base2table2.records[0].id })
      );
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

      const integrity1 = await checkBaseIntegrity(baseId1, base1table.id);
      expect(integrity1.data.hasIssues).toEqual(true);

      await fixBaseIntegrity(baseId1, base1table.id);

      const integrity2 = await checkBaseIntegrity(baseId1, base1table.id);
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

      const integrity1 = await checkBaseIntegrity(baseId1, base1table.id);
      expect(integrity1.data.hasIssues).toEqual(true);

      await fixBaseIntegrity(baseId1, base1table.id);

      const integrity2 = await checkBaseIntegrity(baseId1, base1table.id);
      expect(integrity2.data.hasIssues).toEqual(false);
    });
  });

  describe('fix empty string cell value', () => {
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

    it('should check integrity when empty string cell value is found', async () => {
      const integrity = await checkBaseIntegrity(baseId1, base1table.id);
      expect(integrity.data.hasIssues).toEqual(false);

      const sql = knex(base1table.dbTableName)
        .update({
          [base1table.fields[0].dbFieldName]: '',
        })
        .toQuery();
      await prisma.txClient().$executeRawUnsafe(sql);

      const integrity2 = await checkBaseIntegrity(baseId1, base1table.id);
      expect(integrity2.data.hasIssues).toEqual(true);

      await fixBaseIntegrity(baseId1, base1table.id);

      const integrity3 = await checkBaseIntegrity(baseId1, base1table.id);
      expect(integrity3.data.hasIssues).toEqual(false);
    });
  });
});
