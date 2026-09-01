import {
  createViewErrorResponseSchema,
  createViewOkResponseSchema,
} from '@teable/v2-contract-http';
import { createV2HttpClient } from '@teable/v2-contract-http-client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { getSharedTestContext, type SharedTestContext } from './shared/globalTestContext';

describe('v2 http createView (e2e)', () => {
  let ctx: SharedTestContext;
  let tableId: string;
  let primaryFieldId: string;

  const postCreateView = async (view: Record<string, unknown>, targetTableId = tableId) => {
    const response = await fetch(`${ctx.baseUrl}/tables/createView`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ tableId: targetTableId, view }),
    });
    return { response, body: await response.json() };
  };

  beforeAll(async () => {
    ctx = await getSharedTestContext();
    const table = await ctx.createTable({
      baseId: ctx.baseId,
      name: 'Create View Contract',
      fields: [
        { type: 'singleLineText', name: 'Name', isPrimary: true },
        { type: 'date', name: 'Start' },
        {
          type: 'singleSelect',
          name: 'Status',
          options: {
            choices: [
              { id: 'choTodo', name: 'Todo', color: 'blue' },
              { id: 'choDone', name: 'Done', color: 'green' },
            ],
          },
        },
      ],
      views: [{ type: 'grid', name: 'Seed' }],
    });
    tableId = table.id;
    const primaryField = table.fields.find((field) => field.isPrimary);
    if (!primaryField) throw new Error('Primary field was not created');
    primaryFieldId = primaryField.id;
  });

  afterAll(async () => {
    if (ctx && tableId) {
      await ctx.deleteTable(tableId).catch(() => undefined);
    }
  });

  it('creates a rich Grid View and returns the Table aggregate, View id, and v2 event', async () => {
    const { response, body } = await postCreateView({
      type: 'grid',
      name: 'Planning',
      description: 'Planning details',
      columnMeta: {
        [primaryFieldId]: { width: 240 },
      },
      options: { rowHeight: 'short', frozenColumnCount: 1 },
      sourceFilter: {
        conjunction: 'and',
        filterSet: [
          {
            fieldId: primaryFieldId,
            operator: 'LIKE',
            isSymbol: true,
            value: 'alpha',
          },
        ],
      },
      sort: [{ fieldId: primaryFieldId, order: 'asc' }],
      manualSort: false,
      isLocked: true,
      enableShare: true,
      shareMeta: { allowCopy: false, password: 'secret' },
    });

    expect(response.status, JSON.stringify(body)).toBe(200);
    const parsed = createViewOkResponseSchema.safeParse(body);
    expect(parsed.success).toBe(true);
    if (!parsed.success || !parsed.data.ok) return;

    const created = parsed.data.data.table.views.find(
      (view) => view.id === parsed.data.data.viewId
    );
    expect(created).toMatchObject({
      id: parsed.data.data.viewId,
      name: 'Planning',
      type: 'grid',
    });
    expect(created?.columnMeta[primaryFieldId]).toMatchObject({ order: 0, width: 240 });
    expect(parsed.data.data.events).toEqual(
      expect.arrayContaining([expect.objectContaining({ name: 'ViewCreated' })])
    );
  });

  it.each([
    ['grid', { rowHeight: 'medium' }],
    ['kanban', { isEmptyStackHidden: true }],
    ['gallery', { isFieldNameHidden: true }],
    ['calendar', { titleFieldId: null }],
    ['form', { submitLabel: 'Submit' }],
  ] as const)('creates a %s View through the native contract', async (type, options) => {
    const { response, body } = await postCreateView({
      type,
      name: `Contract ${type}`,
      options,
    });

    expect(response.status).toBe(200);
    const parsed = createViewOkResponseSchema.safeParse(body);
    expect(parsed.success).toBe(true);
    if (!parsed.success || !parsed.data.ok) return;

    expect(
      parsed.data.data.table.views.find((view) => view.id === parsed.data.data.viewId)
    ).toMatchObject({ type, name: `Contract ${type}` });
  });

  it('supports the typed client without changing the legacy REST contract', async () => {
    const client = createV2HttpClient({ baseUrl: ctx.baseUrl });
    const result = await client.tables.createView({
      tableId,
      view: {
        type: 'grid',
        name: 'Typed client',
        options: { rowHeight: 'tall' },
      },
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.table.views).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: result.data.viewId,
          name: 'Typed client',
          type: 'grid',
        }),
      ])
    );
  });

  it('uses the Table aggregate to make duplicate View names unique', async () => {
    const first = await postCreateView({ type: 'grid', name: 'Duplicate contract name' });
    const second = await postCreateView({ type: 'grid', name: 'Duplicate contract name' });

    expect(first.response.status).toBe(200);
    expect(second.response.status).toBe(200);
    const parsed = createViewOkResponseSchema.safeParse(second.body);
    expect(parsed.success).toBe(true);
    if (!parsed.success || !parsed.data.ok) return;

    expect(
      parsed.data.data.table.views.find((view) => view.id === parsed.data.data.viewId)?.name
    ).toBe('Duplicate contract name 2');
  });

  it('rejects an unsupported View type at the contract boundary', async () => {
    const { response } = await postCreateView({ type: 'timeline', name: 'Unsupported' });
    expect(response.status).toBe(400);
  });

  it('maps aggregate option validation failures to the v2 error contract', async () => {
    const { response, body } = await postCreateView({
      type: 'grid',
      name: 'Invalid options',
      options: { rowHeight: 'giant' },
    });

    expect(response.status).toBe(400);
    const parsed = createViewErrorResponseSchema.safeParse(body);
    expect(parsed.success).toBe(true);
    if (!parsed.success || parsed.data.ok) return;
    expect(parsed.data.error.message).toContain('Invalid grid View options');
  });

  it('maps a missing Table aggregate to the v2 error contract', async () => {
    const { response, body } = await postCreateView(
      { type: 'grid', name: 'Missing Table' },
      `tbl${'f'.repeat(16)}`
    );

    expect(response.status).toBe(404);
    const parsed = createViewErrorResponseSchema.safeParse(body);
    expect(parsed.success).toBe(true);
    if (!parsed.success || parsed.data.ok) return;
    expect(parsed.data.error.tags).toContain('not-found');
  });
});
