import { createFieldOkResponseSchema } from '@teable/v2-contract-http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { getSharedTestContext, type SharedTestContext } from './shared/globalTestContext';

describe('v2 HTTP createField rollup target consistency (e2e)', () => {
  let ctx: SharedTestContext;
  const tables: string[] = [];

  beforeAll(async () => {
    ctx = await getSharedTestContext();
  });

  afterAll(async () => {
    await Promise.all(tables.map((tableId) => ctx.deleteTable(tableId).catch(() => undefined)));
  });

  it('rejects a rollup whose declared foreign table differs from its link target', async () => {
    const source = await ctx.createTable({
      baseId: ctx.baseId,
      name: 'Rollup source',
      fields: [
        { type: 'singleLineText', name: 'Label', isPrimary: true },
        { type: 'number', name: 'Amount' },
      ],
    });
    tables.push(source.id);
    const sourceAmount = source.fields.find((field) => field.name === 'Amount');
    const sourcePrimary = source.fields.find((field) => field.isPrimary);
    expect(sourceAmount).toBeDefined();
    expect(sourcePrimary).toBeDefined();

    const wrongTarget = await ctx.createTable({
      baseId: ctx.baseId,
      name: 'Rollup wrong target',
      fields: [
        { type: 'singleLineText', name: 'Label', isPrimary: true },
        { type: 'number', name: 'Amount' },
      ],
    });
    tables.push(wrongTarget.id);
    const wrongTargetAmount = wrongTarget.fields.find((field) => field.name === 'Amount');
    expect(wrongTargetAmount).toBeDefined();

    const host = await ctx.createTable({
      baseId: ctx.baseId,
      name: 'Rollup host',
      fields: [{ type: 'singleLineText', name: 'Label', isPrimary: true }],
    });
    tables.push(host.id);

    const link = await ctx.createField({
      baseId: ctx.baseId,
      tableId: host.id,
      field: {
        type: 'link',
        name: 'Source links',
        options: {
          relationship: 'manyMany',
          foreignTableId: source.id,
          lookupFieldId: sourcePrimary!.id,
        },
      },
    });
    const linkField = link.fields.find((field) => field.name === 'Source links');
    expect(linkField).toBeDefined();

    const createFieldRequest = (field: Record<string, unknown>) =>
      fetch(`${ctx.baseUrl}/tables/createField`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ baseId: ctx.baseId, tableId: host.id, field }),
      });

    const wrongLookupRollupFieldId = 'fld0000000007751s';
    const wrongLookupRollupResponse = await createFieldRequest({
      type: 'rollup',
      id: wrongLookupRollupFieldId,
      name: 'Wrong source total',
      options: { expression: 'sum({values})' },
      config: {
        linkFieldId: linkField!.id,
        foreignTableId: source.id,
        lookupFieldId: wrongTargetAmount!.id,
      },
    });
    const wrongLookupRollupBody: unknown = await wrongLookupRollupResponse.json();

    const wrongTargetRollupFieldId = 'fld0000000007751r';
    const wrongTargetRollupResponse = await createFieldRequest({
      type: 'rollup',
      id: wrongTargetRollupFieldId,
      name: 'Wrong target total',
      options: { expression: 'sum({values})' },
      config: {
        linkFieldId: linkField!.id,
        foreignTableId: wrongTarget.id,
        lookupFieldId: wrongTargetAmount!.id,
      },
    });
    const wrongTargetRollupBody: unknown = await wrongTargetRollupResponse.json();

    const wrongLookupFieldId = 'fld0000000007751l';
    const wrongLookupResponse = await createFieldRequest({
      type: 'lookup',
      id: wrongLookupFieldId,
      name: 'Wrong source lookup',
      options: {
        linkFieldId: linkField!.id,
        foreignTableId: source.id,
        lookupFieldId: wrongTargetAmount!.id,
      },
    });
    const wrongLookupBody: unknown = await wrongLookupResponse.json();

    expect(wrongLookupRollupResponse.status).toBe(400);
    expect(wrongTargetRollupResponse.status).toBe(400);
    expect(wrongLookupResponse.status).toBe(400);
    expect(createFieldOkResponseSchema.safeParse(wrongLookupRollupBody).success).toBe(false);
    expect(createFieldOkResponseSchema.safeParse(wrongTargetRollupBody).success).toBe(false);
    expect(createFieldOkResponseSchema.safeParse(wrongLookupBody).success).toBe(false);

    const hostAfter = await ctx.getTableById(host.id);
    expect(
      hostAfter.fields.some((field) =>
        [wrongLookupRollupFieldId, wrongTargetRollupFieldId, wrongLookupFieldId].includes(field.id)
      )
    ).toBe(false);
  });
});
