/* eslint-disable sonarjs/no-duplicate-string */
import type { INestApplication } from '@nestjs/common';
import { FieldKeyType, FieldType } from '@teable/core';
import { SettingKey, upsertRecords, updateSetting, type ITableFullVo } from '@teable/openapi';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { CanaryService } from '../src/features/canary';

import { getError } from './utils/get-error';
import { createTable, getRecords, initApp } from './utils/init-app';

describe('Record upsert (e2e)', () => {
  let app: INestApplication;

  const spaceId = globalThis.testConfig.spaceId;
  const baseId = globalThis.testConfig.baseId;
  const enableV2 = () =>
    updateSetting({
      [SettingKey.CANARY_CONFIG]: {
        enabled: true,
        forceV2All: true,
        spaceIds: [spaceId],
      },
    });

  const disableV2 = () =>
    updateSetting({
      [SettingKey.CANARY_CONFIG]: {
        enabled: false,
        forceV2All: false,
        spaceIds: [],
      },
    });

  beforeAll(async () => {
    const appCtx = await initApp();
    app = appCtx.app;
    process.env.ENABLE_CANARY_FEATURE = 'true';
  });

  afterAll(async () => {
    await disableV2();
    await app.close();
  });

  const createUpsertTable = async (name: string): Promise<ITableFullVo> =>
    createTable(baseId, {
      name,
      records: [],
      fields: [
        { type: FieldType.SingleLineText, name: 'Key', unique: true },
        { type: FieldType.SingleLineText, name: 'Title' },
        { type: FieldType.Number, name: 'Amount' },
      ],
    });

  const fieldsOf = (table: ITableFullVo) => ({
    key: table.fields.find((field) => field.name === 'Key')!,
    title: table.fields.find((field) => field.name === 'Title')!,
    amount: table.fields.find((field) => field.name === 'Amount')!,
  });

  beforeEach(async () => {
    await enableV2();
  });

  afterEach(async () => {
    await disableV2();
  });

  it('creates once and skips the same 100 keys on replay', async () => {
    const table = await createUpsertTable('upsert-replay');
    const { key, title } = fieldsOf(table);

    const records = Array.from({ length: 100 }, (_, index) => ({
      fields: {
        [key.id]: `key-${index}`,
        [title.id]: `title-${index}`,
      },
    }));

    const first = await upsertRecords(table.id, {
      matchField: key.id,
      onConflict: 'ignore',
      fieldKeyType: FieldKeyType.Id,
      records,
    });
    expect(first.data.summary).toEqual({
      requested: 100,
      created: 100,
      updated: 0,
      unchanged: 0,
      skipped: 0,
    });

    const second = await upsertRecords(table.id, {
      matchField: key.id,
      onConflict: 'ignore',
      fieldKeyType: FieldKeyType.Id,
      records,
    });
    expect(second.data.summary).toEqual({
      requested: 100,
      created: 0,
      updated: 0,
      unchanged: 0,
      skipped: 100,
    });
    expect(second.data.results.every((row) => row.status === 'skipped')).toBe(true);

    const persisted = await getRecords(table.id, {
      fieldKeyType: FieldKeyType.Id,
      take: 200,
    });
    expect(persisted.records).toHaveLength(100);
  });

  it('update mode changes only the provided fields', async () => {
    const table = await createUpsertTable('upsert-update');
    const { key, title, amount } = fieldsOf(table);

    await upsertRecords(table.id, {
      matchField: key.id,
      onConflict: 'ignore',
      fieldKeyType: FieldKeyType.Id,
      records: [{ fields: { [key.id]: 'k1', [title.id]: 'original', [amount.id]: 1 } }],
    });

    const updated = await upsertRecords(table.id, {
      matchField: key.id,
      onConflict: 'update',
      fieldKeyType: FieldKeyType.Id,
      records: [{ fields: { [key.id]: 'k1', [amount.id]: 42 } }],
    });
    expect(updated.data.results[0]?.status).toBe('updated');

    const persisted = await getRecords(table.id, {
      fieldKeyType: FieldKeyType.Id,
      take: 10,
    });
    const row = persisted.records.find((record) => record.fields[key.id] === 'k1');
    expect(row?.fields[amount.id]).toBe(42);
    expect(row?.fields[title.id]).toBe('original');

    const unchanged = await upsertRecords(table.id, {
      matchField: key.id,
      onConflict: 'update',
      fieldKeyType: FieldKeyType.Id,
      records: [{ fields: { [key.id]: 'k1', [amount.id]: 42 } }],
    });
    expect(unchanged.data.results[0]?.status).toBe('unchanged');
  });

  it('returns record fields keyed by field name when fieldKeyType is name', async () => {
    const table = await createUpsertTable('upsert-field-keys');
    const { key } = fieldsOf(table);

    const result = await upsertRecords(table.id, {
      matchField: key.id,
      onConflict: 'ignore',
      fieldKeyType: FieldKeyType.Name,
      records: [{ fields: { Key: 'k1', Title: 'Named' } }],
    });

    expect(result.data.results[0]?.status).toBe('created');
    expect(result.data.results[0]?.record?.fields).toMatchObject({ Key: 'k1', Title: 'Named' });
  });

  it('rejects the whole batch in error mode when one key exists', async () => {
    const table = await createUpsertTable('upsert-error-mode');
    const { key, title } = fieldsOf(table);

    await upsertRecords(table.id, {
      matchField: key.id,
      onConflict: 'ignore',
      fieldKeyType: FieldKeyType.Id,
      records: [{ fields: { [key.id]: 'k1', [title.id]: 'Old' } }],
    });

    const error = await getError(() =>
      upsertRecords(table.id, {
        matchField: key.id,
        onConflict: 'error',
        fieldKeyType: FieldKeyType.Id,
        records: [
          { fields: { [key.id]: 'k1', [title.id]: 'Changed' } },
          { fields: { [key.id]: 'k2', [title.id]: 'New' } },
        ],
      })
    );

    expect(error?.status).toBeGreaterThanOrEqual(400);
    expect(error?.status).toBeLessThan(500);
    const body = (error?.data ?? {}) as { code?: string; domainCode?: string };
    expect(body.domainCode ?? body.code).toBe('record.upsert.conflict');

    const rows = await getRecords(table.id, { fieldKeyType: FieldKeyType.Id, take: 10 });
    expect(rows.records).toHaveLength(1);
    expect(rows.records[0]?.fields[title.id]).toBe('Old');
  });

  it('coerces values with typecast and rejects them without it', async () => {
    const table = await createUpsertTable('upsert-typecast');
    const { key, amount } = fieldsOf(table);

    const coerced = await upsertRecords(table.id, {
      matchField: key.id,
      onConflict: 'ignore',
      fieldKeyType: FieldKeyType.Id,
      typecast: true,
      records: [{ fields: { [key.id]: 'k1', [amount.id]: '42' } }],
    });
    expect(coerced.data.results[0]?.status).toBe('created');
    const stored = await getRecords(table.id, { fieldKeyType: FieldKeyType.Id, take: 10 });
    expect(stored.records[0]?.fields[amount.id]).toBe(42);

    const error = await getError(() =>
      upsertRecords(table.id, {
        matchField: key.id,
        onConflict: 'ignore',
        fieldKeyType: FieldKeyType.Id,
        records: [{ fields: { [key.id]: 'k2', [amount.id]: 'not-a-number' } }],
      })
    );
    expect(error?.status).toBeGreaterThanOrEqual(400);
    expect(error?.status).toBeLessThan(500);
    const after = await getRecords(table.id, { fieldKeyType: FieldKeyType.Id, take: 10 });
    expect(after.records).toHaveLength(1);
  });

  it('rejects upsert when the space is not on the v2 engine', async () => {
    const table = await createUpsertTable('upsert-v1-space');
    const { key } = fieldsOf(table);
    await disableV2();

    // The e2e harness forces v2 through env, so force the canary answer directly.
    const canary = app.get(CanaryService);
    const spy = vi
      .spyOn(canary, 'shouldUseV2ForBaseWithReason')
      .mockResolvedValue({ useV2: false, reason: 'feature_not_enabled' });
    try {
      const error = await getError(() =>
        upsertRecords(table.id, {
          matchField: key.id,
          onConflict: 'ignore',
          fieldKeyType: FieldKeyType.Id,
          records: [{ fields: { [key.id]: 'k1' } }],
        })
      );

      expect(error?.status).toBe(400);
      // v2 errors reach HTTP as validation_error with the domain code alongside.
      const body = (error?.data ?? {}) as { code?: string; domainCode?: string };
      expect(body.domainCode ?? body.code).toBe('record.upsert.v2_required');
    } finally {
      spy.mockRestore();
    }
    const persisted = await getRecords(table.id, { fieldKeyType: FieldKeyType.Id, take: 10 });
    expect(persisted.records).toHaveLength(0);
  });
});
