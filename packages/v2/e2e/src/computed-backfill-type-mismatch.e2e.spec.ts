/* eslint-disable @typescript-eslint/naming-convention */
/**
 * T6836: sanitized, structure-equivalent to production table.update computed
 * backfill failures BACKEND-AI-1FD / BACKEND-AI-1FE.
 *
 * Retained structural facts only:
 * - manyOne host lookup of a foreign link field stored as jsonb
 * - manyOne host lookup of a foreign number field stored as double precision
 * - leftover TEXT / string field metadata on those lookups
 * - table.update self-backfill after the metadata drift
 *
 * Customer names, ids, and values are not copied.
 */
import { sql } from 'kysely';
import { beforeAll, describe, expect, it } from 'vitest';

import { getSharedTestContext, type SharedTestContext } from './shared/globalTestContext';

describe('v2 computed backfill type mismatch (e2e)', () => {
  let ctx: SharedTestContext;
  let fieldIdCounter = 0;

  const createFieldId = () => {
    const suffix = `bkfcast${fieldIdCounter.toString(36)}`.padStart(16, '0');
    fieldIdCounter += 1;
    return `fld${suffix}`;
  };

  const uniqueName = (prefix: string) =>
    `${prefix} ${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;

  const drainOutbox = async (maxRounds = 10) => {
    for (let i = 0; i < maxRounds; i += 1) {
      const drained = await ctx.testContainer.processOutbox();
      if (drained === 0) break;
    }
  };

  const markLookupMetadataAsText = async (fieldIds: string[]) => {
    await sql`
      UPDATE field
      SET db_field_type = 'TEXT', cell_value_type = 'string'
      WHERE id IN (${sql.join(fieldIds.map((fieldId) => sql`${fieldId}`))})
    `.execute(ctx.testContainer.dataDb);
  };

  beforeAll(async () => {
    ctx = await getSharedTestContext();
  }, 120_000);

  it(
    'backfills jsonb and double-precision lookups after leftover TEXT metadata on table.update',
    { timeout: 120_000 },
    async () => {
      const peerTitleFieldId = createFieldId();
      const foreignTitleFieldId = createFieldId();
      const foreignNumberFieldId = createFieldId();
      const foreignLinkFieldId = createFieldId();
      const hostTitleFieldId = createFieldId();
      const hostLinkFieldId = createFieldId();
      const numberLookupFieldId = createFieldId();
      const linkLookupFieldId = createFieldId();

      let peerTableId: string | undefined;
      let foreignTableId: string | undefined;
      let hostTableId: string | undefined;

      try {
        const peer = await ctx.createTable({
          baseId: ctx.baseId,
          name: uniqueName('Backfill Cast Peer'),
          fields: [
            { type: 'singleLineText', id: peerTitleFieldId, name: 'Peer Title', isPrimary: true },
          ],
          views: [{ type: 'grid' }],
        });
        peerTableId = peer.id;
        const peerRecord = await ctx.createRecord(peer.id, {
          [peerTitleFieldId]: 'Peer A',
        });

        const foreign = await ctx.createTable({
          baseId: ctx.baseId,
          name: uniqueName('Backfill Cast Foreign'),
          fields: [
            { type: 'singleLineText', id: foreignTitleFieldId, name: 'Title', isPrimary: true },
            {
              type: 'number',
              id: foreignNumberFieldId,
              name: 'Amount',
              options: { formatting: { type: 'decimal', precision: 2 } },
            },
            {
              type: 'link',
              id: foreignLinkFieldId,
              name: 'Peer Link',
              options: {
                relationship: 'manyOne',
                foreignTableId: peer.id,
                lookupFieldId: peerTitleFieldId,
              },
            },
          ],
          views: [{ type: 'grid' }],
        });
        foreignTableId = foreign.id;
        const foreignRecord = await ctx.createRecord(foreign.id, {
          [foreignTitleFieldId]: 'Item A',
          [foreignNumberFieldId]: 12.5,
          [foreignLinkFieldId]: { id: peerRecord.id },
        });

        const host = await ctx.createTable({
          baseId: ctx.baseId,
          name: uniqueName('Backfill Cast Host'),
          fields: [
            { type: 'singleLineText', id: hostTitleFieldId, name: 'Name', isPrimary: true },
            {
              type: 'link',
              id: hostLinkFieldId,
              name: 'Foreign Link',
              options: {
                relationship: 'manyOne',
                foreignTableId: foreign.id,
                lookupFieldId: foreignTitleFieldId,
              },
            },
          ],
          views: [{ type: 'grid' }],
        });
        hostTableId = host.id;
        const hostRecord = await ctx.createRecord(host.id, {
          [hostTitleFieldId]: 'Host 1',
          [hostLinkFieldId]: { id: foreignRecord.id },
        });
        await drainOutbox();

        await ctx.createField({
          baseId: ctx.baseId,
          tableId: host.id,
          field: {
            type: 'lookup',
            id: numberLookupFieldId,
            name: 'Amount Lookup',
            options: {
              foreignTableId: foreign.id,
              linkFieldId: hostLinkFieldId,
              lookupFieldId: foreignNumberFieldId,
            },
          },
        });
        await ctx.createField({
          baseId: ctx.baseId,
          tableId: host.id,
          field: {
            type: 'lookup',
            id: linkLookupFieldId,
            name: 'Peer Lookup',
            options: {
              foreignTableId: foreign.id,
              linkFieldId: hostLinkFieldId,
              lookupFieldId: foreignLinkFieldId,
            },
          },
        });
        await drainOutbox();

        await markLookupMetadataAsText([numberLookupFieldId, linkLookupFieldId]);

        await ctx.updateField({
          tableId: host.id,
          fieldId: numberLookupFieldId,
          field: {
            type: 'lookup',
            options: {
              foreignTableId: foreign.id,
              linkFieldId: hostLinkFieldId,
              lookupFieldId: foreignNumberFieldId,
              filter: {
                conjunction: 'and',
                filterSet: [{ fieldId: foreignNumberFieldId, operator: 'isGreater', value: 0 }],
              },
            },
          },
        });
        await ctx.updateField({
          tableId: host.id,
          fieldId: linkLookupFieldId,
          field: {
            type: 'lookup',
            options: {
              foreignTableId: foreign.id,
              linkFieldId: hostLinkFieldId,
              lookupFieldId: foreignLinkFieldId,
              filter: {
                conjunction: 'and',
                filterSet: [{ fieldId: foreignNumberFieldId, operator: 'isGreater', value: 0 }],
              },
            },
          },
        });
        await drainOutbox();

        const record = (await ctx.listRecords(host.id)).find((item) => item.id === hostRecord.id);
        expect(record).toBeDefined();
        const amount = record?.fields[numberLookupFieldId];
        expect(amount === 12.5 || (Array.isArray(amount) && amount[0] === 12.5)).toBe(true);
        expect(JSON.stringify(record?.fields[linkLookupFieldId])).toContain('Peer A');
      } finally {
        if (hostTableId) await ctx.deleteTable(hostTableId).catch(() => undefined);
        if (foreignTableId) await ctx.deleteTable(foreignTableId).catch(() => undefined);
        if (peerTableId) await ctx.deleteTable(peerTableId).catch(() => undefined);
      }
    }
  );
});
