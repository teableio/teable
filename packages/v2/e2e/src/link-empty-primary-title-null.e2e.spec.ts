/* eslint-disable @typescript-eslint/naming-convention */
import { describe, beforeAll, expect, it } from 'vitest';
import { getSharedTestContext, type SharedTestContext } from './shared/globalTestContext';

/**
 * T6508: empty-primary foreign records can persist link snapshots as {id, title:null}.
 * Rewriting that value (UI reselect / import / automation) must not 400, and storage
 * must omit null titles the same way computed recompute does via jsonb_strip_nulls.
 *
 * Fixture is sanitized/structure-equivalent: no customer ids or values.
 */
describe('v2 link empty primary title null rewrite (e2e)', () => {
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

  it('accepts rewriting a manyOne link that already points at an empty-primary record', async () => {
    const hostNameFieldId = createFieldId();
    const hostLinkFieldId = createFieldId();
    const foreignNameFieldId = createFieldId();

    const foreignTable = await ctx.createTable({
      baseId: ctx.baseId,
      name: 'ForeignEmptyPrimary',
      fields: [
        {
          type: 'singleLineText',
          id: foreignNameFieldId,
          name: 'name',
          isPrimary: true,
        },
      ],
    });

    const emptyPrimary = await ctx.createRecord(foreignTable.id, {
      [foreignNameFieldId]: null,
    });
    const titled = await ctx.createRecord(foreignTable.id, {
      [foreignNameFieldId]: 'titled-foreign',
    });

    const hostTable = await ctx.createTable({
      baseId: ctx.baseId,
      name: 'HostLinkEmptyPrimary',
      fields: [
        {
          type: 'singleLineText',
          id: hostNameFieldId,
          name: 'name',
          isPrimary: true,
        },
        {
          type: 'link',
          id: hostLinkFieldId,
          name: 'link',
          options: {
            relationship: 'manyOne',
            foreignTableId: foreignTable.id,
            lookupFieldId: foreignNameFieldId,
            isOneWay: true,
          },
        },
      ],
    });

    const host = await ctx.createRecord(hostTable.id, {
      [hostNameFieldId]: 'host-row',
      [hostLinkFieldId]: { id: emptyPrimary.id },
    });
    await ctx.drainOutbox();

    // First link to empty primary is allowed (id-only).
    let listed = await ctx.listRecords(hostTable.id);
    let row = listed.find((record) => record.id === host.id);
    expect(row?.fields[hostLinkFieldId]).toEqual({ id: emptyPrimary.id });

    // Rewrite with explicit title:null (read-back / UI reselect shape).
    await ctx.updateRecord(hostTable.id, host.id, {
      [hostLinkFieldId]: { id: emptyPrimary.id, title: null },
    });
    await ctx.drainOutbox();

    listed = await ctx.listRecords(hostTable.id);
    row = listed.find((record) => record.id === host.id);
    expect(row?.fields[hostLinkFieldId]).toEqual({ id: emptyPrimary.id });
    expect(row?.fields[hostLinkFieldId]).not.toHaveProperty('title');

    // Control: titled foreign still stores a title.
    await ctx.updateRecord(hostTable.id, host.id, {
      [hostLinkFieldId]: { id: titled.id },
    });
    await ctx.drainOutbox();

    listed = await ctx.listRecords(hostTable.id);
    row = listed.find((record) => record.id === host.id);
    expect(row?.fields[hostLinkFieldId]).toEqual({ id: titled.id, title: 'titled-foreign' });
  });

  it('accepts rewriting a manyMany link item with title:null for empty primary', async () => {
    const hostNameFieldId = createFieldId();
    const hostLinkFieldId = createFieldId();
    const foreignNameFieldId = createFieldId();

    const foreignTable = await ctx.createTable({
      baseId: ctx.baseId,
      name: 'ForeignEmptyPrimaryMulti',
      fields: [
        {
          type: 'singleLineText',
          id: foreignNameFieldId,
          name: 'name',
          isPrimary: true,
        },
      ],
    });

    const emptyPrimary = await ctx.createRecord(foreignTable.id, {
      [foreignNameFieldId]: null,
    });
    const titled = await ctx.createRecord(foreignTable.id, {
      [foreignNameFieldId]: 'titled-foreign-2',
    });

    const hostTable = await ctx.createTable({
      baseId: ctx.baseId,
      name: 'HostLinkEmptyPrimaryMulti',
      fields: [
        {
          type: 'singleLineText',
          id: hostNameFieldId,
          name: 'name',
          isPrimary: true,
        },
        {
          type: 'link',
          id: hostLinkFieldId,
          name: 'links',
          options: {
            relationship: 'manyMany',
            foreignTableId: foreignTable.id,
            lookupFieldId: foreignNameFieldId,
            isOneWay: true,
          },
        },
      ],
    });

    const host = await ctx.createRecord(hostTable.id, {
      [hostNameFieldId]: 'host-row-multi',
      [hostLinkFieldId]: [{ id: emptyPrimary.id }, { id: titled.id }],
    });
    await ctx.drainOutbox();

    await ctx.updateRecord(hostTable.id, host.id, {
      [hostLinkFieldId]: [
        { id: emptyPrimary.id, title: null },
        { id: titled.id, title: 'titled-foreign-2' },
      ],
    });
    await ctx.drainOutbox();

    const listed = await ctx.listRecords(hostTable.id);
    const row = listed.find((record) => record.id === host.id);
    expect(row?.fields[hostLinkFieldId]).toEqual([
      { id: emptyPrimary.id },
      { id: titled.id, title: 'titled-foreign-2' },
    ]);
  });
});
