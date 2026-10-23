/* eslint-disable @typescript-eslint/naming-convention */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { getSharedTestContext, type SharedTestContext } from './shared/globalTestContext';

/**
 * T8023: a conditional rollup whose filter references a computed multi-value
 * field must recompute when that computed field leaves the match, not only
 * when it enters.
 *
 * Sanitized structure from the reported failure: a host row, a source table
 * with a scalar single-select, and two multi-value conditional lookups that
 * project that select through a join key. The rollup counts source rows whose
 * projected source and target values both overlap the host's expected values
 * with `hasAnyOf`. Flipping the scalar select into the match and back out must
 * restore the original count on the already-created rollup, equal to a fresh
 * rollup with the same configuration.
 */
describe('[T8023] conditional rollup recomputes when a computed filter value leaves the match', () => {
  let ctx: SharedTestContext;
  const tables: string[] = [];
  let nextId = 0;
  const id = () => `fld${(nextId++).toString(36).padStart(16, '0')}`;

  beforeAll(async () => {
    ctx = await getSharedTestContext();
  });
  afterAll(async () => {
    for (const table of tables.reverse()) await ctx.deleteTable(table);
  });

  it.each([{ exitPath: 'source' as const }, { exitPath: 'target' as const }])(
    'drops the stale count after the $exitPath select leaves the match',
    async ({ exitPath }) => {
      const choices = [
        { id: 'input', name: 'input', color: 'blue' },
        { id: 'choice', name: 'choice', color: 'green' },
        { id: 'compute', name: 'compute', color: 'yellow' },
        { id: 'failed-end', name: 'failed-end', color: 'red' },
      ];

      const nodeName = id();
      const nodeKey = id();
      const nodeType = id();
      const nodes = await ctx.createTable({
        baseId: ctx.baseId,
        name: 'T8023 Nodes',
        fields: [
          { id: nodeName, type: 'singleLineText', name: 'Name', isPrimary: true },
          { id: nodeKey, type: 'singleLineText', name: 'NodeKey' },
          { id: nodeType, type: 'singleSelect', name: 'NodeType', options: { choices } },
        ],
        views: [{ type: 'grid' }],
      });
      tables.push(nodes.id);

      const sourceNode = await ctx.createRecord(nodes.id, {
        [nodeName]: 'source-node',
        [nodeKey]: 'source-node',
        [nodeType]: 'input',
      });
      const targetNode = await ctx.createRecord(nodes.id, {
        [nodeName]: 'target-node',
        [nodeKey]: 'target-node',
        [nodeType]: 'failed-end',
      });

      const versionName = id();
      const versionKey = id();
      const expectedSource = id();
      const expectedTarget = id();
      const versions = await ctx.createTable({
        baseId: ctx.baseId,
        name: 'T8023 Versions',
        fields: [
          { id: versionName, type: 'singleLineText', name: 'Version', isPrimary: true },
          { id: versionKey, type: 'singleLineText', name: 'VersionKey' },
          {
            id: expectedSource,
            type: 'singleSelect',
            name: 'ExpectedSource',
            options: { choices },
          },
          {
            id: expectedTarget,
            type: 'singleSelect',
            name: 'ExpectedTarget',
            options: { choices },
          },
        ],
        views: [{ type: 'grid' }],
      });
      tables.push(versions.id);

      const eventName = id();
      const eventVersion = id();
      const eventSourceKey = id();
      const eventTargetKey = id();
      const sourceTypes = id();
      const targetTypes = id();
      const events = await ctx.createTable({
        baseId: ctx.baseId,
        name: 'T8023 Events',
        fields: [
          { id: eventName, type: 'singleLineText', name: 'Event', isPrimary: true },
          { id: eventVersion, type: 'singleLineText', name: 'VersionKey' },
          { id: eventSourceKey, type: 'singleLineText', name: 'SourceNodeKey' },
          { id: eventTargetKey, type: 'singleLineText', name: 'TargetNodeKey' },
          {
            id: sourceTypes,
            type: 'conditionalLookup',
            name: 'SourceTypes',
            options: {
              foreignTableId: nodes.id,
              lookupFieldId: nodeType,
              condition: {
                filter: {
                  conjunction: 'and',
                  filterSet: [
                    { fieldId: nodeKey, operator: 'is', value: eventSourceKey, isSymbol: true },
                  ],
                },
              },
            },
          },
          {
            id: targetTypes,
            type: 'conditionalLookup',
            name: 'TargetTypes',
            options: {
              foreignTableId: nodes.id,
              lookupFieldId: nodeType,
              condition: {
                filter: {
                  conjunction: 'and',
                  filterSet: [
                    { fieldId: nodeKey, operator: 'is', value: eventTargetKey, isSymbol: true },
                  ],
                },
              },
            },
          },
        ],
        views: [{ type: 'grid' }],
      });
      tables.push(events.id);

      const rollup = id();
      await ctx.createField({
        baseId: ctx.baseId,
        tableId: versions.id,
        field: {
          id: rollup,
          type: 'conditionalRollup',
          name: 'MatchingEvents',
          options: { expression: 'countall({values})' },
          config: {
            foreignTableId: events.id,
            lookupFieldId: eventName,
            condition: {
              filter: {
                conjunction: 'and',
                filterSet: [
                  { fieldId: eventVersion, operator: 'is', value: versionKey, isSymbol: true },
                  {
                    fieldId: sourceTypes,
                    operator: 'hasAnyOf',
                    value: expectedSource,
                    isSymbol: true,
                  },
                  {
                    fieldId: targetTypes,
                    operator: 'hasAnyOf',
                    value: expectedTarget,
                    isSymbol: true,
                  },
                ],
              },
            },
          },
        },
      });

      const version = await ctx.createRecord(versions.id, {
        [versionName]: 'V1',
        [versionKey]: 'V1',
        [expectedSource]: 'choice',
        [expectedTarget]: 'failed-end',
      });

      // Baseline: source node type "input" does not overlap the expected
      // source "choice", so the rollup counts nothing.
      await ctx.createRecord(events.id, {
        [eventName]: 'matching',
        [eventVersion]: 'V1',
        [eventSourceKey]: 'source-node',
        [eventTargetKey]: 'target-node',
      });
      // Noise: same version but a different target node type, never counted.
      await ctx.createRecord(events.id, {
        [eventName]: 'noise',
        [eventVersion]: 'V1',
        [eventSourceKey]: 'source-node',
        [eventTargetKey]: 'source-node',
      });
      await ctx.drainOutbox();

      const countOf = async (fieldId: string) => {
        const records = await ctx.listRecordsWithoutDrain(versions.id);
        const row = records.find((record) => record.id === version.id);
        const value = row?.fields[fieldId];
        return value == null ? 0 : Number(value);
      };

      expect(await countOf(rollup)).toBe(0);

      // Enter the match: the projected source types become ["choice"].
      await ctx.updateRecord(nodes.id, sourceNode.id, { [nodeType]: 'choice' });
      await ctx.drainOutbox();
      expect(await countOf(rollup)).toBe(1);

      // Leave the match again through the reported path.
      const leaving = exitPath === 'source' ? sourceNode : targetNode;
      const leavingField = nodeType;
      const restored = exitPath === 'source' ? 'input' : 'compute';
      await ctx.updateRecord(nodes.id, leaving.id, { [leavingField]: restored });
      await ctx.drainOutbox();
      // A rollup created against the restored data sees the true count.
      const fresh = id();
      await ctx.createField({
        baseId: ctx.baseId,
        tableId: versions.id,
        field: {
          id: fresh,
          type: 'conditionalRollup',
          name: 'MatchingEventsFresh',
          options: { expression: 'countall({values})' },
          config: {
            foreignTableId: events.id,
            lookupFieldId: eventName,
            condition: {
              filter: {
                conjunction: 'and',
                filterSet: [
                  { fieldId: eventVersion, operator: 'is', value: versionKey, isSymbol: true },
                  {
                    fieldId: sourceTypes,
                    operator: 'hasAnyOf',
                    value: expectedSource,
                    isSymbol: true,
                  },
                  {
                    fieldId: targetTypes,
                    operator: 'hasAnyOf',
                    value: expectedTarget,
                    isSymbol: true,
                  },
                ],
              },
            },
          },
        },
      });
      await ctx.drainOutbox();

      expect(await countOf(fresh)).toBe(0);
      expect(await countOf(rollup)).toBe(0);
    }
  );

  it('refreshes existing targets when an insert changes their computed filter value', async () => {
    const choices = [
      { id: 'yes', name: 'yes', color: 'green' },
      { id: 'no', name: 'no', color: 'red' },
    ];

    const itemName = id();
    const itemActive = id();
    const itemLabels = id();
    const items = await ctx.createTable({
      baseId: ctx.baseId,
      name: 'T8023 Items',
      fields: [
        { id: itemName, type: 'singleLineText', name: 'Name', isPrimary: true },
        { id: itemActive, type: 'singleSelect', name: 'Active', options: { choices } },
      ],
      views: [{ type: 'grid' }],
    });
    tables.push(items.id);

    // Same-table conditional lookup: every row aggregates the active names.
    await ctx.createField({
      baseId: ctx.baseId,
      tableId: items.id,
      field: {
        id: itemLabels,
        type: 'conditionalLookup',
        name: 'ActiveNames',
        options: {
          foreignTableId: items.id,
          lookupFieldId: itemName,
          condition: {
            filter: {
              conjunction: 'and',
              filterSet: [{ fieldId: itemActive, operator: 'is', value: 'yes' }],
            },
          },
        },
      },
    });

    const counterName = id();
    const counterExpected = id();
    const counterTotal = id();
    const counters = await ctx.createTable({
      baseId: ctx.baseId,
      name: 'T8023 Counters',
      fields: [
        { id: counterName, type: 'singleLineText', name: 'Name', isPrimary: true },
        { id: counterExpected, type: 'singleLineText', name: 'Expected' },
      ],
      views: [{ type: 'grid' }],
    });
    tables.push(counters.id);

    await ctx.createField({
      baseId: ctx.baseId,
      tableId: counters.id,
      field: {
        id: counterTotal,
        type: 'conditionalRollup',
        name: 'MatchingItems',
        options: { expression: 'countall({values})' },
        config: {
          foreignTableId: items.id,
          lookupFieldId: itemName,
          condition: {
            filter: {
              conjunction: 'and',
              filterSet: [{ fieldId: itemLabels, operator: 'isEmpty' }],
            },
          },
        },
      },
    });

    const counter = await ctx.createRecord(counters.id, {
      [counterName]: 'Counter',
      [counterExpected]: 'R',
    });
    await ctx.createRecord(items.id, { [itemName]: 'E', [itemActive]: 'no' });
    await ctx.drainOutbox();

    const totalOf = async () => {
      const records = await ctx.listRecordsWithoutDrain(counters.id);
      const row = records.find((record) => record.id === counter.id);
      const value = row?.fields[counterTotal];
      return value == null ? 0 : Number(value);
    };

    expect(await totalOf()).toBe(1);

    // The insert makes the existing row's same-table lookup change, so the
    // already-computed rollup must refresh too.
    await ctx.createRecord(items.id, { [itemName]: 'R', [itemActive]: 'yes' });
    await ctx.drainOutbox();

    const itemsAfter = await ctx.listRecordsWithoutDrain(items.id);
    expect(itemsAfter.every((record) => record.fields[itemLabels]?.[0] === 'R')).toBe(true);
    expect(await totalOf()).toBe(0);
  });
});
