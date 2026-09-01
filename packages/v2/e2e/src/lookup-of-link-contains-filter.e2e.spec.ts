/* eslint-disable @typescript-eslint/naming-convention */
/**
 * T6923: lookup-of-link "contains" must match linked-record titles.
 *
 * Sanitized, structure-equivalent of the production case:
 * - host table has a link to a related table
 * - host also looks up that related table's own link field (original records)
 * - stored values are JSON arrays of {id, title}
 * - equals uses the record picker (ids) and already works
 * - contains is a text input and must match title substrings
 */
import { FieldKeyType } from '@teable/v2-core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { getSharedTestContext, type SharedTestContext } from './shared/globalTestContext';

describe('v2 lookup-of-link contains filter (e2e)', () => {
  let ctx: SharedTestContext;
  let fieldIdCounter = 0;
  const runId = Math.random().toString(36).slice(2, 8).padEnd(6, '0');

  const createFieldId = () => {
    const suffix = fieldIdCounter.toString(36).padStart(10, '0');
    fieldIdCounter += 1;
    return `fld${runId}${suffix}`;
  };

  const drainOutbox = async (rounds = 20) => {
    for (let i = 0; i < rounds; i += 1) {
      const drained = await ctx.testContainer.processOutbox();
      if (drained === 0) break;
    }
  };

  const listWithFilter = async (tableId: string, filter: unknown) => {
    await drainOutbox();

    const params = new URLSearchParams({
      tableId,
      fieldKeyType: FieldKeyType.Id,
      filter: JSON.stringify(filter),
    });

    const response = await fetch(`${ctx.baseUrl}/tables/listRecords?${params.toString()}`, {
      method: 'GET',
      headers: { 'content-type': 'application/json' },
    });
    const rawBody = await response.json();
    if (response.status !== 200) {
      throw new Error(`ListRecords failed: ${JSON.stringify(rawBody)}`);
    }
    if (!rawBody?.ok) {
      throw new Error(`ListRecords response invalid: ${JSON.stringify(rawBody)}`);
    }
    return rawBody.data.records as Array<{ id: string; fields: Record<string, unknown> }>;
  };

  beforeAll(async () => {
    ctx = await getSharedTestContext();
  }, 60000);

  it('matches title substrings on lookup-of-link contains and keeps equals on record ids', async () => {
    const peerTitleFieldId = createFieldId();
    const relatedTitleFieldId = createFieldId();
    const relatedPeerLinkFieldId = createFieldId();
    const hostTitleFieldId = createFieldId();
    const hostRelatedLinkFieldId = createFieldId();
    const lookupOfLinkFieldId = createFieldId();

    const peerTable = await ctx.createTable({
      baseId: ctx.baseId,
      name: `T6923 Peer ${runId}`,
      fields: [{ type: 'singleLineText', id: peerTitleFieldId, name: 'Title', isPrimary: true }],
      views: [{ type: 'grid' }],
    });

    const [alpha, beta, gamma] = await ctx.createRecords(peerTable.id, [
      { fields: { [peerTitleFieldId]: 'Alpha' } },
      { fields: { [peerTitleFieldId]: 'Beta' } },
      { fields: { [peerTitleFieldId]: 'Gamma' } },
    ]);

    const relatedTable = await ctx.createTable({
      baseId: ctx.baseId,
      name: `T6923 Related ${runId}`,
      fields: [
        { type: 'singleLineText', id: relatedTitleFieldId, name: 'Title', isPrimary: true },
        {
          type: 'link',
          id: relatedPeerLinkFieldId,
          name: 'Original Record',
          options: {
            relationship: 'manyOne',
            foreignTableId: peerTable.id,
            lookupFieldId: peerTitleFieldId,
          },
        },
      ],
      views: [{ type: 'grid' }],
    });

    const [relatedAlpha, relatedBeta, relatedGamma, relatedAlpha2] = await ctx.createRecords(
      relatedTable.id,
      [
        {
          fields: {
            [relatedTitleFieldId]: 'Related Alpha',
            [relatedPeerLinkFieldId]: { id: alpha.id },
          },
        },
        {
          fields: {
            [relatedTitleFieldId]: 'Related Beta',
            [relatedPeerLinkFieldId]: { id: beta.id },
          },
        },
        {
          fields: {
            [relatedTitleFieldId]: 'Related Gamma',
            [relatedPeerLinkFieldId]: { id: gamma.id },
          },
        },
        {
          fields: {
            [relatedTitleFieldId]: 'Related Alpha 2',
            [relatedPeerLinkFieldId]: { id: alpha.id },
          },
        },
      ]
    );

    const hostTable = await ctx.createTable({
      baseId: ctx.baseId,
      name: `T6923 Host ${runId}`,
      fields: [
        { type: 'singleLineText', id: hostTitleFieldId, name: 'Name', isPrimary: true },
        {
          type: 'link',
          id: hostRelatedLinkFieldId,
          name: 'Related',
          options: {
            relationship: 'oneMany',
            foreignTableId: relatedTable.id,
            lookupFieldId: relatedTitleFieldId,
          },
        },
      ],
      views: [{ type: 'grid' }],
    });

    const createdLookup = await ctx.createField({
      baseId: ctx.baseId,
      tableId: hostTable.id,
      field: {
        type: 'lookup',
        id: lookupOfLinkFieldId,
        name: 'Original Records',
        options: {
          foreignTableId: relatedTable.id,
          linkFieldId: hostRelatedLinkFieldId,
          lookupFieldId: relatedPeerLinkFieldId,
        },
      },
    });
    const lookupField = createdLookup.fields.find((field) => field.id === lookupOfLinkFieldId);
    expect(lookupField).toMatchObject({ type: 'link', isLookup: true });

    const [hostAlpha, hostBeta, hostBoth] = await ctx.createRecords(hostTable.id, [
      {
        fields: {
          [hostTitleFieldId]: 'Host Alpha',
          [hostRelatedLinkFieldId]: [{ id: relatedAlpha.id }],
        },
      },
      {
        fields: {
          [hostTitleFieldId]: 'Host Beta',
          [hostRelatedLinkFieldId]: [{ id: relatedBeta.id }],
        },
      },
      {
        fields: {
          [hostTitleFieldId]: 'Host Both',
          [hostRelatedLinkFieldId]: [{ id: relatedAlpha2.id }, { id: relatedGamma.id }],
        },
      },
      { fields: { [hostTitleFieldId]: 'Host Empty' } },
    ]);
    await drainOutbox();

    const containsAlpha = await listWithFilter(hostTable.id, {
      fieldId: lookupOfLinkFieldId,
      operator: 'contains',
      value: 'lph',
    });
    expect(containsAlpha.map((record) => record.id).sort()).toEqual(
      [hostAlpha.id, hostBoth.id].sort()
    );

    const containsMissing = await listWithFilter(hostTable.id, {
      fieldId: lookupOfLinkFieldId,
      operator: 'contains',
      value: 'zzz',
    });
    expect(containsMissing).toHaveLength(0);

    const equalsBeta = await listWithFilter(hostTable.id, {
      fieldId: lookupOfLinkFieldId,
      operator: 'is',
      value: beta.id,
    });
    expect(equalsBeta.map((record) => record.id)).toEqual([hostBeta.id]);
  }, 120000);
});
