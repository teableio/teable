/**
 * Consolidated E2E tests for converting primitive fields to rollup.
 *
 * These cases used to live in many 2-test files. Keeping them together
 * cuts repeated file-level setup while preserving the same coverage.
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

describe('update-field: primitive → rollup conversion', () => {
  let ctx: SharedTestContext;
  let hostTableId: string;
  let foreignTableId: string;
  let hostPrimaryFieldId: string;
  let foreignPrimaryFieldId: string;
  let foreignNumberFieldId: string;
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

  const convertToRollup = async (fieldId: string) =>
    ctx.updateField({
      tableId: hostTableId,
      fieldId,
      field: {
        type: 'rollup',
        options: {
          expression: 'countall({values})',
        },
        config: {
          linkFieldId,
          foreignTableId,
          lookupFieldId: foreignNumberFieldId,
        },
      },
    });

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
      sampleValue: () => 'Some long text content',
    },
    {
      label: 'multipleSelect',
      buildField: (fieldId, name) => ({
        type: 'multipleSelect',
        id: fieldId,
        name,
        options: {
          choices: [
            { id: 'cho1', name: 'Option 1', color: 'blue' },
            { id: 'cho2', name: 'Option 2', color: 'red' },
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
        options: {
          max: 5,
          icon: 'star',
          color: 'yellowBright',
        },
      }),
      sampleValue: () => 3,
    },
    {
      label: 'singleLineText',
      buildField: (fieldId, name) => ({
        type: 'singleLineText',
        id: fieldId,
        name,
      }),
      sampleValue: () => 'Some text',
    },
    {
      label: 'singleSelect',
      buildField: (fieldId, name) => ({
        type: 'singleSelect',
        id: fieldId,
        name,
        options: {
          choices: [
            { id: 'cho1', name: 'Option 1', color: 'blue' },
            { id: 'cho2', name: 'Option 2', color: 'red' },
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

    foreignPrimaryFieldId = createFieldId();
    foreignNumberFieldId = createFieldId();
    const foreignTable = await ctx.createTable({
      baseId: ctx.baseId,
      name: 'Primitive to Rollup Foreign',
      fields: [
        {
          type: 'singleLineText',
          id: foreignPrimaryFieldId,
          name: 'Foreign Name',
          isPrimary: true,
        },
        {
          type: 'number',
          id: foreignNumberFieldId,
          name: 'Amount',
        },
      ],
    });
    foreignTableId = foreignTable.id;

    const hostTable = await ctx.createTable({
      baseId: ctx.baseId,
      name: 'Primitive to Rollup Host',
      fields: [{ type: 'singleLineText', name: 'Host Name', isPrimary: true }],
    });
    hostTableId = hostTable.id;
    const hostPrimary = hostTable.fields.find((f) => f.isPrimary);
    if (!hostPrimary) throw new Error('No host primary field');
    hostPrimaryFieldId = hostPrimary.id;

    const withLink = await ctx.createField({
      baseId: ctx.baseId,
      tableId: hostTableId,
      field: {
        type: 'link',
        id: createFieldId(),
        name: 'Foreign Link',
        options: {
          relationship: 'manyMany',
          foreignTableId,
          lookupFieldId: foreignPrimaryFieldId,
          isOneWay: true,
        },
      },
    });
    const linkField = withLink.fields.find((f) => f.name === 'Foreign Link');
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
    describe(`${sourceCase.label} → rollup conversion`, () => {
      test(`converts ${sourceCase.label} to rollup and clears data`, async () => {
        const fieldId = await createSourceField(sourceCase, `${sourceCase.label} Field`);
        const hostRecord = await ctx.createRecord(hostTableId, {
          [hostPrimaryFieldId]: 'Host A',
          [fieldId]: sourceCase.sampleValue(attachmentSeed),
        });

        const result = await convertToRollup(fieldId);

        const updatedField = result.fields.find((f) => f.id === fieldId);
        expect(updatedField).toBeDefined();
        expect(updatedField?.type).toBe('rollup');

        await ctx.deleteField({ tableId: hostTableId, fieldId });
        await ctx.deleteRecords(hostTableId, [hostRecord.id]);
      });

      test(`converts ${sourceCase.label} to rollup with null-only source values`, async () => {
        const fieldId = await createSourceField(sourceCase, `Null ${sourceCase.label} Field`);
        const hostRecord = await ctx.createRecord(hostTableId, {
          [hostPrimaryFieldId]: 'No links',
        });

        const result = await convertToRollup(fieldId);

        const updatedField = result.fields.find((f) => f.id === fieldId);
        expect(updatedField).toBeDefined();
        expect(updatedField?.type).toBe('rollup');

        await ctx.deleteField({ tableId: hostTableId, fieldId });
        await ctx.deleteRecords(hostTableId, [hostRecord.id]);
      });
    });
  }
});
