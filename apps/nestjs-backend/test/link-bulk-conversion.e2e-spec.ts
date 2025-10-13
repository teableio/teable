// https://app.teable.ai/base/bserJ2pmgiLHFHfXNwE/tblNHimLUhUDtC3K7Jk/viwE6eAa74PrTlVWGn3?recordId=recwzQGcuy0gk0b58oB
// https://app.teable.ai/base/bserJ2pmgiLHFHfXNwE/tblNHimLUhUDtC3K7Jk/viwE6eAa74PrTlVWGn3?recordId=recJCD7VhrXShkk3zmw
/* eslint-disable sonarjs/cognitive-complexity */
/* eslint-disable @typescript-eslint/naming-convention */

import type { INestApplication } from '@nestjs/common';
import { FieldKeyType, FieldType, Relationship, getRandomString } from '@teable/core';
import type { ITableFullVo } from '@teable/openapi';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import {
  convertField,
  createBase,
  createRecords,
  createTable,
  getRecords,
  initApp,
  permanentDeleteBase,
  permanentDeleteTable,
} from './utils/init-app';

const AGENCY_CODES = [
  { code: 'US', name: 'United States National Agency' },
  { code: 'BR', name: 'Brazil National Agency' },
  { code: 'TW', name: 'Taiwan Regional Agency' },
  { code: 'CN', name: 'China National Agency' },
  { code: 'JP', name: 'Japan National Agency' },
  { code: 'DE', name: 'Germany Federal Agency' },
  { code: 'FR', name: 'France National Agency' },
  { code: 'IN', name: 'India National Agency' },
  { code: 'AU', name: 'Australia National Agency' },
  { code: 'ZA', name: 'South Africa National Agency' },
] as const;

const TOTAL_RECORDS = 20_000;
const PAGE_SIZE = 1_000;

const spaceId = globalThis.testConfig.spaceId;

describe('Bulk text to link conversion (e2e)', () => {
  let app: INestApplication | undefined;
  let nationalBaseId: string | undefined;
  let dataBaseId: string | undefined;
  let nationalTable: ITableFullVo | undefined;
  let dataTable: ITableFullVo | undefined;

  beforeAll(async () => {
    const ctx = await initApp();
    app = ctx.app;
  });

  afterAll(async () => {
    const cleanupErrors: unknown[] = [];

    if (dataTable && dataBaseId) {
      try {
        await permanentDeleteTable(dataBaseId, dataTable.id);
      } catch (error) {
        cleanupErrors.push({ scope: 'dataTable', error });
      }
    }

    if (nationalTable && nationalBaseId) {
      try {
        await permanentDeleteTable(nationalBaseId, nationalTable.id);
      } catch (error) {
        cleanupErrors.push({ scope: 'nationalTable', error });
      }
    }

    if (dataBaseId) {
      try {
        await permanentDeleteBase(dataBaseId);
      } catch (error) {
        cleanupErrors.push({ scope: 'dataBase', error });
      }
    }

    if (nationalBaseId) {
      try {
        await permanentDeleteBase(nationalBaseId);
      } catch (error) {
        cleanupErrors.push({ scope: 'nationalBase', error });
      }
    }

    if (app) {
      await app.close();
      app = undefined;
    }

    if (cleanupErrors.length) {
      console.warn('link-bulk-conversion cleanup warnings', cleanupErrors);
    }
  });

  test(
    'converts 2k text cells into links referencing national agencies',
    async () => {
      const nationalBase = await createBase({
        spaceId,
        name: `National Agencies-${getRandomString(6)}`,
      });
      nationalBaseId = nationalBase.id;

      nationalTable = await createTable(nationalBaseId, {
        name: 'National Agencies Directory',
        fields: [
          { name: 'Agency Code', type: FieldType.SingleLineText },
          { name: 'Agency Name', type: FieldType.SingleLineText },
        ],
        records: AGENCY_CODES.map(({ code, name }) => ({
          fields: {
            'Agency Code': code,
            'Agency Name': name,
          },
        })),
      });

      const codeFieldId = nationalTable.fields[0].id;

      const recordIdToCode = new Map<string, string>();
      nationalTable.records?.forEach((record) => {
        const code = record.fields[codeFieldId] as string;
        recordIdToCode.set(record.id, code);
      });

      const dataBase = await createBase({
        spaceId,
        name: `Bulk Dataset-${getRandomString(6)}`,
      });
      dataBaseId = dataBase.id;

      dataTable = await createTable(dataBaseId, {
        name: 'Trade Records',
        fields: [
          { name: 'Record Title', type: FieldType.SingleLineText },
          { name: 'Agency Code Text', type: FieldType.SingleLineText },
        ],
      });

      const primaryFieldId = dataTable.fields[0].id;
      const textFieldId = dataTable.fields[1].id;

      const codes = AGENCY_CODES.map((agency) => agency.code);
      const cycleLength = codes.length;

      const getCodeForIndex = (index: number) => {
        const rotation = Math.floor(index / cycleLength) % cycleLength;
        const position = index % cycleLength;
        return codes[(position + rotation) % cycleLength];
      };

      const payload = Array.from({ length: TOTAL_RECORDS }, (_, index) => {
        const code = getCodeForIndex(index);
        return {
          fields: {
            [primaryFieldId]: `Record-${index + 1}`,
            [textFieldId]: code,
          },
        };
      });

      console.time('create-records');
      const created = await createRecords(dataTable.id, {
        fieldKeyType: FieldKeyType.Id,
        records: payload,
      });
      console.timeEnd('create-records');

      expect(created.records.length).toBe(TOTAL_RECORDS);

      const expectedCodeByRecord = new Map<string, string>();
      created.records.forEach((record, index) => {
        expectedCodeByRecord.set(record.id, getCodeForIndex(index));
      });

      console.time('convert-to-link');
      const convertedField = await convertField(dataTable.id, textFieldId, {
        type: FieldType.Link,
        options: {
          baseId: nationalBaseId,
          relationship: Relationship.ManyOne,
          foreignTableId: nationalTable.id,
          lookupFieldId: codeFieldId,
        },
      });
      console.timeEnd('convert-to-link');

      expect(convertedField.type).toBe(FieldType.Link);
      expect(convertedField.options).toMatchObject({
        relationship: Relationship.ManyOne,
        foreignTableId: nationalTable.id,
        lookupFieldId: codeFieldId,
      });

      const { records: nationalRecordsAfter } = await getRecords(nationalTable.id, {
        fieldKeyType: FieldKeyType.Id,
        take: 200,
      });
      recordIdToCode.clear();
      nationalRecordsAfter.forEach((record) => {
        const code = record.fields[codeFieldId] as string | undefined;
        if (code) {
          recordIdToCode.set(record.id, code);
        }
      });

      const verifyLinkedRecords = async (relationship: Relationship) => {
        console.time(`verify-links-${relationship}`);
        const matchedRecords = new Map<string, (typeof created.records)[number]>();
        for (let skip = 0; matchedRecords.size < TOTAL_RECORDS; skip += PAGE_SIZE) {
          const { records } = await getRecords(dataTable!.id, {
            fieldKeyType: FieldKeyType.Id,
            take: PAGE_SIZE,
            skip,
          });
          for (const record of records) {
            if (expectedCodeByRecord.has(record.id)) {
              matchedRecords.set(record.id, record);
            }
          }
          if (!records.length) {
            break;
          }
        }
        console.timeEnd(`verify-links-${relationship}`);

        const occurrencesByCode = new Map<string, number>();
        AGENCY_CODES.forEach(({ code }) => occurrencesByCode.set(code, 0));

        expect(matchedRecords.size).toBe(TOTAL_RECORDS);

        matchedRecords.forEach((record) => {
          const expectedCode = expectedCodeByRecord.get(record.id);
          const linkCellRaw = record.fields[textFieldId] as
            | { id: string; title?: string }
            | Array<{ id: string; title?: string }>
            | null;

          expect(expectedCode).toBeDefined();
          expect(linkCellRaw, `record ${record.id} should have linked cell value`).toBeTruthy();

          const linkEntries = Array.isArray(linkCellRaw) ? linkCellRaw : [linkCellRaw!];
          expect(linkEntries.length).toBeGreaterThanOrEqual(1);

          linkEntries.forEach((entry) => {
            const linkedId = entry.id;
            expect(recordIdToCode.has(linkedId)).toBe(true);
            const linkedCode = recordIdToCode.get(linkedId)!;

            expect(linkedCode).toBe(expectedCode);
            occurrencesByCode.set(linkedCode, (occurrencesByCode.get(linkedCode) ?? 0) + 1);
          });
        });

        occurrencesByCode.forEach((count, code) => {
          expect(count).toBe(TOTAL_RECORDS / AGENCY_CODES.length);
        });
      };

      await verifyLinkedRecords(Relationship.ManyOne);

      console.time('convert-to-manymany');
      const multiLinkField = await convertField(dataTable.id, textFieldId, {
        type: FieldType.Link,
        options: {
          baseId: nationalBaseId,
          relationship: Relationship.ManyMany,
          foreignTableId: nationalTable.id,
          lookupFieldId: codeFieldId,
        },
      });
      console.timeEnd('convert-to-manymany');

      expect(multiLinkField.type).toBe(FieldType.Link);
      expect(multiLinkField.options).toMatchObject({
        relationship: Relationship.ManyMany,
        foreignTableId: nationalTable.id,
        lookupFieldId: codeFieldId,
      });

      await verifyLinkedRecords(Relationship.ManyMany);
    },
    { timeout: 300_000 }
  );
});
