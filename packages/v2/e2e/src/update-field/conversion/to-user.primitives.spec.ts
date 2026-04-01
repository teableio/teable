/**
 * Consolidated E2E tests for converting primitive fields to user.
 *
 * These cases used to live in many 2-test files. Keeping them together
 * reduces repeated file-level setup while preserving the same assertions.
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
  sampleValues: (attachmentSeed: SeededAttachment) => [unknown, unknown];
};

describe('update-field: primitive → user conversion', () => {
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
      buildField: (fieldId, name) => ({
        type: 'attachment',
        id: fieldId,
        name,
      }),
      sampleValues: (seed) => [
        makeAttachmentCell(seed, 'a.txt'),
        makeAttachmentCell(seed, 'b.txt'),
      ],
    },
    {
      label: 'checkbox',
      buildField: (fieldId, name) => ({
        type: 'checkbox',
        id: fieldId,
        name,
      }),
      sampleValues: () => [true, false],
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
      sampleValues: () => ['2024-01-15T10:30:00.000Z', '2024-01-16T00:00:00.000Z'],
    },
    {
      label: 'longText',
      buildField: (fieldId, name) => ({
        type: 'longText',
        id: fieldId,
        name,
      }),
      sampleValues: () => ['random long text value', 'another value'],
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
      sampleValues: () => [['Option 1'], ['Option 2']],
    },
    {
      label: 'number',
      buildField: (fieldId, name) => ({
        type: 'number',
        id: fieldId,
        name,
      }),
      sampleValues: () => [123, 456],
    },
    {
      label: 'rating',
      buildField: (fieldId, name) => ({
        type: 'rating',
        id: fieldId,
        name,
      }),
      sampleValues: () => [5, 3],
    },
    {
      label: 'singleLineText',
      buildField: (fieldId, name) => ({
        type: 'singleLineText',
        id: fieldId,
        name,
      }),
      sampleValues: () => ['some text', 'other text'],
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
      sampleValues: () => ['Option 1', 'Option 2'],
    },
  ];

  beforeAll(async () => {
    ctx = await getSharedTestContext();
    await ensureAttachmentTables(ctx);
    attachmentSeed = await seedAttachment(ctx);

    const table = await ctx.createTable({
      baseId: ctx.baseId,
      name: 'Primitive to User Conversion',
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
    describe(`${sourceCase.label} → user conversion`, () => {
      test(`converts non-null ${sourceCase.label} values to null`, async () => {
        const fieldId = await createSourceField(sourceCase, `${sourceCase.label} Field`);
        const [value1, value2] = sourceCase.sampleValues(attachmentSeed);
        const record1 = await ctx.createRecord(tableId, { [fieldId]: value1 });
        const record2 = await ctx.createRecord(tableId, { [fieldId]: value2 });

        const updatedTable = await ctx.updateField({
          tableId,
          fieldId,
          field: { type: 'user' },
        });

        const updatedField = updatedTable.fields.find((f) => f.id === fieldId);
        expect(updatedField?.type).toBe('user');

        const records = await ctx.listRecordsWithoutDrain(tableId);
        expect(records.find((r) => r.id === record1.id)?.fields[fieldId]).toBeNull();
        expect(records.find((r) => r.id === record2.id)?.fields[fieldId]).toBeNull();

        await ctx.deleteField({ tableId, fieldId });
        await ctx.deleteRecords(tableId, [record1.id, record2.id]);
      });

      test(`keeps null ${sourceCase.label} values as null`, async () => {
        const fieldId = await createSourceField(sourceCase, `Nullable ${sourceCase.label} Field`);
        const record = await ctx.createRecord(tableId, {
          [primaryFieldId]: `No ${sourceCase.label}`,
        });

        await ctx.updateField({
          tableId,
          fieldId,
          field: { type: 'user' },
        });

        const records = await ctx.listRecordsWithoutDrain(tableId);
        expect(records.find((r) => r.id === record.id)?.fields[fieldId]).toBeNull();

        await ctx.deleteField({ tableId, fieldId });
        await ctx.deleteRecords(tableId, [record.id]);
      });
    });
  }
});
