/* eslint-disable sonarjs/no-duplicate-string */
import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { FieldKeyType, FieldType, Relationship, linkFieldOptionsSchema } from '@teable/core';
import { PrismaService } from '@teable/db-main-prisma';
import { createTable } from '@teable/openapi';
import {
  ActorId,
  v2CoreTokens,
  type ISchemaOperationRepository,
  type SchemaOperationRunnerService,
} from '@teable/v2-core';
import knex, { type Knex } from 'knex';
import { ClsService } from 'nestjs-cls';
import { vi } from 'vitest';
import type { IClsStore } from '../src/types/cls';
import { CrossSpaceLinkCleanupService } from '../src/features/table-lifecycle/cross-space-link-cleanup.service';
import { DatabaseRouter } from '../src/global/database-router.service';
import { CrossSpaceLinkConversionRecoveryService } from '../src/features/table-lifecycle/cross-space-link-conversion-recovery.service';
import { V2ContainerService } from '../src/features/v2/v2-container.service';
import { V2SchemaOperationRunnerService } from '../src/features/v2/v2-schema-operation-runner.service';
import {
  createBase,
  createField,
  createRecords,
  createSpace,
  getFields,
  getRecords,
  initApp,
  permanentDeleteSpace,
} from './utils/init-app';

const metaUrl =
  process.env.PRISMA_META_DATABASE_URL ??
  process.env.PRISMA_DATABASE_URL ??
  process.env.DATABASE_URL;
const dataUrl = process.env.BYODB_E2E_DATA_DATABASE_URL;
const describeSplit =
  process.env.FORCE_V2_ALL === 'true' &&
  dataUrl &&
  metaUrl &&
  new URL(dataUrl).host + new URL(dataUrl).pathname !==
    new URL(metaUrl).host + new URL(metaUrl).pathname
    ? describe
    : describe.skip;
const quote = (name: string) => `"${name.replaceAll('"', '""')}"`;
const qualified = (name: string) => name.split('.').map(quote).join('.');

describeSplit('Pair conversion split commit compensation (e2e)', () => {
  let app: INestApplication;
  let router: DatabaseRouter;
  let recovery: CrossSpaceLinkConversionRecoveryService;
  let prisma: PrismaService;
  let spaceId: string;
  let baseId: string;
  let data: Knex;

  beforeAll(async () => {
    data = knex({ client: 'pg', connection: dataUrl });
    ({ app } = await initApp());
    app.get(V2SchemaOperationRunnerService).onModuleDestroy();
    router = app.get(DatabaseRouter);
    recovery = app.get(CrossSpaceLinkConversionRecoveryService);
    prisma = app.get(PrismaService);
    spaceId = (
      await createSpace({
        name: 'pair-recovery',
        dataDb: { mode: 'byodb', url: dataUrl!, targetMode: 'initialize-empty' },
      })
    ).id;
    baseId = (await createBase({ spaceId, name: 'pair-recovery' })).id;
  });

  afterAll(async () => {
    await data?.destroy();
    if (spaceId) await permanentDeleteSpace(spaceId);
    await app?.close();
  });

  it('restores typed link values, dependent values and layout after data commits and metadata rolls back; crash replay is idempotent', async () => {
    const peer = (await createTable(baseId, { name: 'peer', records: [] })).data;
    const peerPrimary = peer.fields.find((field) => field.isPrimary)!;
    const peerRecord = (
      await createRecords(peer.id, {
        fieldKeyType: FieldKeyType.Id,
        records: [{ fields: { [peerPrimary.id]: 'linked title' } }],
      })
    ).records[0];
    const source = (await createTable(baseId, { name: 'source', records: [] })).data;
    const link = await createField(source.id, {
      name: 'link',
      type: FieldType.Link,
      options: { relationship: Relationship.ManyOne, foreignTableId: peer.id },
    });
    const lookup = await createField(source.id, {
      name: 'lookup',
      type: FieldType.SingleLineText,
      isLookup: true,
      lookupOptions: {
        foreignTableId: peer.id,
        linkFieldId: link.id,
        lookupFieldId: peerPrimary.id,
      },
    });
    await createRecords(source.id, {
      fieldKeyType: FieldKeyType.Id,
      records: [{ fields: { [link.id]: { id: peerRecord.id } } }],
    });
    const linkOptions = linkFieldOptionsSchema.parse(link.options);
    const symmetricId = linkOptions.symmetricFieldId!;
    const targets = [
      { tableId: source.id, fieldId: lookup.id },
      { tableId: source.id, fieldId: link.id },
      { tableId: peer.id, fieldId: symmetricId },
    ];
    const before = await getRecords(source.id, { fieldKeyType: FieldKeyType.Id });
    const beforeFields = await getFields(source.id);
    const container = await app.get(V2ContainerService).getContainerForBase(baseId);
    const repository = container.resolve<ISchemaOperationRepository>(
      v2CoreTokens.schemaOperationRepository
    );
    const runner = container.resolve<SchemaOperationRunnerService>(
      v2CoreTokens.schemaOperationRunnerService
    );
    runner.registerHandler(recovery);
    const context = { actorId: ActorId.create(globalThis.testConfig.userId)._unsafeUnwrap() };
    const linkColumn = (await prisma.field.findUniqueOrThrow({ where: { id: link.id } }))
      .dbFieldName;
    const lookupColumn = (await prisma.field.findUniqueOrThrow({ where: { id: lookup.id } }))
      .dbFieldName;
    const beforeLayout = (
      await data.raw(
        'SELECT attname, format_type(atttypid,atttypmod) AS type FROM pg_attribute WHERE attrelid=?::regclass AND attname=ANY(?::text[]) ORDER BY attname',
        [qualified(source.dbTableName), [linkColumn, lookupColumn]]
      )
    ).rows;
    const faultName = `pair_fault_${randomUUID().replaceAll('-', '')}`;
    const meta = router.metaKnex();
    const indexName = `pair_expr_${randomUUID().replaceAll('-', '')}`;
    await data.raw(
      `CREATE INDEX ${quote(indexName)} ON ${qualified(source.dbTableName)} ((${quote(linkColumn)}->>'id'))`
    );
    const beforeIndex = (
      await data.raw(
        'SELECT pg_get_indexdef(indexrelid) AS definition FROM pg_index WHERE indexrelid=?::regclass',
        [qualified(`${source.dbTableName.split('.')[0]}.${indexName}`)]
      )
    ).rows;
    // A deferred PostgreSQL trigger fails the real outer metadata COMMIT,
    // after the real native conversion data UoW has already committed.
    const compensationRoute = vi.spyOn(router, 'withDataKnexTransactionForBase');
    await meta.raw(
      `CREATE FUNCTION public.${quote(faultName)}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'injected meta COMMIT failure after data COMMIT'; END $$`
    );
    await meta.raw(
      `CREATE CONSTRAINT TRIGGER ${quote(faultName)} AFTER UPDATE ON field DEFERRABLE INITIALLY DEFERRED FOR EACH ROW WHEN (NEW.id = '${link.id.replaceAll("'", "''")}') EXECUTE FUNCTION public.${quote(faultName)}()`
    );
    try {
      await expect(
        app
          .get(ClsService<IClsStore>)
          .runWith({ user: { id: globalThis.testConfig.userId } } as IClsStore, () =>
            app.get(CrossSpaceLinkCleanupService).withConversions(baseId, targets, async () => {
              compensationRoute.mockRejectedValueOnce(
                new Error('injected process loss before compensation')
              );
            })
          )
      ).rejects.toThrow();
    } finally {
      compensationRoute.mockRestore();
      await meta.raw(`DROP TRIGGER IF EXISTS ${quote(faultName)} ON field`);
      await meta.raw(`DROP FUNCTION IF EXISTS public.${quote(faultName)}()`);
    }
    const operation = (
      await repository.list(context, {
        types: ['host.cross_space_link_conversion'],
        baseIds: [baseId],
      })
    )._unsafeUnwrap().items[0];
    expect(operation).toBeDefined();
    expect(operation.status).toBe('pending');
    // Compensating work did not run in the failed foreground. Only the
    // independently persisted receipt and native typed source tables remain.
    expect(
      (
        await data.raw(
          'SELECT attname FROM pg_attribute WHERE attrelid=?::regclass AND attname=? AND NOT attisdropped',
          [qualified(source.dbTableName), `__tmp_link_src_${link.id}`]
        )
      ).rows
    ).toHaveLength(1);
    expect((await runner.runOperation(context, operation))._unsafeUnwrap().status).toBe(
      'completed'
    );
    expect((await runner.runOperation(context, operation))._unsafeUnwrap().status).toBe(
      'completed'
    );
    expect(
      (
        await data.raw(
          'SELECT pg_get_indexdef(indexrelid) AS definition FROM pg_index WHERE indexrelid=?::regclass',
          [qualified(`${source.dbTableName.split('.')[0]}.${indexName}`)]
        )
      ).rows
    ).toEqual(beforeIndex);
    expect(
      (await getRecords(source.id, { fieldKeyType: FieldKeyType.Id })).records.map(
        ({ fields }) => fields
      )
    ).toEqual(before.records.map(({ fields }) => fields));
    expect(await getFields(source.id)).toEqual(beforeFields);
    expect(
      (
        await data.raw(
          'SELECT attname, format_type(atttypid,atttypmod) AS type FROM pg_attribute WHERE attrelid=?::regclass AND attname=ANY(?::text[]) ORDER BY attname',
          [qualified(source.dbTableName), [linkColumn, lookupColumn]]
        )
      ).rows
    ).toEqual(beforeLayout);
    // Abort the second field after the first dependent has converted. Both
    // native UoWs must roll back without leaving a backup or a text column.
    await meta.raw(
      `CREATE FUNCTION public.${quote(faultName)}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'injected partial conversion failure'; END $$`
    );
    await meta.raw(
      `CREATE TRIGGER ${quote(faultName)} BEFORE UPDATE ON field FOR EACH ROW WHEN (NEW.id = '${link.id.replaceAll("'", "''")}') EXECUTE FUNCTION public.${quote(faultName)}()`
    );
    const partialWork = vi.fn(async () => undefined);
    try {
      await expect(
        app
          .get(ClsService<IClsStore>)
          .runWith({ user: { id: globalThis.testConfig.userId } } as IClsStore, () =>
            app.get(CrossSpaceLinkCleanupService).withConversions(baseId, targets, partialWork)
          )
      ).rejects.toThrow();
    } finally {
      await meta.raw(`DROP TRIGGER IF EXISTS ${quote(faultName)} ON field`);
      await meta.raw(`DROP FUNCTION IF EXISTS public.${quote(faultName)}()`);
    }
    expect(partialWork).not.toHaveBeenCalled();
    expect(
      (await getRecords(source.id, { fieldKeyType: FieldKeyType.Id })).records.map(
        ({ fields }) => fields
      )
    ).toEqual(before.records.map(({ fields }) => fields));
    expect(await getFields(source.id)).toEqual(beforeFields);
    expect(
      (
        await data.raw(
          'SELECT attname, format_type(atttypid,atttypmod) AS type FROM pg_attribute WHERE attrelid=?::regclass AND attname=ANY(?::text[]) ORDER BY attname',
          [qualified(source.dbTableName), [linkColumn, lookupColumn]]
        )
      ).rows
    ).toEqual(beforeLayout);
    // Commit genuine metadata and data, then fail the cleanup route once.
    // The foreground succeeds and preserves sources until runner replay can
    // classify the committed plain-text metadata and finalize idempotently.
    const route = vi.spyOn(router, 'withDataKnexTransactionForBase');
    try {
      await app
        .get(ClsService<IClsStore>)
        .runWith({ user: { id: globalThis.testConfig.userId } } as IClsStore, () =>
          app.get(CrossSpaceLinkCleanupService).withConversions(baseId, targets, async () => {
            route.mockRejectedValueOnce(new Error('injected post-commit cleanup route failure'));
          })
        );
    } finally {
      route.mockRestore();
    }
    const pending = (
      await repository.list(context, {
        types: ['host.cross_space_link_conversion'],
        baseIds: [baseId],
        statuses: ['pending', 'running', 'error'],
      })
    )._unsafeUnwrap().items;
    expect(pending).toHaveLength(1);
    const payload = pending[0].payload;
    expect(payload).toMatchObject({ version: 1 });
    expect(
      (
        await data.raw(
          'SELECT attname FROM pg_attribute WHERE attrelid=?::regclass AND attname=? AND NOT attisdropped',
          [qualified(source.dbTableName), `__tmp_link_src_${link.id}`]
        )
      ).rows
    ).toHaveLength(1);
    const committedFields = await getFields(source.id);
    for (const fieldId of [link.id, lookup.id]) {
      const converted = committedFields.find(({ id }) => id === fieldId);
      expect(converted?.type).toBe(FieldType.SingleLineText);
      expect(converted?.isLookup).toBeFalsy();
    }
    const committed = await getRecords(source.id, { fieldKeyType: FieldKeyType.Id });
    expect(committed.records[0].fields[link.id]).toBe('linked title');
    expect(committed.records[0].fields[lookup.id]).toBe('linked title');
    expect((await runner.runOperation(context, pending[0]))._unsafeUnwrap().status).toBe(
      'completed'
    );
    expect((await runner.runOperation(context, pending[0]))._unsafeUnwrap().status).toBe(
      'completed'
    );
    expect(
      (await getRecords(source.id, { fieldKeyType: FieldKeyType.Id })).records.map(
        ({ fields }) => fields
      )
    ).toEqual(committed.records.map(({ fields }) => fields));
    expect(
      (
        await data.raw(
          'SELECT attname FROM pg_attribute WHERE attrelid=?::regclass AND attname=? AND NOT attisdropped',
          [qualified(source.dbTableName), `__tmp_link_src_${link.id}`]
        )
      ).rows
    ).toHaveLength(0);
  });
});
