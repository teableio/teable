/**
 * Consolidated E2E tests for converting primitive fields to formula.
 *
 * These cases used to live in many tiny files. Keeping them together
 * reduces repeated file-level setup without changing coverage intent.
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
  supportsSuccessfulConversion: boolean;
  buildField: (fieldId: string, name: string, attachmentSeed: SeededAttachment) => unknown;
  sampleValue: (attachmentSeed: SeededAttachment) => unknown;
};

describe('update-field: primitive → formula conversion', () => {
  let ctx: SharedTestContext;
  let tableId: string;
  let primaryFieldId: string;
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
      tableId,
      field: sourceCase.buildField(fieldId, name, attachmentSeed),
    });
    return fieldId;
  };

  const sourceCases: SourceCase[] = [
    {
      label: 'attachment',
      supportsSuccessfulConversion: false,
      buildField: (fieldId, name) => ({
        type: 'attachment',
        id: fieldId,
        name,
      }),
      sampleValue: (seed) => makeAttachmentCell(seed, 'a.txt'),
    },
    {
      label: 'checkbox',
      supportsSuccessfulConversion: true,
      buildField: (fieldId, name) => ({
        type: 'checkbox',
        id: fieldId,
        name,
      }),
      sampleValue: () => true,
    },
    {
      label: 'date',
      supportsSuccessfulConversion: false,
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
      supportsSuccessfulConversion: true,
      buildField: (fieldId, name) => ({
        type: 'longText',
        id: fieldId,
        name,
      }),
      sampleValue: () => 'Text value',
    },
    {
      label: 'multipleSelect',
      supportsSuccessfulConversion: true,
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
      supportsSuccessfulConversion: false,
      buildField: (fieldId, name) => ({
        type: 'number',
        id: fieldId,
        name,
      }),
      sampleValue: () => 42,
    },
    {
      label: 'rating',
      supportsSuccessfulConversion: true,
      buildField: (fieldId, name) => ({
        type: 'rating',
        id: fieldId,
        name,
      }),
      sampleValue: () => 5,
    },
    {
      label: 'singleLineText',
      supportsSuccessfulConversion: true,
      buildField: (fieldId, name) => ({
        type: 'singleLineText',
        id: fieldId,
        name,
      }),
      sampleValue: () => 'Text value',
    },
    {
      label: 'singleSelect',
      supportsSuccessfulConversion: true,
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

    const table = await ctx.createTable({
      baseId: ctx.baseId,
      name: 'Primitive to Formula Conversion',
      fields: [{ type: 'singleLineText', name: 'Name', isPrimary: true }],
    });
    tableId = table.id;
    const primaryField = table.fields.find((f) => f.isPrimary);
    if (!primaryField) throw new Error('No primary field');
    primaryFieldId = primaryField.id;
  });

  afterAll(async () => {
    if (tableId) {
      try {
        await ctx.deleteTable(tableId);
      } catch {
        // Ignore cleanup errors
      }
    }
  });

  for (const sourceCase of sourceCases) {
    describe(`${sourceCase.label} → formula conversion`, () => {
      test(`rejects missing expression for ${sourceCase.label}`, async () => {
        const fieldId = await createSourceField(sourceCase, `${sourceCase.label} Field`);
        const record = await ctx.createRecord(tableId, {
          [fieldId]: sourceCase.sampleValue(attachmentSeed),
        });

        await expect(
          ctx.updateField({
            tableId,
            fieldId,
            field: {
              type: 'formula',
            },
          })
        ).rejects.toThrow();

        await ctx.deleteField({ tableId, fieldId });
        await ctx.deleteRecords(tableId, [record.id]);
      });

      test(`rejects invalid expression for ${sourceCase.label}`, async () => {
        const fieldId = await createSourceField(sourceCase, `Invalid ${sourceCase.label} Field`);
        const record = await ctx.createRecord(tableId, {
          [primaryFieldId]: `Invalid ${sourceCase.label}`,
        });

        await expect(
          ctx.updateField({
            tableId,
            fieldId,
            field: {
              type: 'formula',
              options: {
                expression: 'INVALID(',
              },
            },
          })
        ).rejects.toThrow();

        await ctx.deleteField({ tableId, fieldId });
        await ctx.deleteRecords(tableId, [record.id]);
      });

      if (sourceCase.supportsSuccessfulConversion) {
        test(`converts ${sourceCase.label} to formula and clears data`, async () => {
          const fieldId = await createSourceField(sourceCase, `${sourceCase.label} Success Field`);
          const record = await ctx.createRecord(tableId, {
            [fieldId]: sourceCase.sampleValue(attachmentSeed),
          });

          await ctx.updateField({
            tableId,
            fieldId,
            field: {
              type: 'formula',
              options: {
                expression: '1 + 1',
              },
            },
          });

          const records = await ctx.listRecordsWithoutDrain(tableId);
          const updatedRecord = records.find((r: { id: string }) => r.id === record.id);
          expect(updatedRecord?.fields[fieldId]).toBe(2);

          await ctx.deleteField({ tableId, fieldId });
          await ctx.deleteRecords(tableId, [record.id]);
        });

        test(`handles null values for ${sourceCase.label}`, async () => {
          const fieldId = await createSourceField(sourceCase, `Null ${sourceCase.label} Field`);
          const record = await ctx.createRecord(tableId, {
            [primaryFieldId]: `Null ${sourceCase.label}`,
          });

          await ctx.updateField({
            tableId,
            fieldId,
            field: {
              type: 'formula',
              options: {
                expression: '1 + 1',
              },
            },
          });

          const records = await ctx.listRecordsWithoutDrain(tableId);
          const updatedRecord = records.find((r: { id: string }) => r.id === record.id);
          expect(updatedRecord?.fields[fieldId]).toBe(2);

          await ctx.deleteField({ tableId, fieldId });
          await ctx.deleteRecords(tableId, [record.id]);
        });
      }
    });
  }
});
