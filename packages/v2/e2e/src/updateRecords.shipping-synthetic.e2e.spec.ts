/* eslint-disable @typescript-eslint/naming-convention */
import {
  buildMultiTableNameMaps,
  formatComputedPlanSnapshot,
} from '@teable/v2-container-node-test';
import { beforeAll, describe, expect, test } from 'vitest';

import { getSharedTestContext, type SharedTestContext } from './shared/globalTestContext';

let fieldIdCounter = 0;
const createFieldId = () => {
  const suffix = fieldIdCounter.toString(36).padStart(16, '0');
  fieldIdCounter += 1;
  return `fld${suffix}`;
};

const chunk = <T>(items: T[], size: number) => {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
};

const deleteTableSafe = async (ctx: SharedTestContext, tableId: string | undefined) => {
  if (!tableId) return;
  try {
    await ctx.deleteTable(tableId);
  } catch {
    return undefined;
  }
};

const normalizeLookupScalar = (value: unknown) => {
  if (Array.isArray(value)) {
    return value[0] ?? null;
  }
  return value ?? null;
};

const countByNormalizedValue = (
  records: Array<{ id: string; fields: Record<string, unknown> }>,
  fieldId: string
) => {
  const counts = new Map<string, number>();
  for (const record of records) {
    const normalized = normalizeLookupScalar(record.fields[fieldId]);
    if (normalized == null) continue;
    const key = String(normalized);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
};

const getFieldValueByRecordId = (
  records: Array<{ id: string; fields: Record<string, unknown> }>,
  recordId: string,
  fieldId: string
) => {
  const record = records.find((item) => item.id === recordId);
  return record?.fields[fieldId];
};

describe('v2 updateRecords shipping-like synthetic filter update (e2e)', () => {
  let ctx: SharedTestContext;

  beforeAll(async () => {
    ctx = await getSharedTestContext();
  });

  test('updates shipping-like singleSelect values by filter and propagates lookup snapshots without prefetching ids', async () => {
    let ordersTableId: string | undefined;
    let shipmentsTableId: string | undefined;
    let trackingTableId: string | undefined;

    const legacyGround = 'Legacy Ground';
    const legacyExpress = 'Legacy Express';
    const legacyPostal = 'Legacy Postal';
    const carrierGround = 'Carrier Ground';
    const carrierExpress = 'Carrier Express';
    const carrierPostal = 'Carrier Postal';

    const legacyCounts = {
      [legacyGround]: 240,
      [legacyExpress]: 180,
      [legacyPostal]: 120,
    } as const;
    const existingModernCounts = {
      [carrierGround]: 60,
      [carrierExpress]: 60,
      [carrierPostal]: 60,
    } as const;
    const totalRecords =
      Object.values(legacyCounts).reduce((sum, value) => sum + value, 0) +
      Object.values(existingModernCounts).reduce((sum, value) => sum + value, 0);

    try {
      const orderNameFieldId = createFieldId();
      const orderSkuFieldId = createFieldId();

      const ordersTable = await ctx.createTable({
        baseId: ctx.baseId,
        name: `Synthetic Orders ${Date.now()}`,
        fields: [
          { type: 'singleLineText', id: orderNameFieldId, name: 'Order', isPrimary: true },
          { type: 'singleLineText', id: orderSkuFieldId, name: 'Sku' },
        ],
        views: [{ type: 'grid' }],
      });
      ordersTableId = ordersTable.id;

      const orderPayload = Array.from({ length: 24 }, (_, index) => ({
        fields: {
          [orderNameFieldId]: `ORDER-${String(index + 1).padStart(3, '0')}`,
          [orderSkuFieldId]: `SKU-${String((index % 8) + 1).padStart(2, '0')}`,
        },
      }));
      const orderRecords = await ctx.createRecords(ordersTable.id, orderPayload);

      const shipmentRefFieldId = createFieldId();
      const shipmentChannelFieldId = createFieldId();
      const shipmentOrderLinkFieldId = createFieldId();
      const shipmentOrderSkuLookupFieldId = createFieldId();
      const shipmentReadyFormulaFieldId = createFieldId();

      const shipmentsTable = await ctx.createTable({
        baseId: ctx.baseId,
        name: `Synthetic Shipments ${Date.now()}`,
        fields: [
          { type: 'singleLineText', id: shipmentRefFieldId, name: 'Shipment', isPrimary: true },
          {
            type: 'singleSelect',
            id: shipmentChannelFieldId,
            name: 'Channel',
            options: [
              legacyGround,
              legacyExpress,
              legacyPostal,
              carrierGround,
              carrierExpress,
              carrierPostal,
            ],
          },
          {
            type: 'link',
            id: shipmentOrderLinkFieldId,
            name: 'Order',
            options: {
              relationship: 'manyOne',
              foreignTableId: ordersTable.id,
              lookupFieldId: orderNameFieldId,
            },
          },
          {
            type: 'lookup',
            id: shipmentOrderSkuLookupFieldId,
            name: 'OrderSku',
            options: {
              linkFieldId: shipmentOrderLinkFieldId,
              foreignTableId: ordersTable.id,
              lookupFieldId: orderSkuFieldId,
            },
          },
        ],
        views: [{ type: 'grid' }],
      });
      shipmentsTableId = shipmentsTable.id;

      await ctx.createField({
        baseId: ctx.baseId,
        tableId: shipmentsTable.id,
        field: {
          type: 'formula',
          id: shipmentReadyFormulaFieldId,
          name: 'OrderReady',
          options: {
            expression: `IF({${shipmentOrderSkuLookupFieldId}}, "linked", "pending")`,
          },
        },
      });

      const trackingNameFieldId = createFieldId();
      const trackingShipmentLinkFieldId = createFieldId();
      const trackingChannelLookupFieldId = createFieldId();

      const trackingTable = await ctx.createTable({
        baseId: ctx.baseId,
        name: `Synthetic Tracking ${Date.now()}`,
        fields: [
          { type: 'singleLineText', id: trackingNameFieldId, name: 'Tracking', isPrimary: true },
          {
            type: 'link',
            id: trackingShipmentLinkFieldId,
            name: 'Shipment',
            options: {
              relationship: 'oneOne',
              foreignTableId: shipmentsTable.id,
              lookupFieldId: shipmentRefFieldId,
              isOneWay: true,
            },
          },
          {
            type: 'lookup',
            id: trackingChannelLookupFieldId,
            name: 'ChannelSnapshot',
            options: {
              linkFieldId: trackingShipmentLinkFieldId,
              foreignTableId: shipmentsTable.id,
              lookupFieldId: shipmentChannelFieldId,
            },
          },
        ],
        views: [{ type: 'grid' }],
      });
      trackingTableId = trackingTable.id;

      const seedChannels = [
        ...Array.from({ length: legacyCounts[legacyGround] }, () => legacyGround),
        ...Array.from({ length: legacyCounts[legacyExpress] }, () => legacyExpress),
        ...Array.from({ length: legacyCounts[legacyPostal] }, () => legacyPostal),
        ...Array.from({ length: existingModernCounts[carrierGround] }, () => carrierGround),
        ...Array.from({ length: existingModernCounts[carrierExpress] }, () => carrierExpress),
        ...Array.from({ length: existingModernCounts[carrierPostal] }, () => carrierPostal),
      ];

      const shipmentPayload = seedChannels.map((channel, index) => ({
        fields: {
          [shipmentRefFieldId]: `SHIP-${String(index + 1).padStart(4, '0')}`,
          [shipmentChannelFieldId]: channel,
          [shipmentOrderLinkFieldId]: { id: orderRecords[index % orderRecords.length]!.id },
        },
      }));

      const shipmentRecords: Array<{ id: string; fields: Record<string, unknown> }> = [];
      for (const recordsChunk of chunk(shipmentPayload, 200)) {
        const created = await ctx.createRecords(shipmentsTable.id, recordsChunk);
        shipmentRecords.push(...created);
      }

      const trackingPayload = shipmentRecords.map((shipment, index) => ({
        fields: {
          [trackingNameFieldId]: `TRK-${String(index + 1).padStart(4, '0')}`,
          [trackingShipmentLinkFieldId]: { id: shipment.id },
        },
      }));

      const trackingRecords: Array<{ id: string; fields: Record<string, unknown> }> = [];
      for (const recordsChunk of chunk(trackingPayload, 200)) {
        const created = await ctx.createRecords(trackingTable.id, recordsChunk);
        trackingRecords.push(...created);
      }

      await ctx.drainOutbox(20);

      ctx.clearLogs();

      const mappings = [
        { from: legacyGround, to: carrierGround, expectedUpdated: legacyCounts[legacyGround] },
        {
          from: legacyExpress,
          to: carrierExpress,
          expectedUpdated: legacyCounts[legacyExpress],
        },
        { from: legacyPostal, to: carrierPostal, expectedUpdated: legacyCounts[legacyPostal] },
      ] as const;

      const updateStart = performance.now();
      let totalUpdated = 0;
      for (const mapping of mappings) {
        const result = await ctx.updateRecords({
          tableId: shipmentsTable.id,
          fields: {
            [shipmentChannelFieldId]: mapping.to,
          },
          filter: {
            fieldId: shipmentChannelFieldId,
            operator: 'is',
            value: mapping.from,
          },
        });
        expect(result.updatedCount).toBe(mapping.expectedUpdated);
        totalUpdated += result.updatedCount;
      }
      const mutationMs = performance.now() - updateStart;

      const convergeStart = performance.now();
      await ctx.drainOutbox(20);
      const convergenceMs = performance.now() - convergeStart;

      const computedPlan = ctx.getLastComputedPlan();
      expect(computedPlan).toBeDefined();
      if (!computedPlan) {
        throw new Error('Missing computed plan after synthetic shipping update');
      }

      expect(
        formatComputedPlanSnapshot(
          computedPlan,
          buildMultiTableNameMaps([
            {
              id: shipmentsTable.id,
              name: 'SyntheticShipments',
              fields: [{ id: shipmentChannelFieldId, name: 'Channel' }],
            },
            {
              id: trackingTable.id,
              name: 'SyntheticTracking',
              fields: [{ id: trackingChannelLookupFieldId, name: 'ChannelSnapshot' }],
            },
          ])
        )
      ).toEqual({
        edgeCount: 1,
        stepCount: 1,
        steps: [
          {
            fields: ['ChannelSnapshot'],
            level: 0,
            table: 'SyntheticTracking',
          },
        ],
      });

      expect(totalUpdated).toBe(
        legacyCounts[legacyGround] + legacyCounts[legacyExpress] + legacyCounts[legacyPostal]
      );

      const shipments = await ctx.listRecords(shipmentsTable.id, {
        limit: totalRecords + 50,
      });
      const tracking = await ctx.listRecords(trackingTable.id, {
        limit: totalRecords + 50,
      });

      const shipmentCounts = countByNormalizedValue(shipments, shipmentChannelFieldId);
      const trackingCounts = countByNormalizedValue(tracking, trackingChannelLookupFieldId);

      const representativeCases = [
        {
          label: 'changed-ground',
          shipmentId: shipmentRecords[0]!.id,
          trackingId: trackingRecords[0]!.id,
          expectedChannel: carrierGround,
        },
        {
          label: 'changed-express',
          shipmentId: shipmentRecords[legacyCounts[legacyGround]]!.id,
          trackingId: trackingRecords[legacyCounts[legacyGround]]!.id,
          expectedChannel: carrierExpress,
        },
        {
          label: 'changed-postal',
          shipmentId: shipmentRecords[legacyCounts[legacyGround] + legacyCounts[legacyExpress]]!.id,
          trackingId: trackingRecords[legacyCounts[legacyGround] + legacyCounts[legacyExpress]]!.id,
          expectedChannel: carrierPostal,
        },
        {
          label: 'existing-modern-ground',
          shipmentId:
            shipmentRecords[
              legacyCounts[legacyGround] + legacyCounts[legacyExpress] + legacyCounts[legacyPostal]
            ]!.id,
          trackingId:
            trackingRecords[
              legacyCounts[legacyGround] + legacyCounts[legacyExpress] + legacyCounts[legacyPostal]
            ]!.id,
          expectedChannel: carrierGround,
        },
        {
          label: 'existing-modern-express',
          shipmentId:
            shipmentRecords[
              legacyCounts[legacyGround] +
                legacyCounts[legacyExpress] +
                legacyCounts[legacyPostal] +
                existingModernCounts[carrierGround]
            ]!.id,
          trackingId:
            trackingRecords[
              legacyCounts[legacyGround] +
                legacyCounts[legacyExpress] +
                legacyCounts[legacyPostal] +
                existingModernCounts[carrierGround]
            ]!.id,
          expectedChannel: carrierExpress,
        },
        {
          label: 'existing-modern-postal',
          shipmentId:
            shipmentRecords[
              legacyCounts[legacyGround] +
                legacyCounts[legacyExpress] +
                legacyCounts[legacyPostal] +
                existingModernCounts[carrierGround] +
                existingModernCounts[carrierExpress]
            ]!.id,
          trackingId:
            trackingRecords[
              legacyCounts[legacyGround] +
                legacyCounts[legacyExpress] +
                legacyCounts[legacyPostal] +
                existingModernCounts[carrierGround] +
                existingModernCounts[carrierExpress]
            ]!.id,
          expectedChannel: carrierPostal,
        },
      ] as const;

      for (const item of representativeCases) {
        expect(
          getFieldValueByRecordId(shipments, item.shipmentId, shipmentChannelFieldId),
          `${item.label}: source channel`
        ).toBe(item.expectedChannel);
        expect(
          normalizeLookupScalar(
            getFieldValueByRecordId(tracking, item.trackingId, trackingChannelLookupFieldId)
          ),
          `${item.label}: tracking lookup snapshot`
        ).toBe(item.expectedChannel);
      }

      expect(shipmentCounts.get(legacyGround) ?? 0).toBe(0);
      expect(shipmentCounts.get(legacyExpress) ?? 0).toBe(0);
      expect(shipmentCounts.get(legacyPostal) ?? 0).toBe(0);
      expect(shipmentCounts.get(carrierGround) ?? 0).toBe(
        legacyCounts[legacyGround] + existingModernCounts[carrierGround]
      );
      expect(shipmentCounts.get(carrierExpress) ?? 0).toBe(
        legacyCounts[legacyExpress] + existingModernCounts[carrierExpress]
      );
      expect(shipmentCounts.get(carrierPostal) ?? 0).toBe(
        legacyCounts[legacyPostal] + existingModernCounts[carrierPostal]
      );

      expect(trackingCounts.get(legacyGround) ?? 0).toBe(0);
      expect(trackingCounts.get(legacyExpress) ?? 0).toBe(0);
      expect(trackingCounts.get(legacyPostal) ?? 0).toBe(0);
      expect(trackingCounts.get(carrierGround) ?? 0).toBe(
        legacyCounts[legacyGround] + existingModernCounts[carrierGround]
      );
      expect(trackingCounts.get(carrierExpress) ?? 0).toBe(
        legacyCounts[legacyExpress] + existingModernCounts[carrierExpress]
      );
      expect(trackingCounts.get(carrierPostal) ?? 0).toBe(
        legacyCounts[legacyPostal] + existingModernCounts[carrierPostal]
      );

      expect(mutationMs).toBeLessThan(15000);
      expect(convergenceMs).toBeLessThan(15000);
    } finally {
      await deleteTableSafe(ctx, trackingTableId);
      await deleteTableSafe(ctx, shipmentsTableId);
      await deleteTableSafe(ctx, ordersTableId);
    }
  }, 120000);
});
