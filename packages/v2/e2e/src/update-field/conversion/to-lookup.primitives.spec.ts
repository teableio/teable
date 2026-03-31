/**
 * Consolidated E2E tests for converting primitive fields to lookup.
 *
 * These cases used to live in many 2-test files. Keeping them together
 * reduces repeated file-level setup while preserving the same behavior.
 */
/* eslint-disable @typescript-eslint/naming-convention */
import { afterAll, beforeAll, describe, expect, test } from 'vitest';

import { getSharedTestContext, type SharedTestContext } from '../../shared/globalTestContext';
import {
  ensureAttachmentTables,
  makeAttachmentCell,
  seedAttachment,
  type SeededAttachment,
} from '../attachment/testUtils';

type SourceCase = {
  label: string;
  buildField: (fieldId: string, name: string, attachmentSeed: SeededAttachment) => unknown;
  sampleValue: (attachmentSeed: SeededAttachment) => unknown;
};

describe('update-field: primitive → lookup conversion', () => {
  let ctx: SharedTestContext;
  let hostTableId: string;
  let foreignTableId: string;
  let hostPrimaryFieldId: string;
  let foreignPrimaryFieldId: string;
  let linkFieldId: string;
  let attachmentSeed: SeededAttachment;
  let fieldIdCounter = 0;

  const createFieldId = () => {
    const suffix = fieldIdCounter.toString(36).padStart(16, '0');
    fieldIdCounter += 1;
    return `fld${suffix}`;
  };

  const createSourceField = async (sourceCase: SourceCase, name: string) => {
    const fieldId = createFieldId();
    await ctx.createField({
      baseId: ctx.baseId,
      tableId: hostTableId,
      field: sourceCase.buildField(fieldId, name, attachmentSeed),
    });
    return fieldId;
  };

  const sourceCases: SourceCase[] = [
    {
      label: 'attachment',
      buildField: (fieldId, name) => ({
        type: 'attachment',
        id: fieldId,
        name,
      }),
      sampleValue: (seed) => makeAttachmentCell(seed, 'a.txt'),
    },
    {
      label: 'checkbox',
      buildField: (fieldId, name) => ({
        type: 'checkbox',
        id: fieldId,
        name,
      }),
      sampleValue: () => true,
    },
    {
      label: 'date',
      buildField: (fieldId, name) => ({
        type: 'date',
        id: fieldId,
        name,
        options: {
          formatting: {
            date: 'YYYY-MM-DD',
            time: 'HH:mm',
            timeZone: 'utc',
          },
        },
      }),
      sampleValue: () => '2024-01-15T10:30:00.000Z',
    },
    {
      label: 'longText',
      buildField: (fieldId, name) => ({
        type: 'longText',
        id: fieldId,
        name,
      }),
      sampleValue: () => 'legacy text',
    },
    {
      label: 'multipleSelect',
      buildField: (fieldId, name) => ({
        type: 'multipleSelect',
        id: fieldId,
        name,
        options: {
          choices: [
            { id: 'cho1', name: 'Option 1', color: 'red' },
            { id: 'cho2', name: 'Option 2', color: 'blue' },
          ],
        },
      }),
      sampleValue: () => ['Option 1'],
    },
    {
      label: 'number',
      buildField: (fieldId, name) => ({
        type: 'number',
        id: fieldId,
        name,
      }),
      sampleValue: () => 123,
    },
    {
      label: 'rating',
      buildField: (fieldId, name) => ({
        type: 'rating',
        id: fieldId,
        name,
      }),
      sampleValue: () => 5,
    },
    {
      label: 'singleSelect',
      buildField: (fieldId, name) => ({
        type: 'singleSelect',
        id: fieldId,
        name,
        options: {
          choices: [
            { id: 'cho1', name: 'Option 1', color: 'red' },
            { id: 'cho2', name: 'Option 2', color: 'blue' },
          ],
        },
      }),
      sampleValue: () => 'Option 1',
    },
  ];

  beforeAll(async () => {
    ctx = await getSharedTestContext();
    await ensureAttachmentTables(ctx);
    attachmentSeed = await seedAttachment(ctx);

    const hostTable = await ctx.createTable({
      baseId: ctx.baseId,
      name: 'Primitive to Lookup Host',
      fields: [{ type: 'singleLineText', name: 'Host Name', isPrimary: true }],
    });
    hostTableId = hostTable.id;
    const hostPrimary = hostTable.fields.find((f) => f.isPrimary);
    if (!hostPrimary) throw new Error('No host primary field');
    hostPrimaryFieldId = hostPrimary.id;

    const foreignTable = await ctx.createTable({
      baseId: ctx.baseId,
      name: 'Primitive to Lookup Foreign',
      fields: [{ type: 'singleLineText', name: 'Company Name', isPrimary: true }],
    });
    foreignTableId = foreignTable.id;
    const foreignPrimary = foreignTable.fields.find((f) => f.isPrimary);
    if (!foreignPrimary) throw new Error('No foreign primary field');
    foreignPrimaryFieldId = foreignPrimary.id;

    const withLink = await ctx.createField({
      baseId: ctx.baseId,
      tableId: hostTableId,
      field: {
        type: 'link',
        id: createFieldId(),
        name: 'Company Link',
        options: {
          relationship: 'manyMany',
          foreignTableId,
          lookupFieldId: foreignPrimaryFieldId,
          isOneWay: true,
        },
      },
    });
    const linkField = withLink.fields.find((f) => f.name === 'Company Link');
    if (!linkField) throw new Error('No link field');
    linkFieldId = linkField.id;
  });

  afterAll(async () => {
    try {
      if (hostTableId) await ctx.deleteTable(hostTableId);
    } catch {
      // Ignore cleanup errors
    }
    try {
      if (foreignTableId) await ctx.deleteTable(foreignTableId);
    } catch {
      // Ignore cleanup errors
    }
  });

  for (const sourceCase of sourceCases) {
    describe(`${sourceCase.label} → lookup conversion`, () => {
      test(`converts ${sourceCase.label} to lookup and recomputes from linked records`, async () => {
        const foreignRecord = await ctx.createRecord(foreignTableId, {
          [foreignPrimaryFieldId]: 'Acme Inc',
        });

        const fieldId = await createSourceField(sourceCase, `${sourceCase.label} Field`);
        const hostRecord = await ctx.createRecord(hostTableId, {
          [hostPrimaryFieldId]: 'Host A',
          [linkFieldId]: [{ id: foreignRecord.id }],
          [fieldId]: sourceCase.sampleValue(attachmentSeed),
        });
        await ctx.drainOutbox();

        const updatedTable = await ctx.updateField({
          tableId: hostTableId,
          fieldId,
          field: {
            type: 'lookup',
            options: {
              linkFieldId,
              foreignTableId,
              lookupFieldId: foreignPrimaryFieldId,
            },
          },
        });
        await ctx.drainOutbox();

        const updatedField = updatedTable.fields.find((f) => f.id === fieldId) as
          | {
              isLookup?: boolean;
              lookupOptions?: {
                linkFieldId: string;
                foreignTableId: string;
                lookupFieldId: string;
              };
            }
          | undefined;
        expect(updatedField?.isLookup).toBe(true);
        expect(updatedField?.lookupOptions).toMatchObject({
          linkFieldId,
          foreignTableId,
          lookupFieldId: foreignPrimaryFieldId,
        });

        const records = await ctx.listRecordsWithoutDrain(hostTableId);
        const record = records.find((r) => r.id === hostRecord.id);
        expect(record?.fields[fieldId]).toEqual(['Acme Inc']);

        await ctx.deleteField({ tableId: hostTableId, fieldId });
        await ctx.deleteRecords(hostTableId, [hostRecord.id]);
        await ctx.deleteRecords(foreignTableId, [foreignRecord.id]);
      });

      test(`handles null values for ${sourceCase.label}`, async () => {
        const fieldId = await createSourceField(sourceCase, `Null ${sourceCase.label} Field`);
        const hostRecord = await ctx.createRecord(hostTableId, {
          [hostPrimaryFieldId]: 'No value',
        });

        await ctx.updateField({
          tableId: hostTableId,
          fieldId,
          field: {
            type: 'lookup',
            options: {
              linkFieldId,
              foreignTableId,
              lookupFieldId: foreignPrimaryFieldId,
            },
          },
        });
        await ctx.drainOutbox();

        const records = await ctx.listRecordsWithoutDrain(hostTableId);
        const record = records.find((r) => r.id === hostRecord.id);
        const value = record?.fields[fieldId];
        expect(value == null || (Array.isArray(value) && value.length === 0)).toBe(true);

        await ctx.deleteField({ tableId: hostTableId, fieldId });
        await ctx.deleteRecords(hostTableId, [hostRecord.id]);
      });
    });
  }
});
