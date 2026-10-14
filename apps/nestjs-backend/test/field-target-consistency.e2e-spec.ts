import type { INestApplication } from '@nestjs/common';
import type { IFieldRo } from '@teable/core';
import { FieldType, Relationship } from '@teable/core';
import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import {
  createField,
  createTable,
  getFields,
  initApp,
  permanentDeleteTable,
} from './utils/init-app';

describe('OpenAPI linked source target validation (e2e)', () => {
  let app: INestApplication;
  const baseId = globalThis.testConfig.baseId;
  let sourceTableId: string;
  let wrongTargetTableId: string;
  let hostTableId: string;
  let linkFieldId: string;
  let sourceAmountFieldId: string;
  let wrongTargetAmountFieldId: string;

  beforeAll(async () => {
    app = (await initApp()).app;

    const source = await createTable(baseId, {
      name: 't7751-source',
      fields: [
        { name: 'Label', type: FieldType.SingleLineText },
        { name: 'Amount', type: FieldType.Number },
      ],
    });
    sourceTableId = source.id;
    sourceAmountFieldId = source.fields.find((field) => field.name === 'Amount')!.id;
    const sourcePrimaryFieldId = source.fields.find((field) => field.isPrimary)!.id;

    const wrongTarget = await createTable(baseId, {
      name: 't7751-wrong-target',
      fields: [
        { name: 'Label', type: FieldType.SingleLineText },
        { name: 'Amount', type: FieldType.Number },
      ],
    });
    wrongTargetTableId = wrongTarget.id;
    wrongTargetAmountFieldId = wrongTarget.fields.find((field) => field.name === 'Amount')!.id;

    const host = await createTable(baseId, {
      name: 't7751-host',
      fields: [{ name: 'Label', type: FieldType.SingleLineText }],
    });
    hostTableId = host.id;

    const link = await createField(hostTableId, {
      name: 'Source links',
      type: FieldType.Link,
      options: {
        relationship: Relationship.ManyMany,
        foreignTableId: sourceTableId,
        lookupFieldId: sourcePrimaryFieldId,
      },
    });
    linkFieldId = link.id;
  });

  afterAll(async () => {
    try {
      if (hostTableId) await permanentDeleteTable(baseId, hostTableId, 200);
      if (wrongTargetTableId) await permanentDeleteTable(baseId, wrongTargetTableId, 200);
      if (sourceTableId) await permanentDeleteTable(baseId, sourceTableId, 200);
    } finally {
      await app.close();
    }
  });

  it('rejects wrong lookup source and target for legacy OpenAPI payloads', async () => {
    const invalidRollupSource: IFieldRo = {
      name: 'Wrong source total',
      type: FieldType.Rollup,
      options: { expression: 'sum({values})' },
      lookupOptions: {
        linkFieldId,
        foreignTableId: sourceTableId,
        lookupFieldId: wrongTargetAmountFieldId,
      },
    } as IFieldRo;
    const invalidRollupTarget: IFieldRo = {
      name: 'Wrong target total',
      type: FieldType.Rollup,
      options: { expression: 'sum({values})' },
      lookupOptions: {
        linkFieldId,
        foreignTableId: wrongTargetTableId,
        lookupFieldId: wrongTargetAmountFieldId,
      },
    } as IFieldRo;
    const invalidLookupSource: IFieldRo = {
      name: 'Wrong source lookup',
      type: FieldType.SingleLineText,
      isLookup: true,
      lookupOptions: {
        linkFieldId,
        foreignTableId: sourceTableId,
        lookupFieldId: wrongTargetAmountFieldId,
      },
    } as IFieldRo;

    await createField(hostTableId, invalidRollupSource, 400);
    await createField(hostTableId, invalidRollupTarget, 400);
    await createField(hostTableId, invalidLookupSource, 400);

    const fields = await getFields(hostTableId);
    expect(fields.some((field) => field.name === 'Wrong source total')).toBe(false);
    expect(fields.some((field) => field.name === 'Wrong target total')).toBe(false);
    expect(fields.some((field) => field.name === 'Wrong source lookup')).toBe(false);
  });

  it('accepts a valid legacy rollup target', async () => {
    const created = await createField(hostTableId, {
      name: 'Valid total',
      type: FieldType.Rollup,
      options: { expression: 'sum({values})' },
      lookupOptions: {
        linkFieldId,
        foreignTableId: sourceTableId,
        lookupFieldId: sourceAmountFieldId,
      },
    });

    expect(created.name).toBe('Valid total');
  });
});
