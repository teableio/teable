/* eslint-disable @typescript-eslint/naming-convention */
import type { ConvergenceHarness, ConvergenceTable, ExpectedRow } from './computedConvergence';

export type SourceInput = { slot: number; key: string; label: string; amount: number };
export type ConvergenceOperation =
  | { kind: 'put'; source: SourceInput }
  | { kind: 'delete'; slot: number }
  | { kind: 'relink'; order: number | null }
  | { kind: 'drain' };
export type ConvergenceScenario = {
  depth: number;
  fanout: number;
  initial: SourceInput[];
  operations: ConvergenceOperation[];
};

/** A deliberately small reference domain: equality matches, ordered labels, sums and integer arithmetic. */
export const runConvergenceScenario = async (
  h: ConvergenceHarness,
  scenario: ConvergenceScenario
) => {
  const { fieldId } = h;
  const sourceFields = {
    label: fieldId(),
    key: fieldId(),
    amount: fieldId(),
    decorated: fieldId(),
    doubled: fieldId(),
  };
  const sources = await h.createTable('Sources', [
    { id: sourceFields.label, name: 'Label', type: 'singleLineText', isPrimary: true },
    { id: sourceFields.key, name: 'Key', type: 'singleLineText' },
    { id: sourceFields.amount, name: 'Amount', type: 'number' },
    {
      id: sourceFields.decorated,
      name: 'Decorated',
      type: 'formula',
      options: { expression: `CONCATENATE({${sourceFields.label}}, "!")` },
    },
    {
      id: sourceFields.doubled,
      name: 'Doubled',
      type: 'formula',
      options: { expression: `{${sourceFields.amount}} * 2` },
    },
  ]);
  const createConsumer = async (name: string) => {
    const fields = {
      key: fieldId(),
      names: fieldId(),
      sum: fieldId(),
      joined: fieldId(),
      summary: fieldId(),
    };
    const levels = Array.from({ length: scenario.depth }, () => fieldId());
    const condition = {
      filter: {
        conjunction: 'and',
        filterSet: [
          { fieldId: sourceFields.key, operator: 'is', value: fields.key, isSymbol: true },
        ],
      },
      sort: { fieldId: sourceFields.label, order: 'asc' },
    };
    const table = await h.createTable(name, [
      { id: fields.key, name: 'Key', type: 'singleLineText', isPrimary: true },
      {
        id: fields.names,
        name: 'Names',
        type: 'conditionalLookup',
        options: { foreignTableId: sources.id, lookupFieldId: sourceFields.decorated, condition },
      },
      {
        id: fields.sum,
        name: 'Sum',
        type: 'conditionalRollup',
        options: { expression: 'sum({values})' },
        config: { foreignTableId: sources.id, lookupFieldId: sourceFields.doubled, condition },
      },
      {
        id: fields.joined,
        name: 'Joined',
        type: 'formula',
        options: {
          expression: `IF(COUNTA({${fields.names}}) > 0, ARRAYJOIN({${fields.names}}, ","), BLANK())`,
        },
      },
      ...levels.map((id, index) => ({
        id,
        name: `Level${index}`,
        type: 'formula',
        options: { expression: `{${index ? levels[index - 1] : fields.sum}} + ${index + 1}` },
      })),
      {
        id: fields.summary,
        name: 'Summary',
        type: 'formula',
        options: {
          expression: `CONCATENATE({${fields.joined}}, ":", {${levels[levels.length - 1]}})`,
        },
      },
    ]);
    const rows: { id: string; key: string }[] = [];
    // A and B exercise fan-out; Z is an unrelated record checked at every checkpoint.
    for (const key of [
      ...Array.from({ length: scenario.fanout }, (_, i) => (i % 2 ? 'B' : 'A')),
      'Z',
    ]) {
      rows.push({ id: await h.createRecord(table, { [fields.key]: key }), key });
    }
    return { table, fields, levels, rows };
  };
  const orders = await createConsumer('Orders');
  // The independent sibling keeps the INSERT continuation above the floor/ledger fallback.
  const peer = await createConsumer('Peer');
  const witnessFields = { name: fieldId(), link: fieldId(), lookup: fieldId(), display: fieldId() };
  const witness = await h.createTable('Linked witness', [
    { id: witnessFields.name, name: 'Name', type: 'singleLineText', isPrimary: true },
    {
      id: witnessFields.link,
      name: 'Orders',
      type: 'link',
      options: {
        relationship: 'manyMany',
        foreignTableId: orders.table.id,
        lookupFieldId: orders.fields.key,
        isOneWay: true,
      },
    },
    {
      id: witnessFields.lookup,
      name: 'Summaries',
      type: 'lookup',
      options: {
        linkFieldId: witnessFields.link,
        foreignTableId: orders.table.id,
        lookupFieldId: orders.fields.summary,
      },
    },
    {
      id: witnessFields.display,
      name: 'Display',
      type: 'formula',
      options: { expression: `CONCATENATE(ARRAYJOIN({${witnessFields.lookup}}, ","), "#")` },
    },
  ]);
  let linkedOrder: number | null = 0;
  const witnessId = await h.createRecord(witness, {
    [witnessFields.name]: 'Witness',
    [witnessFields.link]: [{ id: orders.rows[0].id }],
  });
  const state = new Map<number, SourceInput & { id: string }>();
  const put = async (source: SourceInput) => {
    const previous = state.get(source.slot);
    const cells = {
      [sourceFields.label]: source.label,
      [sourceFields.key]: source.key,
      [sourceFields.amount]: source.amount,
    };
    const id = previous?.id ?? (await h.createRecord(sources, cells));
    if (previous) await h.updateRecord(sources, id, cells);
    state.set(source.slot, { ...source, id });
  };
  // All expectations are derived from command inputs, never from stored/computed outputs or plans.
  const expectedConsumer = (consumer: typeof orders): ExpectedRow[] =>
    consumer.rows.map(({ id, key }) => {
      const matching = [...state.values()]
        .filter((source) => source.key === key)
        .sort((a, b) => (a.label < b.label ? -1 : a.label > b.label ? 1 : 0));
      const names = matching.map((source) => `${source.label}!`);
      const sum = matching.reduce((total, source) => total + source.amount * 2, 0);
      let value = sum;
      const cells: Record<string, unknown> = {
        [consumer.fields.key]: key,
        [consumer.fields.names]: names.length ? names : null,
        [consumer.fields.sum]: sum,
        [consumer.fields.joined]: names.length ? names.join(',') : null,
      };
      consumer.levels.forEach((id, index) => {
        value += index + 1;
        cells[id] = value;
      });
      cells[consumer.fields.summary] = `${names.join(',')}:${value}`;
      return { id, cells };
    });
  const verify = async (checkpoint: string) => {
    await h.drain();
    await h.assertStored(
      sources,
      [...state.values()].map((source) => ({
        id: source.id,
        cells: {
          [sourceFields.label]: source.label || null,
          [sourceFields.key]: source.key,
          [sourceFields.amount]: source.amount,
          [sourceFields.decorated]: `${source.label}!`,
          [sourceFields.doubled]: source.amount * 2,
        },
      })),
      checkpoint
    );
    const expectedOrders = expectedConsumer(orders);
    await h.assertStored(orders.table, expectedOrders, checkpoint);
    await h.assertStored(peer.table, expectedConsumer(peer), checkpoint);
    const summary =
      linkedOrder === null ? null : expectedOrders[linkedOrder].cells[orders.fields.summary];
    await h.assertStored(
      witness,
      [
        {
          id: witnessId,
          cells: {
            [witnessFields.name]: 'Witness',
            [witnessFields.link]:
              linkedOrder === null
                ? null
                : [{ id: orders.rows[linkedOrder].id, title: orders.rows[linkedOrder].key }],
            [witnessFields.lookup]: summary === null ? null : [summary],
            [witnessFields.display]: `${summary ?? ''}#`,
          },
        },
      ],
      checkpoint
    );
  };
  for (const source of scenario.initial) await put(source);
  await verify('initial');
  for (const [index, operation] of scenario.operations.entries()) {
    switch (operation.kind) {
      case 'put':
        await put(operation.source);
        break;
      case 'delete': {
        const previous = state.get(operation.slot);
        if (previous) {
          await h.deleteRecord(sources, previous.id);
          state.delete(operation.slot);
        }
        break;
      }
      case 'relink': {
        linkedOrder = operation.order === null ? null : operation.order % orders.rows.length;
        await h.updateRecord(witness, witnessId, {
          [witnessFields.link]: linkedOrder === null ? null : [{ id: orders.rows[linkedOrder].id }],
        });
        break;
      }
      case 'drain':
        await verify(`operation ${index}`);
        break;
    }
  }
  await verify('final');
};

/** Self-links have distinct reachability from cross-table equality edges. */
export const runSelfLinkScenario = async (h: ConvergenceHarness) => {
  const { fieldId } = h;
  const fields = { name: fieldId(), link: fieldId(), lookup: fieldId(), display: fieldId() };
  const table: ConvergenceTable = await h.createTable('Self links', [
    { id: fields.name, name: 'Name', type: 'singleLineText', isPrimary: true },
  ]);
  await h.createField(table, {
    id: fields.link,
    name: 'Parents',
    type: 'link',
    options: {
      relationship: 'manyMany',
      foreignTableId: table.id,
      lookupFieldId: fields.name,
      isOneWay: true,
    },
  });
  await h.createField(table, {
    id: fields.lookup,
    name: 'Parent names',
    type: 'lookup',
    options: { linkFieldId: fields.link, foreignTableId: table.id, lookupFieldId: fields.name },
  });
  await h.createField(table, {
    id: fields.display,
    name: 'Display',
    type: 'formula',
    options: { expression: `CONCATENATE(ARRAYJOIN({${fields.lookup}}, ","), "!")` },
  });
  const rows: { id: string; name: string; parent: number | null }[] = [];
  for (const parent of [null, 0, 0, 0, 1, null]) {
    const name = `N${rows.length}`;
    rows.push({
      name,
      parent,
      id: await h.createRecord(table, {
        [fields.name]: name,
        ...(parent === null ? {} : { [fields.link]: [{ id: rows[parent].id }] }),
      }),
    });
  }
  const verify = async (checkpoint: string) => {
    await h.drain();
    await h.assertStored(
      table,
      rows.map((row) => {
        const parentName = row.parent === null ? null : rows[row.parent].name;
        return {
          id: row.id,
          cells: {
            [fields.name]: row.name,
            [fields.link]:
              row.parent === null ? null : [{ id: rows[row.parent].id, title: parentName }],
            [fields.lookup]: parentName === null ? null : [parentName],
            [fields.display]: `${parentName ?? ''}!`,
          },
        };
      }),
      checkpoint
    );
  };
  await verify('self initial');
  await h.updateRecord(table, rows[0].id, { [fields.name]: 'Updated' });
  rows[0].name = 'Updated';
  await h.updateRecord(table, rows[2].id, { [fields.link]: [{ id: rows[1].id }] });
  rows[2].parent = 1;
  await h.updateRecord(table, rows[3].id, { [fields.link]: null });
  rows[3].parent = null;
  await verify('self rename/relink/clear');
};
