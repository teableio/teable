import { mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { v2DataDbTokens, v2MetaDbTokens } from '@teable/v2-adapter-db-postgres-shared';
import { v2RecordRepositoryPostgresTokens } from '@teable/v2-adapter-table-repository-postgres';
import {
  ComputedUpdateWorker,
  type IComputedUpdateOutbox,
} from '@teable/v2-adapter-table-repository-postgres';
import {
  ActorId,
  buildRecordCollection,
  CreateBaseCommand,
  CreateFieldCommand,
  CreateRecordCommand,
  CreateTableCommand,
  ImportCsvCommand,
  ListBasesQuery,
  ListTableRecordsQuery,
  UpdateRecordCommand,
  v2CoreTokens,
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
import { sql, type Kysely } from 'kysely';
import { ok, type Result } from 'neverthrow';
import { describe, expect, it, vi } from 'vitest';

import {
  ComputedQueueSummaryUnavailableError,
  readComputedQueueSummary,
} from './computedQueueSummary';
import { createHeadlessRuntime, resolvePostgresEnsureSchema, type IHeadlessRuntime } from './index';

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

  it('reports pending and scheduled work instead of claiming an idle queue', async () => {
    const runtime = await createHeadlessRuntime({
      backend: { kind: 'pglite', dataDir: 'memory://' },
    });
    try {
      const context = createContext();
      const base = unwrap(
        await runtime.commandBus.execute<CreateBaseCommand, CreateBaseResult>(
          context,
          unwrap(CreateBaseCommand.create({ name: 'Scheduled report' }))
        )
      );
      const table = unwrap(
        await runtime.commandBus.execute<CreateTableCommand, CreateTableResult>(
          context,
          unwrap(
            CreateTableCommand.create({
              baseId: base.base.id().toString(),
              name: 'Deferred',
              fields: [
                { id: 'fldName', name: 'Name', type: 'singleLineText', isPrimary: true },
                { id: 'fldAmount', name: 'Amount', type: 'number' },
                {
                  id: 'fldDouble',
                  name: 'Double',
                  type: 'formula',
                  options: { expression: '{fldAmount} * 2' },
                },
              ],
              records: [{ fields: { fldName: 'A', fldAmount: 1 } }],
            })
          )
        )
      );
      const tableId = table.table.id().toString();
      const record = unwrap(
        await runtime.queryBus.execute<ListTableRecordsQuery, ListTableRecordsResult>(
          context,
          unwrap(ListTableRecordsQuery.create({ tableId, fieldKeyType: 'id' }))
        )
      ).records[0];
      unwrap(
        await runtime.commandBus.execute<UpdateRecordCommand, UpdateRecordResult>(
          context,
          unwrap(
            UpdateRecordCommand.create({
              tableId,
              recordId: record.id,
              fieldKeyType: 'id',
              fields: { fldAmount: 5 },
            })
          )
        )
      );
      const outbox = runtime.container.resolve<IComputedUpdateOutbox>(
        v2RecordRepositoryPostgresTokens.computedUpdateOutbox
      );
      unwrap(
        await outbox.enqueueSeedTask(
          {
            taskType: 'seed',
            baseId: base.base.id().toString(),
            seedTableId: tableId,
            seedRecordIds: [record.id],
            extraSeedRecords: [],
            beforeImageRecords: [],
            changedFieldIds: ['fldAmount'],
            changeType: 'update',
            runId: 'run_scheduled_report',
            planHash: 'plan_scheduled_report',
          },
          context
        )
      );
      const db = runtime.container.resolve<Kysely<unknown>>(v2DataDbTokens.db);
      await sql`
        update computed_update_outbox
        set next_run_at = now() + interval '1 hour'
        where status = 'pending'
      `.execute(db);
      const report = await runtime.flushComputed();
      expect(report.processed).toBe(0);
      expect(report.state).toBe('pending_work');
      expect(report.pending).toBeGreaterThan(0);
      expect(report.scheduled).toBeGreaterThan(0);
      expect(report.drained).toBe(false);
      expect(typeof report.nextRunAt).toBe('string');
    } finally {
      await expect(runtime.close()).rejects.toMatchObject({ code: 'runtime.close_incomplete' });
    }
  }, 30_000);

  it('does not leave unconsumed durable domain-event rows on PGlite', async () => {
    const runtime = await createHeadlessRuntime({
      backend: { kind: 'pglite', dataDir: 'memory://' },
    });
    try {
      const journal = runtime.container.resolve<{ constructor: { name: string } }>(
        v2CoreTokens.projectionMessageJournal
      );
      expect(journal.constructor.name).toBe('NoopProjectionMessageJournal');
      const context = createContext();
      const base = unwrap(
        await runtime.commandBus.execute<CreateBaseCommand, CreateBaseResult>(
          context,
          unwrap(CreateBaseCommand.create({ name: 'No durable rows' }))
        )
      );
      const table = unwrap(
        await runtime.commandBus.execute<CreateTableCommand, CreateTableResult>(
          context,
          unwrap(
            CreateTableCommand.create({
              baseId: base.base.id().toString(),
              name: 'Rows',
              fields: [
                { id: 'fldName', name: 'Name', type: 'singleLineText', isPrimary: true },
                { id: 'fldN', name: 'N', type: 'number' },
              ],
              records: [{ fields: { fldName: 'A', fldN: 1 } }],
            })
          )
        )
      );
      const tableId = table.table.id().toString();
      const record = unwrap(
        await runtime.queryBus.execute<ListTableRecordsQuery, ListTableRecordsResult>(
          context,
          unwrap(ListTableRecordsQuery.create({ tableId, fieldKeyType: 'id' }))
        )
      ).records[0];
      unwrap(
        await runtime.commandBus.execute<UpdateRecordCommand, UpdateRecordResult>(
          context,
          unwrap(
            UpdateRecordCommand.create({
              tableId,
              recordId: record.id,
              fieldKeyType: 'id',
              fields: { fldN: 2 },
            })
          )
        )
      );
      await runtime.flushRealtime();

      const db = runtime.container.resolve<Kysely<unknown>>(v2DataDbTokens.db);
      const rows = await sql<{ count: string }>`
        select count(*)::text as count from domain_event_outbox
      `.execute(db);
      expect(rows.rows[0]?.count).toBe('0');
      const background = await runtime.flushBackground();
      expect(background.available).toBe(false);
      expect(background.durablePending).toBe(0);
      expect(background.state).toBe('no_claimable_work');
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

  it('rejects a second persistent owner and releases the lock after attachment construction fails', async () => {
    const dataDir = await mkdtemp(join(tmpdir(), 'teable-headless-owner-'));
    try {
      const first = await createHeadlessRuntime({ backend: { kind: 'pglite', dataDir } });
      try {
        await expect(
          createHeadlessRuntime({ backend: { kind: 'pglite', dataDir } })
        ).rejects.toMatchObject({ code: 'pglite.data_dir_locked' });
      } finally {
        await first.close();
      }

      await expect(
        createHeadlessRuntime({
          backend: { kind: 'pglite', dataDir },
          attachments: () => {
            throw new Error('attachment construction failed');
          },
        })
      ).rejects.toThrow('attachment construction failed');

      const reopened = await createHeadlessRuntime({ backend: { kind: 'pglite', dataDir } });
      await reopened.close();
    } finally {
      await rm(dataDir, { recursive: true, force: true });
    }
  }, 30_000);

  it('returns closed errors after close and shares concurrent close work', async () => {
    const runtime = await createHeadlessRuntime({
      backend: { kind: 'pglite', dataDir: 'memory://' },
    });
    const first = runtime.close();
    const second = runtime.close();
    expect(second).toBe(first);
    await first;
    await expect(runtime.ready()).rejects.toMatchObject({ code: 'runtime.closed' });
    const result = await runtime.queryBus.execute(
      createContext(),
      unwrap(ListBasesQuery.create({}))
    );
    expect(result.isErr() && result.error.code).toBe('runtime.closed');
  }, 30_000);

  it('rejects new work as soon as close starts while accepted work completes before destroy', async () => {
    const runtime = await createHeadlessRuntime({
      backend: { kind: 'pglite', dataDir: 'memory://' },
    });
    const accepted = runtime.commandBus.execute<CreateBaseCommand, CreateBaseResult>(
      createContext(),
      unwrap(CreateBaseCommand.create({ name: 'Before close' }))
    );
    const closing = runtime.close();
    const late = await runtime.commandBus.execute<CreateBaseCommand, CreateBaseResult>(
      createContext(),
      unwrap(CreateBaseCommand.create({ name: 'After close' }))
    );
    expect(late.isErr() && late.error.code).toBe('runtime.closed');
    const created = unwrap(await accepted);
    expect(created.base.name().toString()).toBe('Before close');
    await closing;
  }, 30_000);

  it('drains accepted direct realtime work before destroying the database', async () => {
    const runtime = await createHeadlessRuntime({
      backend: { kind: 'pglite', dataDir: 'memory://' },
    });
    const context = createContext();
    const base = unwrap(
      await runtime.commandBus.execute<CreateBaseCommand, CreateBaseResult>(
        context,
        unwrap(CreateBaseCommand.create({ name: 'Close drain' }))
      )
    );
    const table = unwrap(
      await runtime.commandBus.execute<CreateTableCommand, CreateTableResult>(
        context,
        unwrap(
          CreateTableCommand.create({
            baseId: base.base.id().toString(),
            name: 'Drain',
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
            fields: { fldName: 'A', fldAmount: 1 },
          })
        )
      )
    );
    const recordId = record.record.id().toString();
    await runtime.commandBus.execute<UpdateRecordCommand, UpdateRecordResult>(
      context,
      unwrap(
        UpdateRecordCommand.create({
          tableId,
          recordId,
          fieldKeyType: 'id',
          fields: { fldAmount: 9 },
        })
      )
    );
    await runtime.close();
    const snapshot = runtime.realtime.getSnapshot(
      `${buildRecordCollection(tableId)}/${recordId}`
    ) as { fields?: Record<string, unknown> } | undefined;
    expect(snapshot?.fields?.fldAmount).toBe(9);
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

  it('bounds close when an accepted background projection never settles', async () => {
    const runtime = await createHeadlessRuntime({
      backend: { kind: 'pglite', dataDir: 'memory://' },
    });
    const context = createContext();
    const base = unwrap(
      await runtime.commandBus.execute<CreateBaseCommand, CreateBaseResult>(
        context,
        unwrap(CreateBaseCommand.create({ name: 'Stuck close' }))
      )
    );
    const gate = Promise.withResolvers<Result<void, never>>();
    runtime.realtime.ensure = () => gate.promise;
    unwrap(
      await runtime.commandBus.execute<CreateTableCommand, CreateTableResult>(
        context,
        unwrap(
          CreateTableCommand.create({
            baseId: base.base.id().toString(),
            name: 'Stuck',
            fields: [{ id: 'fldName', name: 'Name', type: 'singleLineText', isPrimary: true }],
            records: [{ fields: { fldName: 'A' } }],
          })
        )
      )
    );
    const startedAt = Date.now();
    await expect(runtime.close()).rejects.toMatchObject({
      code: 'runtime.close_incomplete',
      details: { timedOut: true },
    });
    expect(Date.now() - startedAt).toBeLessThan(7_000);
    gate.resolve(ok(undefined));
    await runtime.ready();
    await runtime.close();
  }, 30_000);

  it('remains usable and allows retry when a close flush fails', async () => {
    const runtime = await createHeadlessRuntime({
      backend: { kind: 'pglite', dataDir: 'memory://' },
    });
    const originalFlushComputed = runtime.flushComputed.bind(runtime);
    runtime.flushComputed = async () => {
      throw new Error('summary probe failed');
    };

    await expect(runtime.close()).rejects.toMatchObject({
      code: 'runtime.close_incomplete',
      details: { timedOut: false, cause: expect.any(Error) },
    });
    await expect(runtime.ready()).resolves.toBeUndefined();

    runtime.flushComputed = originalFlushComputed;
    await runtime.close();
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

  it('does not invent a barrier for a custom realtime engine', async () => {
    const runtime = await createHeadlessRuntime({
      backend: { kind: 'pglite', dataDir: 'memory://' },
      realtime: {
        publishAction: () => undefined,
        submit: () => Promise.resolve(ok(undefined)),
      } as never,
    });
    try {
      await expect(runtime.flushRealtime()).resolves.toEqual({ state: 'unsupported' });
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

describe('flushBackground durable report', () => {
  const insertDelivery = async (
    runtime: IHeadlessRuntime,
    delivery: { id: string; status: 'processing' | 'dead' }
  ): Promise<void> => {
    const db = runtime.container.resolve<Kysely<unknown>>(v2DataDbTokens.db);
    await db
      .insertInto('domain_event_delivery' as never)
      .values({
        id: delivery.id,
        event_id: `dev_${delivery.id}`,
        consumer_id: 'realtime',
        status: delivery.status,
        ...(delivery.status === 'processing'
          ? {
              lease_token: 'lease_fixture',
              lease_expires_at: new Date(Date.now() + 60_000),
            }
          : {}),
      } as never)
      .execute();
  };

  it('reports durable processing work instead of an idle background queue', async () => {
    const runtime = await createHeadlessRuntime({
      backend: { kind: 'pglite', dataDir: 'memory://' },
    });
    try {
      await insertDelivery(runtime, { id: 'processing-only', status: 'processing' });

      const report = await runtime.flushBackground();

      expect(report.processing).toBeGreaterThanOrEqual(1);
      expect(report.state).not.toBe('no_claimable_work');
    } finally {
      await expect(runtime.close()).rejects.toMatchObject({ code: 'runtime.close_incomplete' });
    }
  }, 30_000);

  it('reports dead-letter-only durable work with its own state', async () => {
    const runtime = await createHeadlessRuntime({
      backend: { kind: 'pglite', dataDir: 'memory://' },
    });
    try {
      await insertDelivery(runtime, { id: 'dead-only', status: 'dead' });

      const report = await runtime.flushBackground();

      expect(report.deadLetter).toBeGreaterThanOrEqual(1);
      expect(report.state).toBe('dead_letter_pending');
    } finally {
      await expect(runtime.close()).rejects.toMatchObject({ code: 'runtime.close_incomplete' });
    }
  }, 30_000);

  it('reads computed summaries from an explicit schema and rejects split space pauses', async () => {
    const runtime = await createHeadlessRuntime({
      backend: { kind: 'pglite', dataDir: 'memory://' },
    });
    const db = runtime.container.resolve<Kysely<unknown>>(v2DataDbTokens.db);
    const now = new Date('2026-10-26T00:00:00.000Z');
    try {
      await sql`create schema summary_custom`.execute(db);
      await sql`
        create table summary_custom.computed_update_outbox (
          status text not null,
          next_run_at timestamptz not null,
          base_id text not null,
          seed_table_id text not null,
          affected_table_ids text[]
        )
      `.execute(db);
      await sql`
        create table summary_custom.computed_update_pause_scope (
          scope_type text not null,
          scope_id text not null,
          resume_at timestamptz
        )
      `.execute(db);
      await sql`
        create table summary_custom.computed_update_dead_letter (id text primary key)
      `.execute(db);
      await sql`
        insert into summary_custom.computed_update_outbox
          (status, next_run_at, base_id, seed_table_id, affected_table_ids)
        values ('pending', '2026-10-26T01:00:00.000Z', 'bse_custom', 'tbl_custom', array[]::text[])
      `.execute(db);

      const summary = await readComputedQueueSummary(db, now, {
        schema: 'summary_custom',
        spacePauseResolvable: true,
      });
      expect(summary).toMatchObject({ pending: 1, scheduled: 1, deadLetter: 0 });

      await sql`
        insert into summary_custom.computed_update_pause_scope
          (scope_type, scope_id, resume_at)
        values ('space', 'spc_custom', null)
      `.execute(db);
      await expect(
        readComputedQueueSummary(db, now, {
          schema: 'summary_custom',
          spacePauseResolvable: false,
        })
      ).rejects.toBeInstanceOf(ComputedQueueSummaryUnavailableError);
      const runtimeInternals = runtime as unknown as {
        summaryOptions: { schema?: string; spacePauseResolvable?: boolean };
      };
      const originalSummaryOptions = runtimeInternals.summaryOptions;
      runtimeInternals.summaryOptions = {
        ...originalSummaryOptions,
        schema: 'missing_custom_schema',
      };
      const runOnce = vi.spyOn(
        runtime.container.resolve<ComputedUpdateWorker>(
          v2RecordRepositoryPostgresTokens.computedUpdateWorker
        ),
        'runOnce'
      );
      await expect(runtime.flushComputed()).resolves.toMatchObject({
        state: 'summary_unavailable',
        processed: 0,
      });
      expect(runOnce).not.toHaveBeenCalled();
      runtimeInternals.summaryOptions = originalSummaryOptions;
      await expect(
        readComputedQueueSummary(db, now, { schema: 'missing_custom_schema' })
      ).rejects.toBeInstanceOf(ComputedQueueSummaryUnavailableError);
    } finally {
      await runtime.close();
    }
  }, 30_000);

  it('rejects a legacy ImportCsv URL before reaching a loopback server', async () => {
    let hits = 0;
    const server = createServer((_request, response) => {
      hits += 1;
      response.end('Name\nShould not be fetched\n');
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('missing server address');
    const runtime = await createHeadlessRuntime({
      backend: { kind: 'pglite', dataDir: 'memory://' },
    });
    try {
      const context = createContext();
      const base = unwrap(
        await runtime.commandBus.execute<CreateBaseCommand, CreateBaseResult>(
          context,
          unwrap(CreateBaseCommand.create({ name: 'Import CSV SSRF' }))
        )
      );
      const command = unwrap(
        ImportCsvCommand.create({
          baseId: base.base.id().toString(),
          csvUrl: `http://127.0.0.1:${address.port}/source.csv`,
          importData: true,
          useFirstRowAsHeader: true,
        })
      );
      const result = await runtime.commandBus.execute(context, command);
      expect(result.isErr()).toBe(true);
      expect(hits).toBe(0);
    } finally {
      await runtime.close();
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve()))
      );
    }
  }, 30_000);
});
