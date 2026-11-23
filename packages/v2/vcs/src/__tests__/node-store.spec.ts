import { mkdtemp, readdir, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import {
  CloneBaseVcsService,
  InMemoryLocalEngineAdapter,
  InMemoryVcsRemoteGateway,
  createV2VcsClientContainer,
} from '../client';
import { type IBaseVcsSnapshot } from '../index';
import { FileVcsStateRepository, HttpHeadlessLocalEngineAdapter } from '../node';

describe('node adapters: FileVcsStateRepository & HttpHeadlessLocalEngineAdapter', () => {
  const createdDirs: string[] = [];

  afterEach(async () => {
    for (const dir of createdDirs.splice(0)) {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('persists only .teable/vcs metadata without writing teable/tables JSONL files', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'v2-vcs-node-'));
    createdDirs.push(rootDir);

    const snapshot: IBaseVcsSnapshot = {
      formatVersion: 1,
      baseId: 'bseNodeTest00000001',
      baseName: 'Node Store Base',
      revision: 4,
      capturedAt: '2026-11-15T00:00:00.000Z',
      tables: [
        {
          id: 'tblOrders0000000001',
          name: 'Customer Orders',
          primaryFieldId: 'fldName000000000001',
          fields: [
            {
              id: 'fldName000000000001',
              name: 'Name',
              type: 'singleLineText',
              isPrimary: true,
              isComputed: false,
            },
            {
              id: 'fldCalc000000000001',
              name: 'Double',
              type: 'formula',
              isPrimary: false,
              isComputed: true,
              options: { expression: '1+1' },
            },
          ],
          views: [
            {
              id: 'viwMain000000000001',
              name: 'Main Grid',
              type: 'grid',
              order: 0,
              columnMeta: { fldName000000000001: { order: 0 } },
            },
          ],
          records: [
            {
              id: 'rec0000000000000002',
              fields: { fldName000000000001: 'Second', fldCalc000000000001: 2 },
            },
            {
              id: 'rec0000000000000001',
              fields: { fldName000000000001: 'First', fldCalc000000000001: 2 },
            },
          ],
        },
      ],
    };

    const pgliteDir = join(rootDir, '.teable', 'vcs', 'pglite');
    const localEngine = new InMemoryLocalEngineAdapter();
    const stateRepo = new FileVcsStateRepository({ rootDir });
    const remoteGateway = new InMemoryVcsRemoteGateway({ initialSnapshot: snapshot });

    const container = createV2VcsClientContainer({
      remoteGateway,
      localEngine,
      stateRepository: stateRepo,
    });

    const cloneRes = await container
      .resolve(CloneBaseVcsService)
      .execute({ baseId: snapshot.baseId, pgliteDir });
    expect(cloneRes.isOk()).toBe(true);
    expect((await localEngine.hasBase(snapshot.baseId))._unsafeUnwrap()).toBe(true);

    // Metadata files exist under .teable/vcs
    await expect(stat(join(rootDir, '.teable', 'vcs', 'config.json'))).resolves.toBeDefined();
    await expect(
      stat(join(rootDir, '.teable', 'vcs', 'base.snapshot.json'))
    ).resolves.toBeDefined();
    await expect(stat(join(rootDir, '.teable', 'vcs', 'conflicts.json'))).resolves.toBeDefined();

    // No teable/ directory or *.jsonl files should exist
    const rootEntries = await readdir(rootDir);
    expect(rootEntries).toEqual(['.teable']);
    await expect(stat(join(rootDir, 'teable'))).rejects.toThrow();

    const loadedConfig = (await stateRepo.readConfig())._unsafeUnwrap();
    expect(loadedConfig?.pgliteDir).toBe(pgliteDir);

    // Config preserves pullCursor, lastOriginPushIds, and schemaOnly
    await stateRepo.writeConfig({
      ...loadedConfig!,
      pullCursor: 'v2|all|10|10:10:',
      lastOriginPushId: 'vcsp_2',
      lastOriginPushIds: ['vcsp_1', 'vcsp_2'],
      schemaOnly: true,
    });
    const roundTrippedCfg = (await stateRepo.readConfig())._unsafeUnwrap();
    expect(roundTrippedCfg?.pullCursor).toBe('v2|all|10|10:10:');
    expect(roundTrippedCfg?.lastOriginPushId).toBe('vcsp_2');
    expect(roundTrippedCfg?.lastOriginPushIds).toEqual(['vcsp_1', 'vcsp_2']);
    expect(roundTrippedCfg?.schemaOnly).toBe(true);

    // Verify 64-bucket hash store for >2,000 records removes monolithic base.snapshot.json while staying reconstructible
    const schemaOnly: IBaseVcsSnapshot = {
      ...snapshot,
      tables: [{ ...snapshot.tables[0], records: [] }],
    };
    expect((await stateRepo.writeBaseSchemaSnapshot(schemaOnly)).isOk()).toBe(true);
    const bulkUpserts = Array.from({ length: 2_100 }, (_, i) => ({
      id: `recBulk${String(i).padStart(10, '0')}`,
      fields: { fldName000000000001: `Item ${i}` },
      version: 1,
    }));
    expect(
      (
        await stateRepo.applyBaseStateMutations({
          revision: 5,
          recordChanges: [{ tableId: 'tblOrders0000000001', upserts: bulkUpserts }],
        })
      ).isOk()
    ).toBe(true);
    await expect(stat(join(rootDir, '.teable', 'vcs', 'base.schema.json'))).resolves.toBeDefined();
    await expect(stat(join(rootDir, '.teable', 'vcs', 'base.snapshot.json'))).rejects.toThrow();

    const schemaSummary = (await stateRepo.readBaseSchemaSnapshot())._unsafeUnwrap();
    expect(schemaSummary?.totalRecords).toBe(2_100);
    expect(schemaSummary?.tableRecordCounts.tblOrders0000000001).toBe(2_100);

    const selectiveMap = (
      await stateRepo.readBaseRecordsByIds('tblOrders0000000001', [
        'recBulk0000000007',
        'recBulk0000001999',
        'recMissing000000001',
      ])
    )._unsafeUnwrap();
    expect(selectiveMap.size).toBe(2);
    expect(selectiveMap.get('recBulk0000000007')?.fields.fldName000000000001).toBe('Item 7');
    expect(selectiveMap.get('recBulk0000001999')?.fields.fldName000000000001).toBe('Item 1999');

    const reconstructed = (await stateRepo.readBaseSnapshot())._unsafeUnwrap();
    expect(reconstructed?.revision).toBe(5);
    expect(reconstructed?.tables[0]?.records).toHaveLength(2_100);

    // Delete & update subset incrementally
    expect(
      (
        await stateRepo.applyBaseStateMutations({
          revision: 6,
          recordChanges: [
            {
              tableId: 'tblOrders0000000001',
              upserts: [
                {
                  id: 'recBulk0000000007',
                  fields: { fldName000000000001: 'Item 7 Updated' },
                  version: 2,
                },
              ],
              deleteIds: ['recBulk0000001999'],
            },
          ],
        })
      ).isOk()
    ).toBe(true);
    const updatedSummary = (await stateRepo.readBaseSchemaSnapshot())._unsafeUnwrap();
    expect(updatedSummary?.totalRecords).toBe(2_099);
    const afterDelta = (
      await stateRepo.readBaseRecordsByIds('tblOrders0000000001', [
        'recBulk0000000007',
        'recBulk0000001999',
      ])
    )._unsafeUnwrap();
    expect(afterDelta.get('recBulk0000000007')?.fields.fldName000000000001).toBe('Item 7 Updated');
    expect(afterDelta.has('recBulk0000001999')).toBe(false);

    // Verify mergeState write null unlinks file cleanly
    await stateRepo.writeMergeState({
      baseSnapshot: snapshot,
      oursSnapshot: snapshot,
      theirsSnapshot: snapshot,
      workingSnapshot: snapshot,
      conflicts: [],
    });
    await expect(stat(join(rootDir, '.teable', 'vcs', 'merge-state.json'))).resolves.toBeDefined();
    await stateRepo.writeMergeState(null);
    await expect(stat(join(rootDir, '.teable', 'vcs', 'merge-state.json'))).rejects.toThrow();
  });

  it('connects over fetch via HttpHeadlessLocalEngineAdapter and maps HTTP errors cleanly', async () => {
    const calls: { method: string; url: string; body?: string }[] = [];
    const sampleSnapshot: IBaseVcsSnapshot = {
      formatVersion: 1,
      baseId: 'bseHttp000000000001',
      baseName: 'Http Base',
      revision: 2,
      capturedAt: '2026-11-15T00:00:00.000Z',
      tables: [],
    };

    const mockFetch: typeof fetch = async (input, init) => {
      const url = typeof input === 'string' ? input : input.toString();
      const method = init?.method ?? 'GET';
      const body = typeof init?.body === 'string' ? init.body : undefined;
      calls.push({ method, url, body });

      if (url.endsWith('/vcs/exists?baseId=bseHttp000000000001')) {
        return new Response(JSON.stringify({ ok: true, data: { exists: true } }), { status: 200 });
      }
      if (url.endsWith('/vcs/exists?baseId=bseMissing')) {
        return new Response(JSON.stringify({ ok: true, data: { exists: false } }), { status: 200 });
      }
      if (url.startsWith('http://127.0.0.1:4100/vcs/snapshot')) {
        return new Response(JSON.stringify({ ok: true, data: sampleSnapshot }), { status: 200 });
      }
      if (url === 'http://127.0.0.1:4100/vcs/hydrate') {
        return new Response(
          JSON.stringify({
            ok: true,
            data: { applied: true, recomputedCells: 3, snapshot: sampleSnapshot },
          }),
          { status: 200 }
        );
      }
      if (url === 'http://127.0.0.1:4100/vcs/apply') {
        return new Response(
          JSON.stringify({
            ok: false,
            error: { code: 'vcs.conflict', message: 'Conflict on remote', tags: ['conflict'] },
          }),
          { status: 409 }
        );
      }
      return new Response('not found', { status: 404 });
    };

    const adapter = new HttpHeadlessLocalEngineAdapter({
      baseUrl: 'http://127.0.0.1:4100/',
      fetchImpl: mockFetch,
    });

    expect((await adapter.hasBase('bseHttp000000000001'))._unsafeUnwrap()).toBe(true);
    expect((await adapter.hasBase('bseMissing'))._unsafeUnwrap()).toBe(false);

    const capRes = await adapter.captureSnapshot('bseHttp000000000001', {
      baseName: 'Http Base',
      revision: 2,
    });
    expect(capRes.isOk()).toBe(true);
    expect(capRes._unsafeUnwrap().baseId).toBe('bseHttp000000000001');

    const hydRes = await adapter.hydrateSnapshot({ ...sampleSnapshot, revision: 9 });
    expect(hydRes.isOk()).toBe(true);
    expect(hydRes._unsafeUnwrap().recomputedCells).toBe(3);
    expect(hydRes._unsafeUnwrap().snapshot?.revision).toBe(9);

    const applyErr = await adapter.applyPatch('bseHttp000000000001', {
      tablesAdded: [],
      tablesUpdated: [],
      tablesDeleted: [],
    });
    expect(applyErr.isErr()).toBe(true);
    expect(applyErr._unsafeUnwrapErr().tags).toContain('conflict');
    expect(calls.some((c) => c.method === 'POST' && c.url.endsWith('/vcs/hydrate'))).toBe(true);
  });
});
