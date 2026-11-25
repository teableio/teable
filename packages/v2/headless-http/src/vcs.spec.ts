import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ContractHttpVcsRemoteGateway } from '@teable/v2-contract-http-client';
import { ActorId, CreateBaseCommand, CreateTableCommand } from '@teable/v2-core';
import { createHeadlessRuntime } from '@teable/v2-headless-runtime';
import type { IBaseVcsPatch, IBaseVcsSnapshot, IVcsEngineApplyResult } from '@teable/v2-vcs';
import {
  CloneBaseVcsService,
  InMemoryVcsStateRepository,
  PullBaseVcsService,
  PushBaseVcsService,
  createV2VcsClientContainer,
} from '@teable/v2-vcs/client';
import { PgliteLocalEngineAdapter } from '@teable/v2-vcs/pglite';
import { describe, expect, it } from 'vitest';

import { createHeadlessHttpApp } from './index';

const jsonActorHeaders = (actor = 'usr_vcs_http'): Headers => {
  const headers = new Headers();
  headers.set('content-type', 'application/json');
  headers.set('x-teable-actor', actor);
  return headers;
};

describe('headless-http /vcs/* routes', () => {
  it('hydrates a snapshot, captures it back, and applies a patch with computed impact', async () => {
    const runtime = await createHeadlessRuntime({
      backend: { kind: 'pglite', dataDir: 'memory://' },
    });
    const app = createHeadlessHttpApp(runtime);

    try {
      const headers = jsonActorHeaders();

      const snapshot: IBaseVcsSnapshot = {
        formatVersion: 1,
        baseId: 'bsevcshttp000000001',
        baseName: 'Headless VCS Base',
        revision: 0,
        capturedAt: '2026-11-15T00:00:00.000Z',
        tables: [
          {
            id: 'tblvcshttp000000001',
            name: 'Items',
            primaryFieldId: 'fldvcshttp000000001',
            fields: [
              {
                id: 'fldvcshttp000000001',
                name: 'Name',
                type: 'singleLineText',
                isPrimary: true,
                isComputed: false,
              },
              {
                id: 'fldvcshttp000000002',
                name: 'Price',
                type: 'number',
                isPrimary: false,
                isComputed: false,
              },
              {
                id: 'fldvcshttp000000003',
                name: 'DoublePrice',
                type: 'formula',
                options: {
                  expression: '{fldvcshttp000000002} * 2',
                },
                isPrimary: false,
                isComputed: true,
              },
            ],
            views: [
              {
                id: 'viwvcshttp000000001',
                name: 'Grid',
                type: 'grid',
              },
            ],
            records: [
              {
                id: 'recvcshttp000000001',
                fields: {
                  fldvcshttp000000001: 'Sword',
                  fldvcshttp000000002: 10,
                },
              },
            ],
          },
        ],
      };

      const hydrateRes = await app.request('/vcs/hydrate', {
        method: 'POST',
        headers,
        body: JSON.stringify({ snapshot }),
      });
      expect(hydrateRes.status).toBe(200);
      const hydrateBody = (await hydrateRes.json()) as {
        ok: boolean;
        data?: IVcsEngineApplyResult;
      };
      expect(hydrateBody.ok).toBe(true);
      expect(hydrateBody.data?.applied).toBe(true);
      expect(hydrateBody.data?.snapshot?.tables).toHaveLength(1);
      expect(hydrateBody.data?.snapshot?.tables[0]?.records[0]?.fields.fldvcshttp000000003).toBe(
        20
      );

      const snapshotRes = await app.request(
        '/vcs/snapshot?baseId=bsevcshttp000000001&baseName=Headless%20VCS%20Base&revision=3',
        { headers }
      );
      expect(snapshotRes.status).toBe(200);
      const snapshotBody = (await snapshotRes.json()) as {
        ok: boolean;
        data?: IBaseVcsSnapshot;
      };
      expect(snapshotBody.ok).toBe(true);
      expect(snapshotBody.data?.revision).toBe(3);
      expect(snapshotBody.data?.baseName).toBe('Headless VCS Base');
      expect(snapshotBody.data?.tables[0]?.records[0]?.fields.fldvcshttp000000003).toBe(20);

      const patch: IBaseVcsPatch = {
        tablesAdded: [],
        tablesDeleted: [],
        tablesUpdated: [
          {
            tableId: 'tblvcshttp000000001',
            fieldsAdded: [],
            fieldsUpdated: [],
            fieldsDeleted: [],
            viewsAdded: [],
            viewsUpdated: [],
            viewsDeleted: [],
            recordsAdded: [
              {
                id: 'recvcshttp000000002',
                fields: {
                  fldvcshttp000000001: 'Shield',
                  fldvcshttp000000002: 25,
                },
              },
            ],
            recordsUpdated: [
              {
                recordId: 'recvcshttp000000001',
                cellChanges: [
                  {
                    fieldId: 'fldvcshttp000000002',
                    before: 10,
                    after: 15,
                  },
                ],
              },
            ],
            recordsDeleted: [],
          },
        ],
      };

      const applyRes = await app.request('/vcs/apply', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          baseId: 'bsevcshttp000000001',
          patch,
          diffComputedImpact: true,
        }),
      });
      expect(applyRes.status).toBe(200);
      const applyBody = (await applyRes.json()) as {
        ok: boolean;
        data?: IVcsEngineApplyResult & {
          computedImpact?: {
            totalAffectedCells: number;
            changes: Array<{
              recordId: string;
              fieldId: string;
              before: unknown;
              after: unknown;
            }>;
          };
        };
      };
      expect(applyBody.ok).toBe(true);
      expect(applyBody.data?.applied).toBe(true);
      expect(applyBody.data?.recomputedCells).toBe(1);
      expect(applyBody.data?.computedImpact?.totalAffectedCells).toBe(1);
      expect(applyBody.data?.computedImpact?.changes).toEqual([
        expect.objectContaining({
          recordId: 'recvcshttp000000001',
          fieldId: 'fldvcshttp000000003',
          before: 20,
          after: 30,
        }),
      ]);

      const updatedRecords = applyBody.data?.snapshot?.tables[0]?.records ?? [];
      const rec1 = updatedRecords.find((r) => r.id === 'recvcshttp000000001');
      const rec2 = updatedRecords.find((r) => r.id === 'recvcshttp000000002');
      expect(rec1?.fields.fldvcshttp000000003).toBe(30);
      expect(rec2?.fields.fldvcshttp000000003).toBe(50);
    } finally {
      await runtime.close();
    }
  }, 30_000);

  it('rejects invalid requests with contract error envelopes', async () => {
    const runtime = await createHeadlessRuntime({
      backend: { kind: 'pglite', dataDir: 'memory://' },
    });
    const app = createHeadlessHttpApp(runtime);

    try {
      const headers = jsonActorHeaders();

      const missingBaseRes = await app.request('/vcs/snapshot', { headers });
      expect(missingBaseRes.status).toBe(400);
      const missingBaseBody = (await missingBaseRes.json()) as {
        ok: boolean;
        error?: { code: string };
      };
      expect(missingBaseBody.ok).toBe(false);
      expect(missingBaseBody.error?.code).toBe('validation.base_id.required');

      const invalidHydrateRes = await app.request('/vcs/hydrate', {
        method: 'POST',
        headers,
        body: JSON.stringify({ snapshot: { bad: true } }),
      });
      expect(invalidHydrateRes.status).toBe(400);
      const invalidHydrateBody = (await invalidHydrateRes.json()) as { ok: boolean };
      expect(invalidHydrateBody.ok).toBe(false);
    } finally {
      await runtime.close();
    }
  }, 30_000);

  it('checks base existence via GET /vcs/exists', async () => {
    const runtime = await createHeadlessRuntime({
      backend: { kind: 'pglite', dataDir: 'memory://' },
    });
    const app = createHeadlessHttpApp(runtime);

    try {
      const headers = jsonActorHeaders();

      const missingRes = await app.request('/vcs/exists', { headers });
      expect(missingRes.status).toBe(400);
      const missingBody = (await missingRes.json()) as { ok: boolean; error?: { code: string } };
      expect(missingBody.ok).toBe(false);
      expect(missingBody.error?.code).toBe('validation.base_id.required');

      const beforeRes = await app.request('/vcs/exists?baseId=bsevcshttp000000002', { headers });
      expect(beforeRes.status).toBe(200);
      expect(await beforeRes.json()).toEqual({ ok: true, data: { exists: false } });

      const hydrateRes = await app.request('/vcs/hydrate', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          snapshot: {
            formatVersion: 1,
            baseId: 'bsevcshttp000000002',
            baseName: 'Exists Check Base',
            revision: 0,
            capturedAt: '2026-11-15T00:00:00.000Z',
            tables: [
              {
                id: 'tblvcshttp000000002',
                name: 'Items',
                primaryFieldId: 'fldvcshttp000000010',
                fields: [
                  {
                    id: 'fldvcshttp000000010',
                    name: 'Name',
                    type: 'singleLineText',
                    isPrimary: true,
                    isComputed: false,
                  },
                ],
                views: [],
                records: [],
              },
            ],
          } satisfies IBaseVcsSnapshot,
        }),
      });
      expect(hydrateRes.status).toBe(200);

      const afterRes = await app.request('/vcs/exists?baseId=bsevcshttp000000002', { headers });
      expect(afterRes.status).toBe(200);
      expect(await afterRes.json()).toEqual({ ok: true, data: { exists: true } });
    } finally {
      await runtime.close();
    }
  }, 30_000);

  it('acts as a remote sync server via /api/v2/bases/:baseId/vcs/* with ContractHttpVcsRemoteGateway', async () => {
    const runtime = await createHeadlessRuntime({
      backend: { kind: 'pglite', dataDir: 'memory://' },
    });
    const localDir = mkdtempSync(join(tmpdir(), 'headless-vcs-client-'));

    try {
      const ctx = { actorId: ActorId.create('usr_headless_server')._unsafeUnwrap() };
      const baseRes = (
        await runtime.commandBus.execute(
          ctx,
          CreateBaseCommand.create({ name: 'Headless Remote Server' })._unsafeUnwrap()
        )
      )._unsafeUnwrap() as { base: { id(): { toString(): string } } };
      const baseId = baseRes.base.id().toString();
      const app = createHeadlessHttpApp(runtime, {
        allowVcsWrite: true,
        localHistoryBaseId: baseId,
      });

      const tableRes = (
        await runtime.commandBus.execute(
          ctx,
          CreateTableCommand.create({
            baseId,
            name: 'ServerItems',
            fields: [{ type: 'singleLineText', name: 'Name', isPrimary: true }],
            records: [{ fields: { Name: 'RemoteOne' } }],
          })._unsafeUnwrap()
        )
      )._unsafeUnwrap() as {
        table: {
          id(): { toString(): string };
          primaryFieldId(): { toString(): string };
        };
      };
      const tableId = tableRes.table.id().toString();
      const primaryFieldId = tableRes.table.primaryFieldId().toString();

      const gateway = new ContractHttpVcsRemoteGateway({
        endpoint: 'http://headless.local',
        headers: Object.fromEntries([['x-teable-actor', 'usr_headless_server']]),
        fetch: (input, init) => Promise.resolve(app.request(input, init)),
      });
      const localEngine = new PgliteLocalEngineAdapter({
        dataDir: localDir,
        createRuntime: ({ dataDir, sameTxProjectionDispatcher }) =>
          createHeadlessRuntime({
            backend: { kind: 'pglite', dataDir, sameTxProjectionDispatcher },
          }),
      });
      const stateRepository = new InMemoryVcsStateRepository();
      const clientContainer = createV2VcsClientContainer({
        remoteGateway: gateway,
        localEngine,
        stateRepository,
      });

      const cloneSvc = clientContainer.resolve(CloneBaseVcsService);
      const pushSvc = clientContainer.resolve(PushBaseVcsService);
      const pullSvc = clientContainer.resolve(PullBaseVcsService);

      const cloned = (await cloneSvc.execute({ baseId }))._unsafeUnwrap();
      expect(cloned.remoteMode).toBe('v2-vcs');
      expect(cloned.snapshot.cursor).toBeTruthy();
      expect(cloned.snapshot.tables).toHaveLength(1);
      const existingRec = cloned.snapshot.tables[0]!.records[0]!;

      // Apply local edit inside client PGlite workspace
      (
        await localEngine.applyPatch(baseId, {
          tablesAdded: [],
          tablesDeleted: [],
          tablesUpdated: [
            {
              tableId,
              fieldsAdded: [],
              fieldsUpdated: [],
              fieldsDeleted: [],
              viewsAdded: [],
              viewsUpdated: [],
              viewsDeleted: [],
              recordsAdded: [],
              recordsUpdated: [
                {
                  recordId: existingRec.id,
                  cellChanges: [
                    {
                      fieldId: primaryFieldId,
                      before: 'RemoteOne',
                      after: 'ClientUpdatedOne',
                    },
                  ],
                },
              ],
              recordsDeleted: [],
            },
          ],
        })
      )._unsafeUnwrap();

      const pushed = (
        await pushSvc.execute({ message: 'Update from client', originPushId: 'vcsp_headless_1' })
      )._unsafeUnwrap();
      expect(pushed.ok).toBe(true);
      expect(pushed.newRevision).toBe(cloned.snapshot.revision + 1);

      // Concurrent server edit creates a fast-forwardable delta for pull
      const afterPushServerHead = (await gateway.getHead(baseId))._unsafeUnwrap();
      expect(afterPushServerHead.headRevision).toBe(pushed.newRevision);

      const pulled = (await pullSvc.execute())._unsafeUnwrap();
      expect(pulled.conflicts).toEqual([]);
      expect(pulled.toRevision).toBe(pushed.newRevision);
      expect(pulled.workingSnapshot.tables[0]!.records[0]!.fields[primaryFieldId]).toBe(
        'ClientUpdatedOne'
      );

      const target = cloned.snapshot.revision;
      const preview = (
        await gateway.rollbackRevision({ baseId, revision: target })
      )._unsafeUnwrap();
      if (!preview.dryRun) throw new Error('Expected a rollback preview');
      const restored = (
        await gateway.rollbackRevision({
          baseId,
          revision: target,
          confirmation: preview.confirmation,
        })
      )._unsafeUnwrap();
      expect(restored).toMatchObject({
        dryRun: false,
        result: { newRevision: pushed.newRevision + 1 },
      });
      const historical = (
        await gateway.checkoutRevision(baseId, pushed.newRevision)
      )._unsafeUnwrap();
      expect(historical.snapshot.tables[0].records[0].fields[primaryFieldId]).toBe(
        'ClientUpdatedOne'
      );
    } finally {
      rmSync(localDir, { recursive: true, force: true });
      await runtime.close();
    }
  }, 60_000);

  it('defaults to ReadOnlyVcsAccessPolicy and rejects POST enable/push unless allowVcsWrite is true', async () => {
    const runtime = await createHeadlessRuntime({
      backend: { kind: 'pglite', dataDir: 'memory://' },
    });
    const app = createHeadlessHttpApp(runtime);

    try {
      const ctx = { actorId: ActorId.create('usr_headless_ro')._unsafeUnwrap() };
      const baseRes = (
        await runtime.commandBus.execute(
          ctx,
          CreateBaseCommand.create({ name: 'Headless ReadOnly Base' })._unsafeUnwrap()
        )
      )._unsafeUnwrap() as { base: { id(): { toString(): string } } };
      const baseId = baseRes.base.id().toString();

      const gateway = new ContractHttpVcsRemoteGateway({
        endpoint: 'http://headless.local',
        headers: Object.fromEntries([['x-teable-actor', 'usr_headless_ro']]),
        fetch: (input, init) => Promise.resolve(app.request(input, init)),
      });

      const headRes = (await gateway.getHead(baseId))._unsafeUnwrap();
      expect(headRes.remoteMode).toBe('v2-vcs');
      expect(headRes.vcsEnabled).toBe(false);

      const cloneRes = (await gateway.cloneSnapshot(baseId))._unsafeUnwrap();
      expect(cloneRes.remoteMode).toBe('openapi-readonly');
      expect(cloneRes.snapshot.cursor).toBeUndefined();

      const enableRes = await gateway.enableBaseVcs(baseId);
      expect(enableRes.isErr()).toBe(true);
      expect(enableRes._unsafeUnwrapErr().tags).toContain('forbidden');
      expect(enableRes._unsafeUnwrapErr().code).toBe('vcs.write_not_enabled_on_headless');

      const pushRes = await gateway.pushPatch({
        baseId,
        baseRevision: 0,
        patch: { tablesAdded: [], tablesDeleted: [], tablesUpdated: [] },
      });
      expect(pushRes.isErr()).toBe(true);
      expect(pushRes._unsafeUnwrapErr().tags).toContain('forbidden');
      expect(pushRes._unsafeUnwrapErr().code).toBe('vcs.write_not_enabled_on_headless');
    } finally {
      await runtime.close();
    }
  }, 30_000);
});
