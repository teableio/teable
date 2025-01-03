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
} from '@teable/openapi';
import type { Knex } from 'knex';
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
  let db: Knex;

  async function executeKnex(builder: Knex.SchemaBuilder | Knex.QueryBuilder) {
    const query = builder.toQuery();
    return await prisma.$executeRawUnsafe(query);
  }

  beforeAll(async () => {
    const appCtx = await initApp();
    db = appCtx.app.get('CUSTOM_KNEX');
    prisma = appCtx.app.get<PrismaService>(PrismaService);
    app = appCtx.app;
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

    it('should check integrity when a record is deleted in link table', async () => {
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
      expect((linkField.options as ILinkFieldOptions).baseId).toBeUndefined();

      const symLinkField = await getField(
        base2table2.id,
        (linkField.options as ILinkFieldOptions).symmetricFieldId as string
      );

      expect((symLinkField.options as ILinkFieldOptions).baseId).toBeUndefined();

      const manyManyField = (
        await convertField(base2table1.id, linkField.id, {
          type: FieldType.Link,
          options: {
            relationship: Relationship.ManyMany,
            foreignTableId: base2table1.id,
          },
        })
      ).data;

      const integrity = await checkBaseIntegrity(baseId2);
      expect(integrity.data.hasIssues).toEqual(false);

      const { fkHostTableName, selfKeyName, foreignKeyName } =
        manyManyField.options as ILinkFieldOptions;

      await executeKnex(
        db(fkHostTableName).insert({
          [selfKeyName]: 'test',
          [foreignKeyName]: 'test',
        })
      );

      const integrity2 = await checkBaseIntegrity(baseId2);
      expect(integrity2.data.hasIssues).toEqual(true);

      await fixBaseIntegrity(baseId2);

      const integrity3 = await checkBaseIntegrity(baseId2);
      expect(integrity3.data.hasIssues).toEqual(false);
    });
  });
});
