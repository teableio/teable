/* eslint-disable @typescript-eslint/naming-convention */
import { createBaseOkResponseSchema } from '@teable/v2-contract-http';
import { beforeAll, describe, expect, it } from 'vitest';
import { getSharedTestContext, type SharedTestContext } from '../../../shared/globalTestContext';

const AGENCY_CODES = ['US', 'BR', 'TW', 'CN', 'JP', 'DE', 'FR', 'IN', 'AU', 'ZA'] as const;

describe('update-field: link conversion cross-base bulk', () => {
  let ctx: SharedTestContext;
  let nameCounter = 0;

  const nextName = (prefix: string) => `${prefix}-${nameCounter++}`;

  const createBase = async (name: string) => {
    const response = await fetch(`${ctx.baseUrl}/bases/create`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name, spaceId: 'space_test' }),
    });
    const rawBody = await response.json();
    if (response.status !== 201) {
      throw new Error(`CreateBase failed: ${JSON.stringify(rawBody)}`);
    }
    const parsed = createBaseOkResponseSchema.safeParse(rawBody);
    if (!parsed.success || !parsed.data.ok) {
      throw new Error(`CreateBase parse failed: ${JSON.stringify(rawBody)}`);
    }
    return parsed.data.data.base.id;
  };

  const deleteTableWithBaseId = async (baseId: string, tableId: string) => {
    const response = await fetch(`${ctx.baseUrl}/tables/delete`, {
      method: 'DELETE',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ baseId, tableId, mode: 'permanent' }),
    });
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Failed to delete table ${tableId} in base ${baseId}: ${errorText}`);
    }
  };

  beforeAll(async () => {
    ctx = await getSharedTestContext();
  });

  it(
    'converts 2k text cells into links referencing national agencies',
    { timeout: 300_000 },
    async () => {
      let hostTableId: string | undefined;
      let foreignBaseId: string | undefined;
      let foreignTableId: string | undefined;

      try {
        const createdForeignBaseId = await createBase(nextName('v1p-cross-base-foreign'));
        foreignBaseId = createdForeignBaseId;

        const foreignTable = await ctx.createTable({
          baseId: createdForeignBaseId,
          name: nextName('v1p-cross-base-agencies'),
          fields: [{ type: 'singleLineText', name: 'Agency Code', isPrimary: true }],
        });
        foreignTableId = foreignTable.id;
        const foreignPrimaryFieldId = foreignTable.fields.find((field) => field.isPrimary)?.id;
        if (!foreignPrimaryFieldId) {
          throw new Error('Failed to resolve foreign primary field id');
        }

        const codeRecordMap = new Map<string, string>();
        for (const code of AGENCY_CODES) {
          const record = await ctx.createRecord(foreignTable.id, {
            [foreignPrimaryFieldId]: code,
          });
          codeRecordMap.set(code, record.id);
        }

        const hostTable = await ctx.createTable({
          baseId: ctx.baseId,
          name: nextName('v1p-cross-base-host'),
          fields: [
            { type: 'singleLineText', name: 'Name', isPrimary: true },
            { type: 'singleLineText', name: 'Agency Code Text' },
          ],
        });
        hostTableId = hostTable.id;

        const hostPrimaryFieldId = hostTable.fields.find((field) => field.isPrimary)?.id;
        const sourceFieldId = hostTable.fields.find(
          (field) => field.name === 'Agency Code Text'
        )?.id;
        if (!hostPrimaryFieldId || !sourceFieldId) {
          throw new Error('Failed to resolve host field ids');
        }

        const totalRecords = 2000;
        const expectedCodeByRecordId = new Map<string, string>();
        const payload = Array.from({ length: totalRecords }, (_, index) => {
          const code = AGENCY_CODES[index % AGENCY_CODES.length];
          return {
            fields: {
              [hostPrimaryFieldId]: `Record-${index + 1}`,
              [sourceFieldId]: code,
            },
          };
        });

        const created = await ctx.createRecords(hostTable.id, payload);
        created.forEach((record, index) => {
          expectedCodeByRecordId.set(record.id, AGENCY_CODES[index % AGENCY_CODES.length]);
        });

        await ctx.updateField({
          tableId: hostTable.id,
          fieldId: sourceFieldId,
          field: {
            type: 'link',
            options: {
              baseId: foreignBaseId,
              relationship: 'manyOne',
              foreignTableId: foreignTable.id,
              lookupFieldId: foreignPrimaryFieldId,
              isOneWay: true,
            },
          },
        });

        await ctx.drainOutbox();

        const matched = new Map<string, { id: string; fields: Record<string, unknown> }>();
        for (let offset = 0; matched.size < totalRecords; offset += 500) {
          const rows = await ctx.listRecords(hostTable.id, { offset, limit: 500 });
          if (!rows.length) break;
          for (const row of rows) {
            if (expectedCodeByRecordId.has(row.id)) {
              matched.set(row.id, row);
            }
          }
        }

        expect(matched.size).toBe(totalRecords);

        matched.forEach((row, recordId) => {
          const expectedCode = expectedCodeByRecordId.get(recordId);
          if (!expectedCode) throw new Error(`Missing expected code for record ${recordId}`);
          const expectedForeignRecordId = codeRecordMap.get(expectedCode);
          if (!expectedForeignRecordId) {
            throw new Error(`Missing foreign record id for code ${expectedCode}`);
          }

          const raw = row.fields[sourceFieldId] as
            | { id: string; title?: string }
            | Array<{ id: string; title?: string }>
            | null
            | undefined;
          const links = Array.isArray(raw) ? raw : raw ? [raw] : [];
          expect(links).toHaveLength(1);
          expect(links[0]?.id).toBe(expectedForeignRecordId);
          expect(links[0]?.title).toBe(expectedCode);
        });
      } finally {
        if (hostTableId) {
          await ctx.deleteTable(hostTableId).catch(() => undefined);
        }
        if (foreignBaseId && foreignTableId) {
          await deleteTableWithBaseId(foreignBaseId, foreignTableId).catch(() => undefined);
        }
      }
    }
  );
});
