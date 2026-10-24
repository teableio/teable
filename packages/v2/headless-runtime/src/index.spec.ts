import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { v2MetaDbTokens } from '@teable/v2-adapter-db-postgres-shared';
import {
  ActorId,
  buildRecordCollection,
  CreateBaseCommand,
  CreateFieldCommand,
  CreateRecordCommand,
  CreateTableCommand,
  ListBasesQuery,
  ListTableRecordsQuery,
  UpdateRecordCommand,
  type AttachmentItem,
  type CreateBaseResult,
  type CreateFieldResult,
  type CreateRecordResult,
  type CreateTableResult,
  type ListBasesResult,
  type ListTableRecordsResult,
  type UpdateRecordResult,
} from '@teable/v2-core';
import { LocalAttachmentStore } from '@teable/v2-local-attachments';
import type { Kysely } from 'kysely';
import type { Result } from 'neverthrow';
import { describe, expect, it } from 'vitest';

import { createHeadlessRuntime, resolvePostgresEnsureSchema } from './index';

const unwrap = <T, E>(result: Result<T, E>): T => {
  if (result.isErr()) {
    throw new Error(String(result.error));
  }
  return result.value;
};

const createContext = () => {
  const actorId = unwrap(ActorId.create('usr_headless'));
  return { actorId };
};

describe('createHeadlessRuntime', () => {
  it('creates and lists a base on a PGlite backend, then closes idempotently', async () => {
    const runtime = await createHeadlessRuntime({
      backend: { kind: 'pglite', dataDir: 'memory://' },
    });

    try {
      const context = createContext();
      const created = unwrap(
        await runtime.commandBus.execute<CreateBaseCommand, CreateBaseResult>(
          context,
          unwrap(CreateBaseCommand.create({ name: 'Headless base' }))
        )
      );
      expect(created.base.name().toString()).toBe('Headless base');

      const listed = unwrap(
        await runtime.queryBus.execute<ListBasesQuery, ListBasesResult>(
          context,
          unwrap(ListBasesQuery.create({}))
        )
      );
      expect(listed.bases.map((base) => base.name().toString())).toContain('Headless base');
    } finally {
      await runtime.close();
    }

    await runtime.close();
  }, 30_000);

  it('recomputes a formula after a record update', async () => {
    const runtime = await createHeadlessRuntime({
      backend: { kind: 'pglite', dataDir: 'memory://' },
    });

    try {
      const context = createContext();
      const base = unwrap(
        await runtime.commandBus.execute<CreateBaseCommand, CreateBaseResult>(
          context,
          unwrap(CreateBaseCommand.create({ name: 'Headless base' }))
        )
      );
      const table = unwrap(
        await runtime.commandBus.execute<CreateTableCommand, CreateTableResult>(
          context,
          unwrap(
            CreateTableCommand.create({
              baseId: base.base.id().toString(),
              name: 'Budget',
              fields: [
                { id: 'fldName', name: 'Name', type: 'singleLineText', isPrimary: true },
                { id: 'fldAmount', name: 'Amount', type: 'number' },
                {
                  id: 'fldTotal',
                  name: 'Total',
                  type: 'formula',
                  options: { expression: '{fldAmount} * 2' },
                },
              ],
              records: [{ fields: { fldName: 'Jan', fldAmount: 12000 } }],
            })
          )
        )
      );
      const tableId = table.table.id().toString();

      const before = unwrap(
        await runtime.queryBus.execute<ListTableRecordsQuery, ListTableRecordsResult>(
          context,
          unwrap(ListTableRecordsQuery.create({ tableId, fieldKeyType: 'id' }))
        )
      );
      const record = before.records[0];
      expect(record.fields.fldTotal).toBe(24000);

      unwrap(
        await runtime.commandBus.execute<UpdateRecordCommand, UpdateRecordResult>(
          context,
          unwrap(
            UpdateRecordCommand.create({
              tableId,
              recordId: record.id,
              fieldKeyType: 'id',
              fields: { fldAmount: 20000 },
            })
          )
        )
      );
      await runtime.flushComputed();

      const after = unwrap(
        await runtime.queryBus.execute<ListTableRecordsQuery, ListTableRecordsResult>(
          context,
          unwrap(ListTableRecordsQuery.create({ tableId, fieldKeyType: 'id' }))
        )
      );
      expect(after.records[0].fields.fldTotal).toBe(40000);
    } finally {
      await runtime.close();
    }
  }, 30_000);

  it('computes lookup and rollup across linked tables', async () => {
    const runtime = await createHeadlessRuntime({
      backend: { kind: 'pglite', dataDir: 'memory://' },
    });

    try {
      const context = createContext();
      const base = unwrap(
        await runtime.commandBus.execute<CreateBaseCommand, CreateBaseResult>(
          context,
          unwrap(CreateBaseCommand.create({ name: 'Headless base' }))
        )
      );
      const baseId = base.base.id().toString();

      const customers = unwrap(
        await runtime.commandBus.execute<CreateTableCommand, CreateTableResult>(
          context,
          unwrap(
            CreateTableCommand.create({
              baseId,
              name: 'Customers',
              fields: [
                { id: 'fldCustomerName', name: 'Name', type: 'singleLineText', isPrimary: true },
              ],
            })
          )
        )
      );
      const customersId = customers.table.id().toString();

      const customer = unwrap(
        await runtime.commandBus.execute<CreateRecordCommand, CreateRecordResult>(
          context,
          unwrap(
            CreateRecordCommand.create({
              tableId: customersId,
              fieldKeyType: 'id',
              fields: { fldCustomerName: 'Acme' },
            })
          )
        )
      );
      const customerId = customer.record.id().toString();

      const orders = unwrap(
        await runtime.commandBus.execute<CreateTableCommand, CreateTableResult>(
          context,
          unwrap(
            CreateTableCommand.create({
              baseId,
              name: 'Orders',
              fields: [
                { id: 'fldOrderName', name: 'Order', type: 'singleLineText', isPrimary: true },
                { id: 'fldAmount', name: 'Amount', type: 'number' },
                {
                  id: 'fldCustomer',
                  name: 'Customer',
                  type: 'link',
                  options: {
                    relationship: 'manyOne',
                    foreignTableId: customersId,
                    lookupFieldId: 'fldCustomerName',
                    isOneWay: true,
                  },
                },
              ],
            })
          )
        )
      );
      const ordersId = orders.table.id().toString();

      unwrap(
        await runtime.commandBus.execute<CreateFieldCommand, CreateFieldResult>(
          context,
          unwrap(
            CreateFieldCommand.create({
              baseId,
              tableId: ordersId,
              field: {
                id: 'fldCustomerNameLookup',
                name: 'Customer Name',
                type: 'lookup',
                options: {
                  linkFieldId: 'fldCustomer',
                  foreignTableId: customersId,
                  lookupFieldId: 'fldCustomerName',
                },
              },
            })
          )
        )
      );

      unwrap(
        await runtime.commandBus.execute<CreateFieldCommand, CreateFieldResult>(
          context,
          unwrap(
            CreateFieldCommand.create({
              baseId,
              tableId: customersId,
              field: {
                id: 'fldOrders',
                name: 'Orders',
                type: 'link',
                options: {
                  relationship: 'manyMany',
                  foreignTableId: ordersId,
                  lookupFieldId: 'fldOrderName',
                  isOneWay: true,
                },
              },
            })
          )
        )
      );

      unwrap(
        await runtime.commandBus.execute<CreateFieldCommand, CreateFieldResult>(
          context,
          unwrap(
            CreateFieldCommand.create({
              baseId,
              tableId: customersId,
              field: {
                id: 'fldOrderTotal',
                name: 'Order Total',
                type: 'rollup',
                options: { expression: 'sum({values})' },
                config: {
                  linkFieldId: 'fldOrders',
                  foreignTableId: ordersId,
                  lookupFieldId: 'fldAmount',
                },
              },
            })
          )
        )
      );

      const order1 = unwrap(
        await runtime.commandBus.execute<CreateRecordCommand, CreateRecordResult>(
          context,
          unwrap(
            CreateRecordCommand.create({
              tableId: ordersId,
              fieldKeyType: 'id',
              fields: {
                fldOrderName: 'Order 1',
                fldAmount: 12000,
                fldCustomer: { id: customerId, title: 'Acme' },
              },
            })
          )
        )
      );
      const order2 = unwrap(
        await runtime.commandBus.execute<CreateRecordCommand, CreateRecordResult>(
          context,
          unwrap(
            CreateRecordCommand.create({
              tableId: ordersId,
              fieldKeyType: 'id',
              fields: {
                fldOrderName: 'Order 2',
                fldAmount: 15000,
                fldCustomer: { id: customerId, title: 'Acme' },
              },
            })
          )
        )
      );

      unwrap(
        await runtime.commandBus.execute<UpdateRecordCommand, UpdateRecordResult>(
          context,
          unwrap(
            UpdateRecordCommand.create({
              tableId: customersId,
              recordId: customerId,
              fieldKeyType: 'id',
              fields: {
                fldOrders: [
                  { id: order1.record.id().toString(), title: 'Order 1' },
                  { id: order2.record.id().toString(), title: 'Order 2' },
                ],
              },
            })
          )
        )
      );
      await runtime.flushComputed();

      const ordersAfter = unwrap(
        await runtime.queryBus.execute<ListTableRecordsQuery, ListTableRecordsResult>(
          context,
          unwrap(ListTableRecordsQuery.create({ tableId: ordersId, fieldKeyType: 'id' }))
        )
      );
      expect(ordersAfter.records[0].fields.fldCustomerNameLookup).toEqual(['Acme']);

      const customersAfter = unwrap(
        await runtime.queryBus.execute<ListTableRecordsQuery, ListTableRecordsResult>(
          context,
          unwrap(ListTableRecordsQuery.create({ tableId: customersId, fieldKeyType: 'id' }))
        )
      );
      expect(Number(customersAfter.records[0].fields.fldOrderTotal)).toBe(27000);

      unwrap(
        await runtime.commandBus.execute<UpdateRecordCommand, UpdateRecordResult>(
          context,
          unwrap(
            UpdateRecordCommand.create({
              tableId: ordersId,
              recordId: order1.record.id().toString(),
              fieldKeyType: 'id',
              fields: { fldAmount: 20000 },
            })
          )
        )
      );
      await runtime.flushComputed();

      const customersUpdated = unwrap(
        await runtime.queryBus.execute<ListTableRecordsQuery, ListTableRecordsResult>(
          context,
          unwrap(ListTableRecordsQuery.create({ tableId: customersId, fieldKeyType: 'id' }))
        )
      );
      expect(Number(customersUpdated.records[0].fields.fldOrderTotal)).toBe(35000);
    } finally {
      await runtime.close();
    }
  }, 30_000);
  it('reopens a persistent PGlite directory', async () => {
    const dataDir = await mkdtemp(join(tmpdir(), 'teable-headless-'));

    try {
      const first = await createHeadlessRuntime({
        backend: { kind: 'pglite', dataDir },
      });
      let baseId: string;
      try {
        const context = createContext();
        const created = unwrap(
          await first.commandBus.execute<CreateBaseCommand, CreateBaseResult>(
            context,
            unwrap(CreateBaseCommand.create({ name: 'Persisted base' }))
          )
        );
        baseId = created.base.id().toString();
      } finally {
        await first.close();
      }

      const second = await createHeadlessRuntime({
        backend: { kind: 'pglite', dataDir },
      });
      try {
        const context = createContext();
        const listed = unwrap(
          await second.queryBus.execute<ListBasesQuery, ListBasesResult>(
            context,
            unwrap(ListBasesQuery.create({}))
          )
        );
        expect(listed.bases.map((base) => base.id().toString())).toContain(baseId);
      } finally {
        await second.close();
      }
    } finally {
      await rm(dataDir, { recursive: true, force: true });
    }
  }, 30_000);

  it('stores an attachment and persists it in a record field', async () => {
    const attachmentDir = await mkdtemp(join(tmpdir(), 'teable-headless-attachments-'));
    const runtime = await createHeadlessRuntime({
      backend: { kind: 'pglite', dataDir: 'memory://' },
      attachments: ({ container }) =>
        new LocalAttachmentStore({
          db: container.resolve<Kysely<unknown>>(v2MetaDbTokens.db),
          rootDir: attachmentDir,
          actorId: 'usr_headless',
        }),
    });

    try {
      const attachments = runtime.attachments;
      expect(attachments).toBeDefined();
      if (!attachments) {
        throw new Error('Expected an attachment store');
      }

      const context = createContext();
      const base = unwrap(
        await runtime.commandBus.execute<CreateBaseCommand, CreateBaseResult>(
          context,
          unwrap(CreateBaseCommand.create({ name: 'Headless base' }))
        )
      );
      const table = unwrap(
        await runtime.commandBus.execute<CreateTableCommand, CreateTableResult>(
          context,
          unwrap(
            CreateTableCommand.create({
              baseId: base.base.id().toString(),
              name: 'Files',
              fields: [
                { id: 'fldName', name: 'Name', type: 'singleLineText', isPrimary: true },
                { id: 'fldFile', name: 'File', type: 'attachment' },
              ],
            })
          )
        )
      );
      const tableId = table.table.id().toString();

      const data = new TextEncoder().encode('receipt');
      const item = await attachments.put({
        name: 'receipt.txt',
        mimetype: 'text/plain',
        data,
      });

      unwrap(
        await runtime.commandBus.execute<CreateRecordCommand, CreateRecordResult>(
          context,
          unwrap(
            CreateRecordCommand.create({
              tableId,
              fieldKeyType: 'id',
              fields: { fldName: 'Acme', fldFile: [item] },
            })
          )
        )
      );

      const listed = unwrap(
        await runtime.queryBus.execute<ListTableRecordsQuery, ListTableRecordsResult>(
          context,
          unwrap(ListTableRecordsQuery.create({ tableId, fieldKeyType: 'id' }))
        )
      );
      const stored = listed.records[0].fields.fldFile as AttachmentItem[];
      expect(stored).toHaveLength(1);
      expect(stored[0].token).toBe(item.token);
      expect(stored[0].name).toBe('receipt.txt');
      expect(new TextDecoder().decode(await attachments.read(item.token))).toBe('receipt');
    } finally {
      await runtime.close();
      await rm(attachmentDir, { recursive: true, force: true });
    }
  }, 30_000);

  it('publishes record snapshots through the local realtime engine', async () => {
    const runtime = await createHeadlessRuntime({
      backend: { kind: 'pglite', dataDir: 'memory://' },
    });

    try {
      const context = createContext();
      const base = unwrap(
        await runtime.commandBus.execute<CreateBaseCommand, CreateBaseResult>(
          context,
          unwrap(CreateBaseCommand.create({ name: 'Headless base' }))
        )
      );
      const table = unwrap(
        await runtime.commandBus.execute<CreateTableCommand, CreateTableResult>(
          context,
          unwrap(
            CreateTableCommand.create({
              baseId: base.base.id().toString(),
              name: 'Realtime',
              fields: [
                { id: 'fldName', name: 'Name', type: 'singleLineText', isPrimary: true },
                { id: 'fldAmount', name: 'Amount', type: 'number' },
              ],
            })
          )
        )
      );
      const tableId = table.table.id().toString();
      const record = unwrap(
        await runtime.commandBus.execute<CreateRecordCommand, CreateRecordResult>(
          context,
          unwrap(
            CreateRecordCommand.create({
              tableId,
              fieldKeyType: 'id',
              fields: { fldName: 'Realtime', fldAmount: 12000 },
            })
          )
        )
      );
      const recordId = record.record.id().toString();
      const docId = `${buildRecordCollection(tableId)}/${recordId}`;

      await runtime.flushRealtime();
      const created = runtime.realtime.getSnapshot(docId) as
        | { id: string; fields: Record<string, unknown> }
        | undefined;
      expect(created?.id).toBe(recordId);
      expect(created?.fields.fldName).toBe('Realtime');

      const snapshots: unknown[] = [];
      runtime.realtime.subscribeDoc(docId, (snapshot) => snapshots.push(snapshot));

      unwrap(
        await runtime.commandBus.execute<UpdateRecordCommand, UpdateRecordResult>(
          context,
          unwrap(
            UpdateRecordCommand.create({
              tableId,
              recordId,
              fieldKeyType: 'id',
              fields: { fldAmount: 20000 },
            })
          )
        )
      );
      await runtime.flushRealtime();

      const updated = snapshots.at(-1) as { fields?: Record<string, unknown> } | undefined;
      expect(updated?.fields?.fldAmount).toBe(20000);
    } finally {
      await runtime.close();
    }
  }, 30_000);

  it('enforces local table row limits', async () => {
    const runtime = await createHeadlessRuntime({
      backend: {
        kind: 'pglite',
        dataDir: 'memory://',
        tableDataSafetyLimits: { tableSchema: { maxRowsPerTable: 1 } },
      },
    });

    try {
      const context = createContext();
      const base = unwrap(
        await runtime.commandBus.execute<CreateBaseCommand, CreateBaseResult>(
          context,
          unwrap(CreateBaseCommand.create({ name: 'Headless base' }))
        )
      );
      const table = unwrap(
        await runtime.commandBus.execute<CreateTableCommand, CreateTableResult>(
          context,
          unwrap(
            CreateTableCommand.create({
              baseId: base.base.id().toString(),
              name: 'Limited',
              fields: [{ id: 'fldName', name: 'Name', type: 'singleLineText', isPrimary: true }],
            })
          )
        )
      );
      const tableId = table.table.id().toString();

      unwrap(
        await runtime.commandBus.execute<CreateRecordCommand, CreateRecordResult>(
          context,
          unwrap(
            CreateRecordCommand.create({
              tableId,
              fieldKeyType: 'id',
              fields: { fldName: 'First' },
            })
          )
        )
      );

      const second = await runtime.commandBus.execute<CreateRecordCommand, CreateRecordResult>(
        context,
        unwrap(
          CreateRecordCommand.create({
            tableId,
            fieldKeyType: 'id',
            fields: { fldName: 'Second' },
          })
        )
      );
      expect(second.isErr()).toBe(true);
    } finally {
      await runtime.close();
    }
  }, 30_000);
});

describe('resolvePostgresEnsureSchema', () => {
  it('provisions the schema when bootstrap is on and ensureSchema is unset', () => {
    expect(resolvePostgresEnsureSchema({ bootstrap: true })).toBe(true);
  });

  it('leaves a shared database untouched when bootstrap is off', () => {
    expect(resolvePostgresEnsureSchema({})).toBeUndefined();
    expect(resolvePostgresEnsureSchema({ bootstrap: false })).toBeUndefined();
  });

  it('honours an explicit ensureSchema over the bootstrap default', () => {
    expect(resolvePostgresEnsureSchema({ bootstrap: false, ensureSchema: true })).toBe(true);
    expect(resolvePostgresEnsureSchema({ bootstrap: true, ensureSchema: false })).toBe(false);
  });
});
