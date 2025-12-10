/* eslint-disable @typescript-eslint/naming-convention */
import type { INestApplication } from '@nestjs/common';
import type { IFieldRo, IFieldVo, ILinkFieldOptions } from '@teable/core';
import { FieldKeyType, FieldType, Relationship } from '@teable/core';
import type { ITableFullVo } from '@teable/openapi';
import {
  convertField,
  createField,
  createTable,
  getRecords,
  initApp,
  permanentDeleteTable,
  updateRecordByApi,
} from './utils/init-app';

describe('OneMany link with formula primary on symmetric link (e2e)', () => {
  let app: INestApplication;
  const baseId = globalThis.testConfig.baseId;

  beforeAll(async () => {
    const appCtx = await initApp();
    app = appCtx.app;
  });

  afterAll(async () => {
    await app.close();
  });

  describe('primary formula referencing symmetric link', () => {
    let tableA: ITableFullVo;
    let tableB: ITableFullVo;
    let linkAtoB: IFieldVo;
    let symmetricLinkId: string;
    let primaryFieldB: IFieldVo;

    beforeEach(async () => {
      tableA = await createTable(baseId, {
        name: 'FormulaLink_A',
        fields: [{ name: 'A Name', type: FieldType.SingleLineText }],
        records: [{ fields: { 'A Name': 'Alpha' } }],
      });

      tableB = await createTable(baseId, {
        name: 'FormulaLink_B',
        fields: [{ name: 'B Primary', type: FieldType.SingleLineText }],
        records: [{ fields: { 'B Primary': 'Row-1' } }],
      });

      primaryFieldB = tableB.fields[0];

      linkAtoB = await createField(tableA.id, {
        name: 'Link to B',
        type: FieldType.Link,
        options: {
          relationship: Relationship.OneMany,
          foreignTableId: tableB.id,
        },
      } as IFieldRo);

      symmetricLinkId = (linkAtoB.options as ILinkFieldOptions).symmetricFieldId as string;
      if (!symmetricLinkId) {
        throw new Error('Symmetric link field not created');
      }

      await convertField(tableB.id, primaryFieldB.id, {
        type: FieldType.Formula,
        options: {
          expression: `{${symmetricLinkId}}`,
        },
      });

      await updateRecordByApi(tableB.id, tableB.records[0].id, symmetricLinkId, {
        id: tableA.records[0].id,
      });
    });

    afterEach(async () => {
      await permanentDeleteTable(baseId, tableA.id);
      await permanentDeleteTable(baseId, tableB.id);
    });

    it('resolves titles on both sides when linking from the symmetric side', async () => {
      const tableBRecords = await getRecords(tableB.id, {
        fieldKeyType: FieldKeyType.Id,
        projection: [primaryFieldB.id, symmetricLinkId],
      });

      expect(tableBRecords.records).toHaveLength(1);
      const bRecord = tableBRecords.records[0];

      expect(bRecord.fields[primaryFieldB.id]).toBe('Alpha');
      const linkValueB = bRecord.fields[symmetricLinkId] as { id: string; title?: string };
      expect(linkValueB.id).toBe(tableA.records[0].id);
      expect(linkValueB.title).toBe('Alpha');

      const tableARecords = await getRecords(tableA.id, {
        fieldKeyType: FieldKeyType.Id,
        projection: [linkAtoB.id],
      });

      const aRecord = tableARecords.records.find((r) => r.id === tableA.records[0].id);
      expect(aRecord).toBeDefined();

      const aLinkValues = aRecord?.fields[linkAtoB.id] as Array<{ id: string; title?: string }>;
      expect(Array.isArray(aLinkValues)).toBe(true);
      expect(aLinkValues).toHaveLength(1);
      expect(aLinkValues?.[0].id).toBe(tableB.records[0].id);
      expect(aLinkValues?.[0].title).toBe('Alpha');
    });
  });

  describe('lookup from symmetric link to another link column', () => {
    let tableA: ITableFullVo;
    let tableB: ITableFullVo;
    let tableC: ITableFullVo;
    let linkAtoB: IFieldVo;
    let linkAtoC: IFieldVo;
    let symmetricLinkId: string;
    let lookupBCtoC: IFieldVo;

    beforeEach(async () => {
      tableA = await createTable(baseId, {
        name: 'LookupChain_A',
        fields: [{ name: 'A Name', type: FieldType.SingleLineText }],
        records: [{ fields: { 'A Name': 'Alpha' } }],
      });

      tableB = await createTable(baseId, {
        name: 'LookupChain_B',
        fields: [{ name: 'B Primary', type: FieldType.SingleLineText }],
        records: [{ fields: { 'B Primary': 'Row-1' } }],
      });

      tableC = await createTable(baseId, {
        name: 'LookupChain_C',
        fields: [{ name: 'C Name', type: FieldType.SingleLineText }],
        records: [{ fields: { 'C Name': 'C1' } }],
      });

      linkAtoB = await createField(tableA.id, {
        name: 'Link to B',
        type: FieldType.Link,
        options: {
          relationship: Relationship.OneMany,
          foreignTableId: tableB.id,
        },
      } as IFieldRo);

      symmetricLinkId = (linkAtoB.options as ILinkFieldOptions).symmetricFieldId as string;
      if (!symmetricLinkId) {
        throw new Error('Symmetric link field not created');
      }

      await convertField(tableB.id, tableB.fields[0].id, {
        type: FieldType.Formula,
        options: {
          expression: `{${symmetricLinkId}}`,
        },
      });

      linkAtoC = await createField(tableA.id, {
        name: 'Link to C',
        type: FieldType.Link,
        options: {
          relationship: Relationship.ManyOne,
          foreignTableId: tableC.id,
        },
      } as IFieldRo);

      await updateRecordByApi(tableA.id, tableA.records[0].id, linkAtoC.id, {
        id: tableC.records[0].id,
      });

      await updateRecordByApi(tableB.id, tableB.records[0].id, symmetricLinkId, {
        id: tableA.records[0].id,
      });

      lookupBCtoC = await createField(tableB.id, {
        name: 'Lookup C via A',
        type: FieldType.Link,
        isLookup: true,
        lookupOptions: {
          foreignTableId: tableA.id,
          linkFieldId: symmetricLinkId,
          lookupFieldId: linkAtoC.id,
        },
      } as IFieldRo);
    });

    afterEach(async () => {
      await permanentDeleteTable(baseId, tableA.id);
      await permanentDeleteTable(baseId, tableB.id);
      await permanentDeleteTable(baseId, tableC.id);
    });

    it('returns correct lookup and link titles after linking via symmetric field', async () => {
      const bRecords = await getRecords(tableB.id, {
        fieldKeyType: FieldKeyType.Id,
        projection: [symmetricLinkId, lookupBCtoC.id],
      });

      expect(bRecords.records).toHaveLength(1);
      const bRecord = bRecords.records[0];

      const lookupValue = bRecord.fields[lookupBCtoC.id] as { id: string; title?: string };
      expect(lookupValue.id).toBe(tableC.records[0].id);
      expect(lookupValue.title).toBe('C1');

      const bLinkValue = bRecord.fields[symmetricLinkId] as { id: string; title?: string };
      expect(bLinkValue.id).toBe(tableA.records[0].id);
      expect(bLinkValue.title).toBe('Alpha');

      const aRecords = await getRecords(tableA.id, {
        fieldKeyType: FieldKeyType.Id,
        projection: [linkAtoB.id, linkAtoC.id],
      });

      const aRecord = aRecords.records.find((r) => r.id === tableA.records[0].id);
      expect(aRecord).toBeDefined();
      const aLinkToB = aRecord?.fields[linkAtoB.id] as Array<{ id: string; title?: string }>;
      expect(Array.isArray(aLinkToB)).toBe(true);
      expect(aLinkToB).toHaveLength(1);
      expect(aLinkToB?.[0].id).toBe(tableB.records[0].id);
      expect(aLinkToB?.[0].title).toBe('Alpha');

      const aLinkToC = aRecord?.fields[linkAtoC.id] as { id: string; title?: string };
      expect(aLinkToC.id).toBe(tableC.records[0].id);
      expect(aLinkToC.title).toBe('C1');
    });
  });
});
