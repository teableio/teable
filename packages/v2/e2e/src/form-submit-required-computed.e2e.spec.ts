import { submitRecordOkResponseSchema } from '@teable/v2-contract-http';
import { beforeAll, describe, expect, it } from 'vitest';
import { getSharedTestContext, type SharedTestContext } from './shared/globalTestContext';

let nextId = 0;

const createFieldId = () => {
  nextId += 1;
  return `fld${nextId.toString(36).padStart(16, '0')}`;
};

describe('v2 http form submit required computed field regression (e2e)', () => {
  let ctx: SharedTestContext;

  beforeAll(async () => {
    ctx = await getSharedTestContext();
  }, 30000);

  it('submits when stale form metadata marks a computed field as required', async () => {
    const titleFieldId = createFieldId();
    const createdByFieldId = createFieldId();

    const table = await ctx.createTable({
      baseId: ctx.baseId,
      name: 'form-required-computed',
      fields: [
        { id: titleFieldId, type: 'singleLineText', name: 'Title', isPrimary: true },
        { id: createdByFieldId, type: 'createdBy', name: 'Creator' },
      ],
      views: [
        { type: 'grid', name: 'Grid' },
        { type: 'form', name: 'Form' },
      ],
    });

    const formView = table.views.find((view) => view.type === 'form');
    if (!formView) {
      throw new Error('Missing form view');
    }

    await ctx.testContainer.db
      .updateTable('view')
      .set({
        column_meta: JSON.stringify({
          [titleFieldId]: { order: 0, visible: true, required: true },
          [createdByFieldId]: { order: 1, visible: true, required: true },
        }),
      })
      .where('id', '=', formView.id)
      .execute();

    const response = await fetch(`${ctx.baseUrl}/tables/submitRecord`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        tableId: table.id,
        formId: formView.id,
        fields: {
          [titleFieldId]: 'submitted',
        },
      }),
    });

    const rawBody = await response.json();
    expect(response.status).toBe(201);

    const parsed = submitRecordOkResponseSchema.safeParse(rawBody);
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;

    expect(parsed.data.data.record.fields[titleFieldId]).toBe('submitted');

    const records = await ctx.listRecords(table.id, { limit: 1000 });
    expect(records).toHaveLength(1);
    expect(records[0]?.fields[titleFieldId]).toBe('submitted');
  });
});
