import { mkdtemp, readdir, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  ActorId,
  CreateBaseCommand,
  CreateFieldCommand,
  CreateTableCommand,
  FieldKeyType,
  RestoreRecordsCommand,
  UpdateRecordsCommand,
  type CreateBaseResult,
  type CreateFieldResult,
  type CreateTableResult,
} from '@teable/v2-core';
import { diffSnapshots, type IBaseVcsSnapshot } from '@teable/v2-vcs';
import {
  CloneBaseVcsService,
  DiffBaseVcsService,
  GetBaseVcsStatusService,
  InMemoryLocalEngineAdapter,
  InMemoryVcsRemoteGateway,
  PullBaseVcsService,
  PushBaseVcsService,
  ResolveBaseVcsConflictsService,
  createV2VcsClientContainer,
} from '@teable/v2-vcs/client';
import { V2EngineSyncAdapter } from '@teable/v2-vcs/engine';
import { FileVcsStateRepository } from '@teable/v2-vcs/node';
import { PgliteLocalEngineAdapter } from '@teable/v2-vcs/pglite';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createHeadlessRuntime } from './index';

type DeepMutable<T> = T extends (...args: never[]) => unknown
  ? T
  : T extends readonly (infer U)[]
    ? DeepMutable<U>[]
    : T extends object
      ? { -readonly [K in keyof T]: DeepMutable<T[K]> }
      : T;

function mutableClone<T>(value: T): DeepMutable<T> {
  return structuredClone(value) as DeepMutable<T>;
}

const TEST_IDS = {
  baseId: 'bseVcsEngineTest001',
  customersTableId: 'tblCustomers0000001',
  ordersTableId: 'tblOrders0000000001',
  custNameFieldId: 'fldCustName00000001',
  orderCodeFieldId: 'fldOrderCode0000001',
  orderQtyFieldId: 'fldOrderQty00000001',
  orderTotalFieldId: 'fldOrderTotal000001',
  orderCustLinkFieldId: 'fldOrderCustLink001',
  custOrdersSymLinkFieldId: 'fldCustOrdersSym001',
  custNameLookupFieldId: 'fldCustNameLookup01',
  custTotalRollupFieldId: 'fldCustTotalRollup1',
} as const;

async function seedRelationalOrdersBase(
  runtime: Awaited<ReturnType<typeof createHeadlessRuntime>>
): Promise<IBaseVcsSnapshot> {
  const actorId = ActorId.create('usr_headless')._unsafeUnwrap();
  const ctx = { actorId };

  expect(
    (
      await runtime.commandBus.execute<CreateBaseCommand, CreateBaseResult>(
        ctx,
        CreateBaseCommand.create({
          baseId: TEST_IDS.baseId,
          name: 'VCS PGlite Base',
        })._unsafeUnwrap()
      )
    ).isOk()
  ).toBe(true);

  expect(
    (
      await runtime.commandBus.execute<CreateTableCommand, CreateTableResult>(
        ctx,
        CreateTableCommand.create({
          baseId: TEST_IDS.baseId,
          tableId: TEST_IDS.customersTableId,
          name: 'Customers',
          fields: [
            {
              id: TEST_IDS.custNameFieldId,
              name: 'Customer Name',
              type: 'singleLineText',
              isPrimary: true,
            },
          ],
        })._unsafeUnwrap()
      )
    ).isOk()
  ).toBe(true);

  expect(
    (
      await runtime.commandBus.execute<CreateTableCommand, CreateTableResult>(
        ctx,
        CreateTableCommand.create({
          baseId: TEST_IDS.baseId,
          tableId: TEST_IDS.ordersTableId,
          name: 'Orders',
          fields: [
            {
              id: TEST_IDS.orderCodeFieldId,
              name: 'Order Code',
              type: 'singleLineText',
              isPrimary: true,
            },
            {
              id: TEST_IDS.orderQtyFieldId,
              name: 'Qty',
              type: 'number',
            },
            {
              id: TEST_IDS.orderTotalFieldId,
              name: 'Total',
              type: 'formula',
              options: {
                expression: `{${TEST_IDS.orderQtyFieldId}} * 10`,
              },
            },
          ],
        })._unsafeUnwrap()
      )
    ).isOk()
  ).toBe(true);

  expect(
    (
      await runtime.commandBus.execute<CreateFieldCommand, CreateFieldResult>(
        ctx,
        CreateFieldCommand.create({
          baseId: TEST_IDS.baseId,
          tableId: TEST_IDS.ordersTableId,
          field: {
            id: TEST_IDS.orderCustLinkFieldId,
            name: 'Customer',
            type: 'link',
            options: {
              relationship: 'manyOne',
              foreignTableId: TEST_IDS.customersTableId,
              lookupFieldId: TEST_IDS.custNameFieldId,
              isOneWay: false,
              symmetricFieldId: TEST_IDS.custOrdersSymLinkFieldId,
            },
          },
        })._unsafeUnwrap()
      )
    ).isOk()
  ).toBe(true);

  expect(
    (
      await runtime.commandBus.execute<CreateFieldCommand, CreateFieldResult>(
        ctx,
        CreateFieldCommand.create({
          baseId: TEST_IDS.baseId,
          tableId: TEST_IDS.ordersTableId,
          field: {
            id: TEST_IDS.custNameLookupFieldId,
            name: 'Customer Name Lookup',
            type: 'lookup',
            options: {
              linkFieldId: TEST_IDS.orderCustLinkFieldId,
              foreignTableId: TEST_IDS.customersTableId,
              lookupFieldId: TEST_IDS.custNameFieldId,
            },
          },
        })._unsafeUnwrap()
      )
    ).isOk()
  ).toBe(true);

  expect(
    (
      await runtime.commandBus.execute<CreateFieldCommand, CreateFieldResult>(
        ctx,
        CreateFieldCommand.create({
          baseId: TEST_IDS.baseId,
          tableId: TEST_IDS.customersTableId,
          field: {
            id: TEST_IDS.custTotalRollupFieldId,
            name: 'Total Qty',
            type: 'rollup',
            options: {
              expression: 'sum({values})',
            },
            config: {
              linkFieldId: TEST_IDS.custOrdersSymLinkFieldId,
              foreignTableId: TEST_IDS.ordersTableId,
              lookupFieldId: TEST_IDS.orderQtyFieldId,
            },
          },
        })._unsafeUnwrap()
      )
    ).isOk()
  ).toBe(true);

  expect(
    (
      await runtime.commandBus.execute(
        ctx,
        RestoreRecordsCommand.create({
          tableId: TEST_IDS.customersTableId,
          records: [
            {
              recordId: 'recCust000000000001',
              fields: { [TEST_IDS.custNameFieldId]: 'Acme Corp' },
            },
          ],
        })._unsafeUnwrap()
      )
    ).isOk()
  ).toBe(true);

  expect(
    (
      await runtime.commandBus.execute(
        ctx,
        RestoreRecordsCommand.create({
          tableId: TEST_IDS.ordersTableId,
          records: [
            {
              recordId: 'recOrder00000000001',
              fields: {
                [TEST_IDS.orderCodeFieldId]: 'ORD-100',
                [TEST_IDS.orderQtyFieldId]: 3,
                [TEST_IDS.orderCustLinkFieldId]: { id: 'recCust000000000001' },
              },
            },
          ],
        })._unsafeUnwrap()
      )
    ).isOk()
  ).toBe(true);

  await runtime.flushComputed();

  const adapter = new V2EngineSyncAdapter({
    commandBus: runtime.commandBus,
    queryBus: runtime.queryBus,
    executionContext: ctx,
    flushComputed: () => runtime.flushComputed(),
  });

  const captured = await adapter.captureSnapshot(TEST_IDS.baseId, {
    baseName: 'VCS PGlite Base',
    revision: 1,
  });
  expect(captured.isOk()).toBe(true);
  return captured._unsafeUnwrap();
}

describe('engine: V2EngineSyncAdapter & PgliteLocalEngineAdapter', () => {
  const createdDirs: string[] = [];

  afterEach(async () => {
    for (const dir of createdDirs.splice(0)) {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('captures schema+views+links+computed values, checks hasBase, and cleanly re-hydrates empty/modified targets', async () => {
    const srcRuntime = await createHeadlessRuntime({
      backend: { kind: 'pglite', dataDir: 'memory://' },
    });
    const dstRuntime = await createHeadlessRuntime({
      backend: { kind: 'pglite', dataDir: 'memory://' },
    });

    try {
      const captured = await seedRelationalOrdersBase(srcRuntime);
      const srcOrders = captured.tables.find((t) => t.id === TEST_IDS.ordersTableId)!;
      const srcCustomers = captured.tables.find((t) => t.id === TEST_IDS.customersTableId)!;
      expect(srcOrders.records[0].fields[TEST_IDS.orderTotalFieldId]).toBe(30);
      expect(srcCustomers.records[0].fields[TEST_IDS.custTotalRollupFieldId]).toBe(3);

      const dstAdapter = new V2EngineSyncAdapter({
        commandBus: dstRuntime.commandBus,
        queryBus: dstRuntime.queryBus,
        flushComputed: () => dstRuntime.flushComputed(),
      });

      expect((await dstAdapter.hasBase(TEST_IDS.baseId))._unsafeUnwrap()).toBe(false);

      const hydrateRes = await dstAdapter.hydrateSnapshot(captured);
      if (hydrateRes.isErr()) {
        throw new Error(`hydrateSnapshot failed: ${JSON.stringify(hydrateRes.error)}`);
      }
      expect(hydrateRes.isOk()).toBe(true);
      expect((await dstAdapter.hasBase(TEST_IDS.baseId))._unsafeUnwrap()).toBe(true);

      const dstSnapshot = hydrateRes._unsafeUnwrap().snapshot!;
      expect(diffSnapshots(captured, dstSnapshot).tablesUpdated).toHaveLength(0);
      const dstOrders = dstSnapshot.tables.find((t) => t.id === TEST_IDS.ordersTableId)!;
      const dstCustomers = dstSnapshot.tables.find((t) => t.id === TEST_IDS.customersTableId)!;
      expect(dstOrders.records[0].fields[TEST_IDS.orderTotalFieldId]).toBe(30);
      expect(dstCustomers.records[0].fields[TEST_IDS.custTotalRollupFieldId]).toBe(3);

      // Apply comprehensive schema + view + record patch directly via V2EngineSyncAdapter
      const nextTarget = mutableClone(dstSnapshot);
      const nextCustTable = nextTarget.tables.find((t) => t.id === TEST_IDS.customersTableId)!;
      nextCustTable.name = 'VIP Customers';
      nextCustTable.fields.push({
        id: 'fldCustNote00000001',
        name: 'Notes',
        type: 'singleLineText',
        isPrimary: false,
        isComputed: false,
      });
      nextCustTable.views[0].name = 'VIP View';
      nextCustTable.records.push({
        id: 'recCust000000000002',
        fields: {
          [TEST_IDS.custNameFieldId]: 'Beta LLC',
          fldCustNote00000001: 'Priority',
        },
      });
      const nextOrdersTable = nextTarget.tables.find((t) => t.id === TEST_IDS.ordersTableId)!;
      nextOrdersTable.records[0].fields[TEST_IDS.orderQtyFieldId] = 10;

      const fullPatch = diffSnapshots(dstSnapshot, nextTarget);
      const applyRes = await dstAdapter.applyPatch(TEST_IDS.baseId, fullPatch, {
        baseName: 'VCS PGlite Base',
        revision: 2,
      });
      if (applyRes.isErr()) {
        throw new Error(`applyPatch failed: ${JSON.stringify(applyRes.error)}`);
      }
      const patched = applyRes.value.snapshot!;
      const patchedCust = patched.tables.find((t) => t.id === TEST_IDS.customersTableId)!;
      const patchedOrders = patched.tables.find((t) => t.id === TEST_IDS.ordersTableId)!;
      expect(patchedCust.name).toBe('VIP Customers');
      expect(patchedCust.views[0].name).toBe('VIP View');
      expect(patchedCust.records).toHaveLength(2);
      expect(patchedOrders.records[0].fields[TEST_IDS.orderTotalFieldId]).toBe(100);
      expect(patchedCust.records[0].fields[TEST_IDS.custTotalRollupFieldId]).toBe(10);

      // Re-hydrating back to `captured` cleanly removes added field/record, even if accessScope is present
      const rehydrateRes = await dstAdapter.hydrateSnapshot({
        ...captured,
        accessScope: {
          tables: {
            [TEST_IDS.customersTableId]: {
              tableId: TEST_IDS.customersTableId,
              isRowFiltered: true,
            },
          },
        },
      });
      expect(rehydrateRes.isOk()).toBe(true);
      const rehydrated = rehydrateRes._unsafeUnwrap().snapshot!;
      expect(diffSnapshots(captured, rehydrated).tablesUpdated).toHaveLength(0);
      expect(
        rehydrated.tables.find((t) => t.id === TEST_IDS.customersTableId)!.records
      ).toHaveLength(1);

      // Re-hydrating with empty tables cleanly deletes all existing tables
      const clearRes = await dstAdapter.hydrateSnapshot({
        ...captured,
        revision: 5,
        tables: [],
      });
      expect(clearRes.isOk()).toBe(true);
      expect(clearRes._unsafeUnwrap().snapshot?.tables).toHaveLength(0);
      expect(clearRes._unsafeUnwrap().snapshot?.revision).toBe(5);
    } finally {
      await srcRuntime.close();
      await dstRuntime.close();
    }
  }, 60_000);

  it('persists workspace in binary PGlite directory on disk and runs full clone -> mutate -> live diff -> pull -> resolve -> push lifecycle', async () => {
    const seedRuntime = await createHeadlessRuntime({
      backend: { kind: 'pglite', dataDir: 'memory://' },
    });
    let initialSnapshot: IBaseVcsSnapshot;
    try {
      initialSnapshot = await seedRelationalOrdersBase(seedRuntime);
    } finally {
      await seedRuntime.close();
    }

    const rootDir = await mkdtemp(join(tmpdir(), 'v2-vcs-pglite-disk-'));
    createdDirs.push(rootDir);
    const pgliteDir = join(rootDir, '.teable', 'vcs', 'pglite');

    const localEngine = new PgliteLocalEngineAdapter({
      dataDir: pgliteDir,
      createRuntime: ({ dataDir, sameTxProjectionDispatcher }) =>
        createHeadlessRuntime({
          backend: { kind: 'pglite', dataDir, sameTxProjectionDispatcher },
        }),
    });
    const stateRepository = new FileVcsStateRepository(rootDir);
    const remoteGateway = new InMemoryVcsRemoteGateway({ initialSnapshot });

    // hasBase on non-existent PGlite dir returns false without initializing any files
    expect((await localEngine.hasBase(TEST_IDS.baseId))._unsafeUnwrap()).toBe(false);
    await expect(stat(pgliteDir)).rejects.toThrow();

    const container = createV2VcsClientContainer({
      remoteGateway,
      localEngine,
      stateRepository,
    });

    const cloneSvc = container.resolve(CloneBaseVcsService);
    const diffSvc = container.resolve(DiffBaseVcsService);
    const pullSvc = container.resolve(PullBaseVcsService);
    const resolveSvc = container.resolve(ResolveBaseVcsConflictsService);
    const pushSvc = container.resolve(PushBaseVcsService);

    // 1. Clone into binary PGlite dir
    const cloneRes = await cloneSvc.execute({ baseId: TEST_IDS.baseId, pgliteDir });
    if (cloneRes.isErr()) {
      throw new Error(`clone failed: ${JSON.stringify(cloneRes.error)}`);
    }
    expect(cloneRes.isOk()).toBe(true);
    await expect(stat(join(pgliteDir, 'PG_VERSION'))).resolves.toBeDefined();
    expect((await localEngine.hasBase(TEST_IDS.baseId))._unsafeUnwrap()).toBe(true);
    expect(await readdir(rootDir)).toEqual(['.teable']);

    // Duplicate clone rejected without force
    const dupRes = await cloneSvc.execute({ baseId: TEST_IDS.baseId, pgliteDir });
    expect(dupRes.isErr()).toBe(true);
    expect(dupRes._unsafeUnwrapErr().code).toBe('vcs.workspace_exists');

    // 2. Edit local PGlite directly via real @teable/v2-core commands + flushComputed
    const localRuntime = await createHeadlessRuntime({
      backend: { kind: 'pglite', dataDir: pgliteDir },
    });
    const orderNoteFieldId = 'fldOrderNote0000001';
    try {
      const ctx = { actorId: ActorId.create('usr_local_dev')._unsafeUnwrap() };
      const addFieldRes = await localRuntime.commandBus.execute(
        ctx,
        CreateFieldCommand.create({
          baseId: TEST_IDS.baseId,
          tableId: TEST_IDS.ordersTableId,
          field: {
            id: orderNoteFieldId,
            name: 'Order Notes',
            type: 'singleLineText',
          },
        })._unsafeUnwrap()
      );
      expect(addFieldRes.isOk()).toBe(true);

      const updRecRes = await localRuntime.commandBus.execute(
        ctx,
        UpdateRecordsCommand.create({
          tableId: TEST_IDS.ordersTableId,
          fieldKeyType: FieldKeyType.Id,
          records: [
            {
              id: 'recOrder00000000001',
              fields: {
                [TEST_IDS.orderQtyFieldId]: 7,
                [orderNoteFieldId]: 'Rush shipping',
              },
            },
          ],
        })._unsafeUnwrap()
      );
      expect(updRecRes.isOk()).toBe(true);
      await localRuntime.flushComputed();
    } finally {
      await localRuntime.close();
    }

    // 3. Offline diff against base snapshot shows computed impact (30->70 formula, 3->7 rollup)
    const offlineDiff = (await diffSvc.execute({ offline: true }))._unsafeUnwrap();
    expect(offlineDiff.target).toBe('base');
    expect(offlineDiff.hasLocalChanges).toBe(true);
    const offlineFormulaImpact = offlineDiff.computedImpact.changes.find(
      (c) => c.fieldId === TEST_IDS.orderTotalFieldId
    );
    const offlineRollupImpact = offlineDiff.computedImpact.changes.find(
      (c) => c.fieldId === TEST_IDS.custTotalRollupFieldId
    );
    expect(offlineFormulaImpact?.before).toBe(30);
    expect(offlineFormulaImpact?.after).toBe(70);
    expect(offlineRollupImpact?.before).toBe(3);
    expect(offlineRollupImpact?.after).toBe(7);

    // 4. Upstream remote adds another order (disjoint) AND then edits conflicting cell
    remoteGateway.applyServerMutation(TEST_IDS.baseId, (cur) => {
      const next = mutableClone(cur);
      const orders = next.tables.find((t) => t.id === TEST_IDS.ordersTableId)!;
      orders.records.push({
        id: 'recOrder00000000002',
        fields: {
          [TEST_IDS.orderCodeFieldId]: 'ORD-101',
          [TEST_IDS.orderQtyFieldId]: 2,
          [TEST_IDS.orderCustLinkFieldId]: { id: 'recCust000000000001', title: 'Acme Corp' },
        },
      });
      const customers = next.tables.find((t) => t.id === TEST_IDS.customersTableId)!;
      const symLinks =
        (customers.records[0].fields[TEST_IDS.custOrdersSymLinkFieldId] as {
          id: string;
          title?: string;
        }[]) ?? [];
      symLinks.push({ id: 'recOrder00000000002', title: 'ORD-101' });
      customers.records[0].fields[TEST_IDS.custOrdersSymLinkFieldId] = symLinks;
      return next;
    });

    const liveCleanDiff = (await diffSvc.execute())._unsafeUnwrap();
    expect(liveCleanDiff.target).toBe('remote');
    expect(liveCleanDiff.remoteRevision).toBe(2);
    expect(liveCleanDiff.hasLocalChanges).toBe(true);
    expect(liveCleanDiff.hasRemoteChanges).toBe(true);
    expect(liveCleanDiff.conflicts).toHaveLength(0);

    // Conflicting edit on same recOrder00000000001 Qty -> 5
    remoteGateway.applyServerMutation(TEST_IDS.baseId, (cur) => {
      const orders = cur.tables.find((t) => t.id === TEST_IDS.ordersTableId)!;
      orders.records[0].fields[TEST_IDS.orderQtyFieldId] = 5;
      return cur;
    });

    const liveConflictDiff = (await diffSvc.execute())._unsafeUnwrap();
    expect(liveConflictDiff.remoteRevision).toBe(3);
    expect(liveConflictDiff.conflicts).toHaveLength(1);
    expect(liveConflictDiff.conflicts[0].kind).toBe('cell_edit_edit');

    // 5. Pull surfaces the conflict and persists merge-state
    const pullRes = (await pullSvc.execute())._unsafeUnwrap();
    expect(pullRes.toRevision).toBe(3);
    expect(pullRes.conflicts).toHaveLength(1);

    // 6. Resolve manually (Qty = 9) -> hydrates PGlite & recomputes formula (90) and rollup (9+2=11)
    const resolveRes = await resolveSvc.execute({
      resolutions: {
        [pullRes.conflicts[0].id]: { strategy: 'manual', manualValue: 9 },
      },
    });
    if (resolveRes.isErr()) {
      throw new Error(`resolve failed: ${JSON.stringify(resolveRes.error)}`);
    }
    expect(resolveRes.value.remainingConflicts).toHaveLength(0);
    const resolvedOrders = resolveRes.value.workingSnapshot.tables.find(
      (t) => t.id === TEST_IDS.ordersTableId
    )!;
    const resolvedCustomers = resolveRes.value.workingSnapshot.tables.find(
      (t) => t.id === TEST_IDS.customersTableId
    )!;
    const resolvedOrder1 = resolvedOrders.records.find((r) => r.id === 'recOrder00000000001')!;
    expect(resolvedOrder1.fields[TEST_IDS.orderQtyFieldId]).toBe(9);
    expect(resolvedOrder1.fields[TEST_IDS.orderTotalFieldId]).toBe(90);
    expect(resolvedOrder1.fields[orderNoteFieldId]).toBe('Rush shipping');
    expect(resolvedCustomers.records[0].fields[TEST_IDS.custTotalRollupFieldId]).toBe(11);

    // 7. Push resolved state cleanly to remote
    const pushRes = (await pushSvc.execute())._unsafeUnwrap();
    expect(pushRes.ok).toBe(true);
    expect(pushRes.newRevision).toBe(4);
    expect(
      remoteGateway
        .getSnapshot(TEST_IDS.baseId)
        ?.tables.find((t) => t.id === TEST_IDS.ordersTableId)
        ?.fields.some((f) => f.id === orderNoteFieldId)
    ).toBe(true);

    const postPushDiff = (await diffSvc.execute())._unsafeUnwrap();
    expect(postPushDiff.hasChanges).toBe(false);

    // 8. Reset removes PGlite directory cleanly
    expect((await localEngine.reset()).isOk()).toBe(true);
    expect((await localEngine.hasBase(TEST_IDS.baseId))._unsafeUnwrap()).toBe(false);
    await expect(stat(pgliteDir)).rejects.toThrow();

    // Verify InMemoryLocalEngineAdapter works identically as lightweight localEngine double
    const memEngine = new InMemoryLocalEngineAdapter();
    expect((await memEngine.hasBase(TEST_IDS.baseId))._unsafeUnwrap()).toBe(false);
    await memEngine.hydrateSnapshot(initialSnapshot);
    expect((await memEngine.hasBase(TEST_IDS.baseId))._unsafeUnwrap()).toBe(true);
  }, 90_000);

  it('tracks PGlite row/link/rollup mutations via WorkingDirtyTracker so status and offline diff read only dirty records', async () => {
    const seedRuntime = await createHeadlessRuntime({
      backend: { kind: 'pglite', dataDir: 'memory://' },
    });
    const baseSnapshot = await seedRelationalOrdersBase(seedRuntime);
    await seedRuntime.close();

    // Add extra clean orders & customers so selective O(delta) reads can be observed
    const expandedSnapshot = mutableClone(baseSnapshot);
    const customersTable = expandedSnapshot.tables.find((t) => t.id === TEST_IDS.customersTableId)!;
    const ordersTable = expandedSnapshot.tables.find((t) => t.id === TEST_IDS.ordersTableId)!;
    for (let i = 0; i < 8; i += 1) {
      const custId = `recCustClean${String(i).padStart(7, '0')}`;
      customersTable.records.push({
        id: custId,
        fields: {
          [TEST_IDS.custNameFieldId]: `Clean Customer ${i}`,
          [TEST_IDS.custTotalRollupFieldId]: 10,
        },
      });
      ordersTable.records.push({
        id: `recOrderClean${String(i).padStart(6, '0')}`,
        fields: {
          [TEST_IDS.orderCodeFieldId]: `ORD-CLEAN-${i}`,
          [TEST_IDS.orderQtyFieldId]: 1,
          [TEST_IDS.orderTotalFieldId]: 10,
          [TEST_IDS.orderCustLinkFieldId]: { id: custId, title: `Clean Customer ${i}` },
        },
      });
    }

    const workDir = await mkdtemp(join(tmpdir(), 'vcs-dirty-tracker-'));
    createdDirs.push(workDir);
    const pgliteDir = join(workDir, '.teable', 'vcs', 'pglite');

    const localEngine = new PgliteLocalEngineAdapter({
      dataDir: pgliteDir,
      createRuntime: ({ dataDir, sameTxProjectionDispatcher }) =>
        createHeadlessRuntime({
          backend: { kind: 'pglite', dataDir, sameTxProjectionDispatcher },
        }),
    });
    const stateRepo = new FileVcsStateRepository(workDir);
    const remoteGateway = new InMemoryVcsRemoteGateway({ initialSnapshot: expandedSnapshot });
    const container = createV2VcsClientContainer({
      remoteGateway,
      localEngine,
      stateRepository: stateRepo,
    });

    const cloneSvc = container.resolve(CloneBaseVcsService);
    const statusSvc = container.resolve(GetBaseVcsStatusService);
    const diffSvc = container.resolve(DiffBaseVcsService);

    expect((await cloneSvc.execute({ baseId: TEST_IDS.baseId, pgliteDir })).isOk()).toBe(true);

    // Clean post-clone state must report zero dirty rows without full base.snapshot.json reads
    const readFullSpy = vi.spyOn(stateRepo, 'readBaseSnapshot');
    const readByIdsSpy = vi.spyOn(stateRepo, 'readBaseRecordsByIds');

    const cleanDelta = (await localEngine.captureWorkingDelta(TEST_IDS.baseId))._unsafeUnwrap();
    expect(cleanDelta.isCompleteDelta).toBe(true);
    expect(cleanDelta.tableDeltas.size).toBe(0);

    const cleanStatus = (await statusSvc.execute())._unsafeUnwrap();
    expect(cleanStatus.hasChanges).toBe(false);
    expect(readFullSpy).not.toHaveBeenCalled();

    // Mutate 1 order qty & relink it from Acme to Clean Customer 0 directly in PGlite
    readByIdsSpy.mockClear();
    const editRuntime = await createHeadlessRuntime({
      backend: { kind: 'pglite', dataDir: pgliteDir },
    });
    try {
      const ctx = { actorId: ActorId.create('usr_local_edit')._unsafeUnwrap() };
      const updRes = await editRuntime.commandBus.execute(
        ctx,
        UpdateRecordsCommand.create({
          tableId: TEST_IDS.ordersTableId,
          fieldKeyType: FieldKeyType.Id,
          records: [
            {
              id: 'recOrder00000000001',
              fields: {
                [TEST_IDS.orderQtyFieldId]: 7,
                [TEST_IDS.orderCustLinkFieldId]: { id: 'recCustClean0000000' },
              },
            },
          ],
        })._unsafeUnwrap()
      );
      expect(updRes.isOk()).toBe(true);
      await editRuntime.flushComputed();
    } finally {
      await editRuntime.close();
    }

    const dirtyDelta = (await localEngine.captureWorkingDelta(TEST_IDS.baseId))._unsafeUnwrap();
    expect(dirtyDelta.isCompleteDelta).toBe(true);
    expect(dirtyDelta.tableDeltas.get(TEST_IDS.ordersTableId)?.dirtyRecordIds).toContain(
      'recOrder00000000001'
    );
    // Both old customer (Acme) and new customer (Clean Customer 0) should be tracked dirty
    const dirtyCustIds = new Set(
      dirtyDelta.tableDeltas.get(TEST_IDS.customersTableId)?.dirtyRecordIds ?? []
    );
    expect(dirtyCustIds.has('recCust000000000001')).toBe(true);
    expect(dirtyCustIds.has('recCustClean0000000')).toBe(true);

    readFullSpy.mockClear();
    readByIdsSpy.mockClear();

    const dirtyStatus = (await statusSvc.execute({ includeSnapshot: false }))._unsafeUnwrap();
    expect(dirtyStatus.hasChanges).toBe(true);
    expect(dirtyStatus.summary.recordsUpdated).toBe(3); // 1 order + 2 customers' symmetric link cells
    expect(readFullSpy).not.toHaveBeenCalled();
    expect(readByIdsSpy).toHaveBeenCalled();

    const offlineDiff = (await diffSvc.execute({ offline: true }))._unsafeUnwrap();
    expect(offlineDiff.hasLocalChanges).toBe(true);
    expect(offlineDiff.computedImpact.totalAffectedCells).toBeGreaterThanOrEqual(3);
    expect(readFullSpy).not.toHaveBeenCalled();
  }, 90_000);
});
