/* eslint-disable @typescript-eslint/naming-convention */
import { beforeAll, describe, expect, it } from 'vitest';
import { getSharedTestContext, type SharedTestContext } from './shared/globalTestContext';

/**
 * Structure-equivalent reproduction for empty foreign primary titles:
 * - foreign primary is empty/null
 * - host link is written by id only
 * - same link value is written again (idempotent API/import path)
 * - stored link is read back and written as-is
 *
 * Fixture uses neutral names only; no customer identifiers/values.
 */
describe('v2 link empty foreign title rewrite (e2e)', () => {
  let ctx: SharedTestContext;
  let fieldIdCounter = 0;

  const createFieldId = () => {
    const suffix = fieldIdCounter.toString(36).padStart(16, '0');
    fieldIdCounter += 1;
    return `fld${suffix}`;
  };

  beforeAll(async () => {
    ctx = await getSharedTestContext();
  });

  it('keeps manyOne empty-title links rewriteable after idempotent writes', async () => {
    const foreignTitleFieldId = createFieldId();
    const hostTitleFieldId = createFieldId();
    const linkFieldId = createFieldId();

    const foreignTable = await ctx.createTable({
      baseId: ctx.baseId,
      name: 'Empty Title Foreign ManyOne',
      fields: [{ type: 'singleLineText', id: foreignTitleFieldId, name: 'Name', isPrimary: true }],
      views: [{ type: 'grid' }],
    });

    const emptyForeign = await ctx.createRecord(foreignTable.id, {
      [foreignTitleFieldId]: null,
    });

    const hostTable = await ctx.createTable({
      baseId: ctx.baseId,
      name: 'Empty Title Host ManyOne',
      fields: [
        { type: 'singleLineText', id: hostTitleFieldId, name: 'Title', isPrimary: true },
        {
          type: 'link',
          id: linkFieldId,
          name: 'Related',
          options: {
            relationship: 'manyOne',
            foreignTableId: foreignTable.id,
            lookupFieldId: foreignTitleFieldId,
            isOneWay: true,
          },
        },
      ],
      views: [{ type: 'grid' }],
    });

    const hostRecord = await ctx.createRecord(hostTable.id, {
      [hostTitleFieldId]: 'Host Row',
      [linkFieldId]: { id: emptyForeign.id },
    });

    await ctx.updateRecord(hostTable.id, hostRecord.id, {
      [linkFieldId]: { id: emptyForeign.id },
    });

    const afterRepeat = (await ctx.listRecords(hostTable.id)).find((r) => r.id === hostRecord.id);
    expect(afterRepeat).toBeDefined();
    const repeatedLink = afterRepeat?.fields[linkFieldId] as
      | { id?: string; title?: string | null }
      | undefined;
    expect(repeatedLink?.id).toBe(emptyForeign.id);
    expect(repeatedLink).not.toHaveProperty('title');

    await expect(
      ctx.updateRecord(hostTable.id, hostRecord.id, {
        [linkFieldId]: repeatedLink,
      })
    ).resolves.toBeDefined();

    const afterRewrite = (await ctx.listRecords(hostTable.id)).find((r) => r.id === hostRecord.id);
    const rewrittenLink = afterRewrite?.fields[linkFieldId] as
      | { id?: string; title?: string | null }
      | undefined;
    expect(rewrittenLink?.id).toBe(emptyForeign.id);
    expect(rewrittenLink).not.toHaveProperty('title');
  });

  it('keeps manyMany empty-title links rewriteable after idempotent writes', async () => {
    const foreignTitleFieldId = createFieldId();
    const hostTitleFieldId = createFieldId();
    const linkFieldId = createFieldId();

    const foreignTable = await ctx.createTable({
      baseId: ctx.baseId,
      name: 'Empty Title Foreign ManyMany',
      fields: [{ type: 'singleLineText', id: foreignTitleFieldId, name: 'Name', isPrimary: true }],
      views: [{ type: 'grid' }],
    });

    const emptyForeign = await ctx.createRecord(foreignTable.id, {
      [foreignTitleFieldId]: null,
    });
    const namedForeign = await ctx.createRecord(foreignTable.id, {
      [foreignTitleFieldId]: 'Named Foreign',
    });

    const hostTable = await ctx.createTable({
      baseId: ctx.baseId,
      name: 'Empty Title Host ManyMany',
      fields: [
        { type: 'singleLineText', id: hostTitleFieldId, name: 'Title', isPrimary: true },
        {
          type: 'link',
          id: linkFieldId,
          name: 'Related',
          options: {
            relationship: 'manyMany',
            foreignTableId: foreignTable.id,
            lookupFieldId: foreignTitleFieldId,
            isOneWay: true,
          },
        },
      ],
      views: [{ type: 'grid' }],
    });

    const hostRecord = await ctx.createRecord(hostTable.id, {
      [hostTitleFieldId]: 'Host Row',
      [linkFieldId]: [{ id: emptyForeign.id }, { id: namedForeign.id }],
    });

    await ctx.updateRecord(hostTable.id, hostRecord.id, {
      [linkFieldId]: [{ id: emptyForeign.id }, { id: namedForeign.id }],
    });

    const afterRepeat = (await ctx.listRecords(hostTable.id)).find((r) => r.id === hostRecord.id);
    const repeatedLinks = afterRepeat?.fields[linkFieldId] as
      | Array<{ id?: string; title?: string | null }>
      | undefined;
    expect(Array.isArray(repeatedLinks)).toBe(true);
    expect(repeatedLinks?.map((link) => link.id).sort()).toEqual(
      [emptyForeign.id, namedForeign.id].sort()
    );
    const emptyLink = repeatedLinks?.find((link) => link.id === emptyForeign.id);
    expect(emptyLink).toBeDefined();
    expect(emptyLink).not.toHaveProperty('title');

    await expect(
      ctx.updateRecord(hostTable.id, hostRecord.id, {
        [linkFieldId]: repeatedLinks,
      })
    ).resolves.toBeDefined();

    // Compatibility path: already-persisted null titles must still be accepted.
    await expect(
      ctx.updateRecord(hostTable.id, hostRecord.id, {
        [linkFieldId]: [
          { id: emptyForeign.id, title: null },
          { id: namedForeign.id, title: 'Named Foreign' },
        ],
      })
    ).resolves.toBeDefined();

    const afterNullishRewrite = (await ctx.listRecords(hostTable.id)).find(
      (r) => r.id === hostRecord.id
    );
    const rewrittenLinks = afterNullishRewrite?.fields[linkFieldId] as
      | Array<{ id?: string; title?: string | null }>
      | undefined;
    const rewrittenEmpty = rewrittenLinks?.find((link) => link.id === emptyForeign.id);
    expect(rewrittenEmpty?.id).toBe(emptyForeign.id);
    expect(rewrittenEmpty).not.toHaveProperty('title');
  });
});
