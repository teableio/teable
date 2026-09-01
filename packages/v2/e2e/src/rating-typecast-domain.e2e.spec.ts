/* eslint-disable @typescript-eslint/naming-convention */
import {
  createRecordOkResponseSchema,
  getRecordByIdOkResponseSchema,
  updateRecordOkResponseSchema,
} from '@teable/v2-contract-http';
import { FieldKeyType } from '@teable/v2-core';
import { beforeAll, describe, expect, it } from 'vitest';
import { getSharedTestContext, type SharedTestContext } from './shared/globalTestContext';

/**
 * T6515: rating typecast must only persist values in {null} ∪ {1..max}.
 *
 * Assertions intentionally re-read via getRecordById. Create/update response
 * bodies can echo request values and are not proof of storage.
 */
describe('v2 rating typecast domain (e2e)', () => {
  let ctx: SharedTestContext;
  let tableId: string;
  let titleFieldId: string;
  let ratingFieldId: string;

  beforeAll(async () => {
    ctx = await getSharedTestContext();

    const table = await ctx.createTable({
      baseId: ctx.baseId,
      name: `rating-typecast-${Date.now()}`,
      fields: [
        { type: 'singleLineText', name: 'Title', isPrimary: true },
        { type: 'rating', name: 'Score', options: { max: 5, icon: 'star', color: 'yellowBright' } },
      ],
      views: [{ type: 'grid' }],
    });

    tableId = table.id;
    titleFieldId = table.fields.find((field) => field.name === 'Title')?.id ?? '';
    ratingFieldId = table.fields.find((field) => field.name === 'Score')?.id ?? '';

    if (!titleFieldId || !ratingFieldId) {
      throw new Error('Failed to resolve rating typecast fixture fields');
    }
  }, 30000);

  const getStoredRating = async (recordId: string): Promise<unknown> => {
    const params = new URLSearchParams({ tableId, recordId });
    const response = await fetch(`${ctx.baseUrl}/tables/getRecord?${params.toString()}`, {
      method: 'GET',
    });
    const raw = await response.json();
    expect(response.status).toBe(200);
    const parsed = getRecordByIdOkResponseSchema.safeParse(raw);
    expect(parsed.success).toBe(true);
    if (!parsed.success || !parsed.data.ok) {
      throw new Error(`getRecord failed: ${JSON.stringify(raw)}`);
    }
    return parsed.data.data.record.fields[ratingFieldId];
  };

  const createWithTypecast = async (input: unknown, label: string) => {
    const response = await fetch(`${ctx.baseUrl}/tables/createRecord`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        tableId,
        typecast: true,
        fieldKeyType: FieldKeyType.Id,
        fields: {
          [titleFieldId]: label,
          [ratingFieldId]: input,
        },
      }),
    });
    const raw = await response.json();
    expect(response.status).toBe(201);
    const parsed = createRecordOkResponseSchema.safeParse(raw);
    expect(parsed.success).toBe(true);
    if (!parsed.success || !parsed.data.ok) {
      throw new Error(`createRecord failed: ${JSON.stringify(raw)}`);
    }
    return parsed.data.data.record.id;
  };

  const updateWithTypecast = async (recordId: string, input: unknown) => {
    const response = await fetch(`${ctx.baseUrl}/tables/updateRecord`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        tableId,
        recordId,
        typecast: true,
        fieldKeyType: FieldKeyType.Id,
        fields: {
          [ratingFieldId]: input,
        },
      }),
    });
    const raw = await response.json();
    expect(response.status).toBe(200);
    const parsed = updateRecordOkResponseSchema.safeParse(raw);
    expect(parsed.success).toBe(true);
    if (!parsed.success || !parsed.data.ok) {
      throw new Error(`updateRecord failed: ${JSON.stringify(raw)}`);
    }
  };

  const updateStrict = async (recordId: string, input: unknown) => {
    const response = await fetch(`${ctx.baseUrl}/tables/updateRecord`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        tableId,
        recordId,
        typecast: false,
        fieldKeyType: FieldKeyType.Id,
        fields: {
          [ratingFieldId]: input,
        },
      }),
    });
    const raw = await response.json();
    return { status: response.status, raw };
  };

  const cases: Array<{ name: string; input: unknown; expected: number | null }> = [
    { name: 'integer', input: 3, expected: 3 },
    { name: 'fraction-round-up', input: 2.7, expected: 3 },
    { name: 'fraction-round-down', input: 2.4, expected: 2 },
    { name: 'fraction-near-max', input: 4.6, expected: 5 },
    { name: 'above-max', input: 5.5, expected: 5 },
    { name: 'far-above-max', input: 9, expected: 5 },
    { name: 'zero', input: 0, expected: null },
    { name: 'fraction-below-one', input: 0.4, expected: null },
    { name: 'negative', input: -3, expected: null },
    { name: 'string-integer', input: '3', expected: 3 },
    { name: 'string-fraction', input: '2.7', expected: 3 },
    { name: 'string-garbage', input: 'abc', expected: null },
    { name: 'empty-string', input: '', expected: null },
    { name: 'null', input: null, expected: null },
  ];

  it.each(cases)(
    'createRecord typecast stores $name as $expected and allows strict rewrite',
    async ({ input, expected, name }) => {
      const recordId = await createWithTypecast(input, `create-${name}`);
      const stored = await getStoredRating(recordId);
      expect(stored ?? null).toBe(expected);

      // Stored value must always be accepted by the strict path.
      const rewrite = await updateStrict(recordId, stored ?? null);
      expect(rewrite.status).toBe(200);
      const storedAfterStrict = await getStoredRating(recordId);
      expect(storedAfterStrict ?? null).toBe(expected);
    }
  );

  it.each(cases)(
    'updateRecord typecast stores $name as $expected and allows strict rewrite',
    async ({ input, expected, name }) => {
      const recordId = await createWithTypecast(null, `update-${name}`);
      await updateWithTypecast(recordId, input);

      const stored = await getStoredRating(recordId);
      expect(stored ?? null).toBe(expected);

      const rewrite = await updateStrict(recordId, stored ?? null);
      expect(rewrite.status).toBe(200);
      const storedAfterStrict = await getStoredRating(recordId);
      expect(storedAfterStrict ?? null).toBe(expected);
    }
  );

  it('rejects fractional rating without typecast on create', async () => {
    const response = await fetch(`${ctx.baseUrl}/tables/createRecord`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        tableId,
        typecast: false,
        fieldKeyType: FieldKeyType.Id,
        fields: {
          [titleFieldId]: 'strict-reject',
          [ratingFieldId]: 2.7,
        },
      }),
    });
    expect(response.status).toBe(400);
  });
});
