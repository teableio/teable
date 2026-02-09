import type { INestApplication } from '@nestjs/common';
import type { IFieldRo, ILinkFieldOptionsRo, ILookupOptionsRo } from '@teable/core';
import { FieldKeyType, FieldType, Relationship } from '@teable/core';
import {
  createField,
  createRecords,
  createTable,
  getRecord,
  initApp,
  permanentDeleteTable,
  updateRecordByApi,
} from './utils/init-app';

describe('Formula COUNTALL user/link/lookup regression (e2e)', () => {
  let app: INestApplication;
  const baseId = globalThis.testConfig.baseId;

  beforeAll(async () => {
    const appCtx = await initApp();
    app = appCtx.app;
  });

  afterAll(async () => {
    await app.close();
  });

  it('counts values for multi-user field and linked lookup user field', async () => {
    let sourceTableId: string | undefined;
    let hostTableId: string | undefined;

    try {
      const sourceTable = await createTable(baseId, {
        name: 'formula-countall-user-source',
        fields: [{ name: 'Name', type: FieldType.SingleLineText }],
      });
      sourceTableId = sourceTable.id;

      const sourcePrimaryFieldId = sourceTable.fields.find((field) => field.isPrimary)?.id;
      if (!sourcePrimaryFieldId) {
        throw new Error('Missing source primary field');
      }

      const ownersField = await createField(sourceTable.id, {
        name: 'Owners',
        type: FieldType.User,
        options: {
          isMultiple: true,
          shouldNotify: false,
        },
      });

      const directCountField = await createField(sourceTable.id, {
        name: 'Owners Count',
        type: FieldType.Formula,
        options: {
          expression: `COUNTALL({${ownersField.id}})`,
        },
      });

      const createdSource = await createRecords(sourceTable.id, {
        fieldKeyType: FieldKeyType.Id,
        typecast: true,
        records: [
          {
            fields: {
              [sourcePrimaryFieldId]: 'source-a',
              [ownersField.id]: [globalThis.testConfig.userId],
            },
          },
          {
            fields: {
              [sourcePrimaryFieldId]: 'source-b',
            },
          },
        ],
      });

      const sourceRecordA = await getRecord(sourceTable.id, createdSource.records[0].id);
      const sourceRecordB = await getRecord(sourceTable.id, createdSource.records[1].id);

      expect(Number(sourceRecordA.fields[directCountField.id])).toBe(1);
      expect(Number(sourceRecordB.fields[directCountField.id] ?? 0)).toBe(0);

      const hostTable = await createTable(baseId, {
        name: 'formula-countall-user-host',
        fields: [{ name: 'Title', type: FieldType.SingleLineText }],
      });
      hostTableId = hostTable.id;

      const hostPrimaryFieldId = hostTable.fields.find((field) => field.isPrimary)?.id;
      if (!hostPrimaryFieldId) {
        throw new Error('Missing host primary field');
      }

      const linkField = await createField(hostTable.id, {
        name: 'People',
        type: FieldType.Link,
        options: {
          relationship: Relationship.ManyMany,
          foreignTableId: sourceTable.id,
        } as ILinkFieldOptionsRo,
      } as IFieldRo);

      const lookupOwnersField = await createField(hostTable.id, {
        name: 'Lookup Owners',
        type: FieldType.User,
        isLookup: true,
        lookupOptions: {
          foreignTableId: sourceTable.id,
          linkFieldId: linkField.id,
          lookupFieldId: ownersField.id,
        } as ILookupOptionsRo,
      } as IFieldRo);

      const linkCountField = await createField(hostTable.id, {
        name: 'People Count',
        type: FieldType.Formula,
        options: {
          expression: `COUNTALL({${linkField.id}})`,
        },
      });

      const lookupCountField = await createField(hostTable.id, {
        name: 'Lookup Owners Count',
        type: FieldType.Formula,
        options: {
          expression: `COUNTALL({${lookupOwnersField.id}})`,
        },
      });

      const createdHost = await createRecords(hostTable.id, {
        fieldKeyType: FieldKeyType.Id,
        typecast: true,
        records: [
          {
            fields: {
              [hostPrimaryFieldId]: 'host-1',
              [linkField.id]: [
                { id: createdSource.records[0].id },
                { id: createdSource.records[1].id },
              ],
            },
          },
        ],
      });

      const hostRecordId = createdHost.records[0].id;
      const hostRecord = await getRecord(hostTable.id, hostRecordId);

      expect(Number(hostRecord.fields[linkCountField.id])).toBe(2);
      expect(Number(hostRecord.fields[lookupCountField.id])).toBe(1);

      await updateRecordByApi(hostTable.id, hostRecordId, linkField.id, null);

      const clearedHostRecord = await getRecord(hostTable.id, hostRecordId);
      expect(Number(clearedHostRecord.fields[linkCountField.id] ?? 0)).toBe(0);
      expect(Number(clearedHostRecord.fields[lookupCountField.id] ?? 0)).toBe(0);
    } finally {
      if (hostTableId) {
        await permanentDeleteTable(baseId, hostTableId);
      }
      if (sourceTableId) {
        await permanentDeleteTable(baseId, sourceTableId);
      }
    }
  });
});
