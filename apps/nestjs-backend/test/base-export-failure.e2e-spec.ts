import { randomBytes } from 'node:crypto';
import { Readable } from 'node:stream';
import type { INestApplication } from '@nestjs/common';
import { FieldKeyType, FieldType } from '@teable/core';
import { PrismaService } from '@teable/db-main-prisma';
import { uploadAttachment, type IBaseJson, type IExportBaseSSEEvent } from '@teable/openapi';
import { stringify } from 'csv-stringify/sync';
import { ClsService } from 'nestjs-cls';
import * as unzipper from 'unzipper';
import { vi } from 'vitest';
import { CacheService } from '../src/cache/cache.service';
import { EventEmitterService } from '../src/event-emitter/event-emitter.service';
import { Events } from '../src/event-emitter/events';
import type StorageAdapter from '../src/features/attachments/plugins/adapter';
import { BaseExportCoordinator } from '../src/features/base/base-export-coordinator';
import { BaseExportV2Service } from '../src/features/base/base-export-v2.service';
import { BaseExportService } from '../src/features/base/base-export.service';
import { EXCLUDE_SYSTEM_FIELDS } from '../src/features/base/constant';
import { NotificationService } from '../src/features/notification/notification.service';
import { PENDING_ROW_ORDER_FIELD_PREFIX } from '../src/features/view/constant';
import { DatabaseRouter } from '../src/global/database-router.service';
import type { IClsStore } from '../src/types/cls';
import {
  createBase,
  createField,
  createRecords,
  createTable,
  initApp,
  permanentDeleteBase,
  runWithTestUser,
} from './utils/init-app';

// Node 22 runtime API, matching the production coordinator's ES2022 compatibility seam.
const promiseWithResolvers = Promise as unknown as {
  withResolvers<T>(): {
    promise: Promise<T>;
    resolve: (value: T | PromiseLike<T>) => void;
    reject: (reason?: unknown) => void;
  };
};

// Narrow test seams replace DB/storage failures; CSV encoding and Node streams stay real.
type ExportTestService = Pick<BaseExportV2Service, 'exportBaseZip'> & {
  storageAdapter: StorageAdapter;
  getRawRows: (...args: unknown[]) => Promise<Array<Record<string, unknown>>>;
  notifyExportResult: (...args: unknown[]) => Promise<void>;
};

// Before the export archive guard, the v2 failures below left the export hanging forever:
// archiver never settled finalize(), no failure notification was sent, and the SSE stream
// stayed open on heartbeats.
describe.each([true, false])('Base export failures, v2_enabled=%s (e2e)', (v2Enabled) => {
  let app: INestApplication;
  let appUrl: string;
  let cookie: string;
  let clsService: ClsService<IClsStore>;
  let baseId: string;
  let tableId: string;
  let previousForceV2All: string | undefined;
  let otherBaseId: string;
  let attachmentBaseId: string;

  beforeAll(async () => {
    previousForceV2All = process.env.FORCE_V2_ALL;
    process.env.FORCE_V2_ALL = 'true';
    const appCtx = await initApp();
    app = appCtx.app;
    appUrl = appCtx.appUrl;
    cookie = appCtx.cookie;
    clsService = app.get(ClsService);
    const base = await createBase({
      name: `export-failure-${Date.now()}`,
      spaceId: globalThis.testConfig.spaceId,
    });
    baseId = base.id;
    const table = await createTable(baseId, { name: 'Rows', records: [] });
    tableId = table.id;
    const payload = await createField(table.id, { name: 'Payload', type: FieldType.LongText });
    // More than one 500-row export page, in batches that stay under plan row limits. ~12MB of
    // incompressible text outgrows every buffer between the CSV generator and the upload,
    // which is where an export whose upload died used to block for good.
    for (let start = 0; start < 600; start += 100) {
      await createRecords(table.id, {
        fieldKeyType: FieldKeyType.Id,
        records: Array.from({ length: 100 }, () => ({
          fields: { [payload.id]: randomBytes(15_000).toString('base64') },
        })),
      });
    }
    await createTable(baseId, { name: 'Empty sibling', records: [] });
    await createTable(baseId, { name: 'Another sibling', records: [] });
    const otherBase = await createBase({
      name: `export-bound-${Date.now()}`,
      spaceId: globalThis.testConfig.spaceId,
    });
    otherBaseId = otherBase.id;
    await createTable(otherBaseId, { name: 'Other project', records: [] });
    const attachmentBase = await createBase({
      name: `export-attachment-cancellation-${Date.now()}`,
      spaceId: globalThis.testConfig.spaceId,
    });
    attachmentBaseId = attachmentBase.id;
    const attachmentTable = await createTable(attachmentBaseId, {
      name: 'Attachment cancellation',
      records: [],
    });
    const attachmentField = await createField(attachmentTable.id, {
      name: 'File',
      type: FieldType.Attachment,
    });
    const { records } = await createRecords(attachmentTable.id, { records: [{ fields: {} }] });
    const uploaded = await uploadAttachment(
      attachmentTable.id,
      records[0].id,
      attachmentField.id,
      Buffer.from('Synthetic attachment export cancellation fixture.\n'),
      { filename: 'export-cancellation.txt', contentType: 'text/plain' }
    );
    expect(uploaded.status).toBe(201);
    expect(uploaded.data.fields[attachmentField.id]).toEqual([
      expect.objectContaining({ token: expect.any(String), name: 'export-cancellation.txt' }),
    ]);
    // FORCE_V2_ALL must not hide the legacy controller branch from this regression.
    await app.get(PrismaService).base.updateMany({
      where: { id: { in: [baseId, otherBaseId, attachmentBaseId] } },
      data: { v2Enabled },
    });
  });

  afterAll(async () => {
    if (baseId) {
      await permanentDeleteBase(baseId);
    }
    if (otherBaseId) await permanentDeleteBase(otherBaseId);
    if (attachmentBaseId) await permanentDeleteBase(attachmentBaseId);
    await app.close();
    if (previousForceV2All === undefined) delete process.env.FORCE_V2_ALL;
    else process.env.FORCE_V2_ALL = previousForceV2All;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // Mirrors S3 giving up on a multipart part mid-upload: the upload stops reading (so the
  // archive backs up), then rejects after the same stream cleanup the real S3
  // uploadFileStream does.
  const failUploadAfterFirstChunk = (service: Pick<ExportTestService, 'storageAdapter'>) =>
    vi
      .spyOn(service.storageAdapter, 'uploadFileStream')
      .mockImplementation((_bucket, _path, stream) => {
        const source = stream as Readable;
        const failure = promiseWithResolvers.withResolvers<{ hash: string; path: string }>();
        source.once('data', () => {
          source.pause();
          setTimeout(() => {
            source.destroy();
            failure.reject(
              new Error('S3 upload failed: Your socket connection to the server was idle')
            );
          }, 300);
        });
        return failure.promise;
      });

  const readSseResponse = async (
    response: Response,
    onEvent?: (event: IExportBaseSSEEvent) => void
  ) => {
    expect(response.ok).toBe(true);
    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    const events: IExportBaseSSEEvent[] = [];
    let pending = '';
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        pending += decoder.decode(value, { stream: true });
        let end: number;
        while ((end = pending.indexOf('\n\n')) !== -1) {
          const frame = pending.slice(0, end);
          pending = pending.slice(end + 2);
          if (!frame.startsWith('data: ')) continue;
          const event = JSON.parse(frame.slice(6)) as IExportBaseSSEEvent;
          events.push(event);
          onEvent?.(event);
        }
      }
      return events;
    } finally {
      reader.releaseLock();
    }
  };

  const readSse = async (url: string) =>
    readSseResponse(
      await fetch(url, {
        headers: { Accept: 'text/event-stream', Cookie: cookie },
        signal: AbortSignal.timeout(30_000),
      })
    );

  it('shares same-user exports while health and record reads remain responsive', async () => {
    const service = (
      v2Enabled ? app.get(BaseExportV2Service) : app.get(BaseExportService)
    ) as unknown as ExportTestService;
    const emitted = vi.spyOn(app.get(EventEmitterService), 'emit');
    expect(
      await app.get(PrismaService).base.findUniqueOrThrow({
        where: { id: baseId },
        select: { v2Enabled: true },
      })
    ).toMatchObject({ v2Enabled });
    const release = promiseWithResolvers.withResolvers<void>();
    const captured = promiseWithResolvers.withResolvers<Buffer>();
    const uploadActive = promiseWithResolvers.withResolvers<void>();
    const consumers: Promise<IExportBaseSSEEvent[]>[] = [];
    const thirdAbort = new AbortController();
    const upload = vi
      .spyOn(service.storageAdapter, 'uploadFileStream')
      .mockImplementation(async (_bucket, path, input) => {
        const chunks: Buffer[] = [];
        let firstChunk = true;
        for await (const chunk of input as Readable) {
          chunks.push(Buffer.from(chunk));
          if (firstChunk) {
            firstChunk = false;
            uploadActive.resolve();
            // Hold the real archive consumer after its first bytes, preserving backpressure.
            await release.promise;
          }
        }
        captured.resolve(Buffer.concat(chunks));
        return { hash: 'export-regression', path };
      });
    const url = `${appUrl}/api/base/${baseId}/export-stream?includeData=true`;
    try {
      const firstResponse = await fetch(url, {
        headers: { Accept: 'text/event-stream', Cookie: cookie },
        signal: AbortSignal.timeout(30_000),
      });
      const first = readSseResponse(firstResponse);
      consumers.push(first);
      await Promise.race([
        uploadActive.promise,
        first.then(() => {
          throw new Error('Export SSE ended before the upload consumed archive data');
        }),
      ]);
      const secondActive = promiseWithResolvers.withResolvers<void>();
      const secondResponse = await fetch(url, {
        headers: { Accept: 'text/event-stream', Cookie: cookie },
        signal: AbortSignal.timeout(30_000),
      });
      const second = readSseResponse(secondResponse, (event) => {
        if (event.type === 'progress' && event.phase !== 'preparing') secondActive.resolve();
      });
      consumers.push(second);
      await Promise.race([
        secondActive.promise,
        second.then(() => {
          throw new Error('Second export SSE ended before replaying the shared active export');
        }),
      ]);
      expect(upload).toHaveBeenCalledTimes(1);
      const busy = await fetch(`${appUrl}/api/base/${otherBaseId}/export?includeData=false`, {
        headers: { Cookie: cookie },
        signal: AbortSignal.timeout(2_000),
      });
      expect(busy.status).toBe(429);
      const competingService = v2Enabled ? app.get(BaseExportService) : app.get(BaseExportV2Service);
      await expect(
        runWithTestUser(clsService, () => competingService.exportBaseZip(otherBaseId, false))
      ).rejects.toMatchObject({ status: 429 });

      // A disconnected subscriber must not cancel the two remaining consumers.
      const thirdActive = promiseWithResolvers.withResolvers<void>();
      const thirdResponse = await fetch(url, {
        headers: { Accept: 'text/event-stream', Cookie: cookie },
        signal: AbortSignal.any([thirdAbort.signal, AbortSignal.timeout(30_000)]),
      });
      const third = readSseResponse(thirdResponse, (event) => {
        if (event.type === 'progress' && event.phase !== 'preparing') thirdActive.resolve();
      });
      consumers.push(third);
      await Promise.race([
        thirdActive.promise,
        third.then(() => {
          throw new Error('Third export SSE ended before replaying the shared active export');
        }),
      ]);
      thirdAbort.abort();
      await expect(third).rejects.toThrow();
      const [health, records] = await Promise.all([
        fetch(`${appUrl}/health`, { signal: AbortSignal.timeout(2_000) }),
        fetch(`${appUrl}/api/table/${tableId}/record?take=1`, {
          headers: { Cookie: cookie },
          signal: AbortSignal.timeout(2_000),
        }),
      ]);
      expect(health.ok).toBe(true);
      expect(records.ok).toBe(true);
      expect((await records.json()).records).toHaveLength(1);
    } finally {
      release.resolve();
      thirdAbort.abort();
      await Promise.allSettled(consumers);
    }
    const [firstEvents, secondEvents] = await Promise.all(consumers.slice(0, 2));
    expect(firstEvents.some((event) => event.type === 'done')).toBe(true);
    expect(firstEvents.find((event) => event.type === 'done')).toEqual(
      secondEvents.find((event) => event.type === 'done')
    );
    expect(upload).toHaveBeenCalledTimes(1);
    if (!v2Enabled) {
      const zip = await unzipper.Open.buffer(await captured.promise);
      const csv = zip.files.find(({ path }) => path === `tables/${tableId}.csv`);
      expect(csv).toBeDefined();
      const table = await app.get(PrismaService).tableMeta.findUniqueOrThrow({
        where: { id: tableId },
      });
      const router = app.get(DatabaseRouter);
      const data = await router.dataPrismaExecutorForTable(tableId);
      const query = router.dataKnex()(table.dbTableName)
        .select('*')
        .orderBy('__auto_number', 'asc')
        .toQuery();
      const rows = await data.$queryRawUnsafe<Record<string, unknown>[]>(query);
      expect(rows).toHaveLength(600);
      const headers = Object.keys(rows[0]).filter(
        (name) =>
          !EXCLUDE_SYSTEM_FIELDS.includes(name) &&
          !name.startsWith(PENDING_ROW_ORDER_FIELD_PREFIX)
      );
      const legacyRows = rows.map((row) =>
        Object.fromEntries(
          Object.entries(row).map(([name, value]) => [
            name,
            value instanceof Date ? value.toISOString() : value,
          ])
        )
      );
      const actualCsv = await csv!.buffer();
      const expectedCsv = Buffer.from(
        `${headers.join(',')}\n${stringify(legacyRows, { columns: headers })}`
      );
      expect(actualCsv.equals(expectedCsv)).toBe(true);
    }
    expect(
      emitted.mock.calls
        .filter(([event]) => event === Events.BASE_EXPORT_COMPLETE)
        .map(([, result]) => result)
    ).toEqual([expect.objectContaining({ status: 'success' })]);
  });

  it.runIf(!v2Enabled)('preserves legacy structure, CSV and attachment contents', async () => {
    const service = app.get(BaseExportService);
    const prisma = app.get(PrismaService);
    const router = app.get(DatabaseRouter);
    const baseRaw = await prisma.base.findUniqueOrThrow({ where: { id: attachmentBaseId } });
    expect(baseRaw.v2Enabled).toBe(false);
    const tableRaws = await prisma.tableMeta.findMany({
      where: { baseId: attachmentBaseId, deletedTime: null }, orderBy: { order: 'asc' },
    });
    const tableIds = tableRaws.map(({ id }) => id);
    const fieldRaws = await prisma.field.findMany({
      where: { tableId: { in: tableIds }, deletedTime: null },
    });
    const viewRaws = await prisma.view.findMany({
      where: { tableId: { in: tableIds }, deletedTime: null },
    });
    const expected = new Map<string, Buffer>();
    for (const table of tableRaws) {
      const data = await router.dataPrismaExecutorForTable(table.id);
      const query = router.dataKnex()(table.dbTableName)
        .select('*')
        .orderBy('__auto_number', 'asc')
        .toQuery();
      const rows = await data.$queryRawUnsafe<Record<string, unknown>[]>(query);
      const headers = Object.keys(rows[0]).filter(
        (name) =>
          !EXCLUDE_SYSTEM_FIELDS.includes(name) &&
          !name.startsWith(PENDING_ROW_ORDER_FIELD_PREFIX)
      );
      const legacyRows = rows.map((row) =>
        Object.fromEntries(
          Object.entries(row).map(([name, value]) => [
            name,
            value instanceof Date ? value.toISOString() : value,
          ])
        )
      );
      expected.set(
        `tables/${table.id}.csv`,
        Buffer.from(`${headers.join(',')}\n${stringify(legacyRows, { columns: headers })}`)
      );
    }
    const refs = await prisma.attachmentsTable.findMany({ where: { tableId: { in: tableIds } } });
    expect(refs).toHaveLength(1);
    const attachments = await prisma.attachments.findMany({
      where: { token: { in: refs.map(({ token }) => token) }, deletedTime: null },
    });
    const metadataHeaders = Object.keys(attachments[0]).filter(
      (name) => !EXCLUDE_SYSTEM_FIELDS.includes(name)
    );
    const metadataCsv = stringify(
      attachments.map((row) => ({ ...row, size: Number(row.size) })),
      { columns: metadataHeaders }
    );
    expected.set(
      'attachments/attachments.csv',
      Buffer.from(`${metadataHeaders.join(',')}\n${metadataCsv}`)
    );
    expected.set(
      `attachments/${refs[0].token}.txt`,
      Buffer.from('Synthetic attachment export cancellation fixture.\n')
    );
    const captured = promiseWithResolvers.withResolvers<Buffer>();
    const storage = (service as unknown as ExportTestService).storageAdapter;
    vi.spyOn(storage, 'uploadFileStream').mockImplementation(async (_bucket, path, input) => {
      const chunks: Buffer[] = [];
      for await (const chunk of input as Readable) chunks.push(Buffer.from(chunk));
      captured.resolve(Buffer.concat(chunks));
      return { hash: 'legacy-parity', path };
    });
    const events = await readSse(
      `${appUrl}/api/base/${attachmentBaseId}/export-stream?includeData=true`
    );
    expect(events.some((event) => event.type === 'done')).toBe(true);
    const zip = await unzipper.Open.buffer(await captured.promise);
    expect(zip.files.map(({ path }) => path).sort()).toEqual(
      ['structure.json', ...expected.keys()].sort()
    );
    for (const [path, contents] of expected) {
      expect(await zip.files.find((entry) => entry.path === path)!.buffer()).toEqual(contents);
    }
    const structureEntry = zip.files.find(({ path }) => path === 'structure.json');
    const structure = JSON.parse((await structureEntry!.buffer()).toString('utf8')) as IBaseJson &
      Record<string, unknown>;
    expect(structure).toMatchObject({
      id: attachmentBaseId,
      name: baseRaw.name,
      icon: baseRaw.icon,
      version: expect.any(String),
    });
    expect(Object.keys(structure).sort()).toEqual(
      [
        'id',
        'name',
        'icon',
        'version',
        'tables',
        'plugins',
        'folders',
        'nodes',
        ...(globalThis.initApp ? ['workflows', 'authorityMatrix', 'apps', 'routines'] : []),
      ].sort()
    );
    if (globalThis.initApp) {
      expect(structure).toMatchObject({
        workflows: [], authorityMatrix: null, apps: [], routines: [],
      });
    }
    expect(structure.tables).toHaveLength(tableRaws.length);
    for (const table of tableRaws) {
      const exported = structure.tables.find(({ id }) => id === table.id);
      expect(exported).toMatchObject({
        id: table.id,
        name: table.name,
        description: table.description,
        icon: table.icon,
        order: table.order,
        dbTableName: table.dbTableName.split('.').pop(),
      });
      const fields = fieldRaws.filter(({ tableId }) => tableId === table.id);
      const views = viewRaws.filter(({ tableId }) => tableId === table.id);
      expect(exported?.fields.map(({ id }) => id).sort()).toEqual(
        fields.map(({ id }) => id).sort()
      );
      expect(exported?.views.map(({ id }) => id).sort()).toEqual(
        views.map(({ id }) => id).sort()
      );
      for (const field of fields) {
        expect(exported?.fields.find(({ id }) => id === field.id)).toMatchObject({
          id: field.id,
          name: field.name,
          type: field.type,
          dbFieldName: field.dbFieldName,
        });
      }
      for (const view of views) {
        expect(exported?.views.find(({ id }) => id === view.id)).toMatchObject({
          id: view.id,
          name: view.name,
          type: view.type,
        });
      }
    }
  });

  it.runIf(!v2Enabled)('holds capacity through initial metadata cancellation', async () => {
    const prisma = app.get(PrismaService);
    const pending = promiseWithResolvers.withResolvers<{ name: string }>();
    const started = promiseWithResolvers.withResolvers<void>();
    const emitted = vi.spyOn(app.get(EventEmitterService), 'emit');
    const findBase = prisma.base.findFirstOrThrow.bind(prisma.base);
    const lookup = vi.spyOn(prisma.base, 'findFirstOrThrow').mockImplementation((args) => {
      if (args?.select?.name && Object.keys(args.select).length === 1) {
        started.resolve();
        return pending.promise as never;
      }
      return findBase(args);
    });
    const abort = new AbortController();
    const request = fetch(`${appUrl}/api/base/${attachmentBaseId}/export?includeData=false`, {
      headers: { Cookie: cookie }, signal: abort.signal,
    }).then((response) => response.text());
    const disconnected = request.then(() => false, () => true);
    try {
      await started.promise;
      abort.abort();
      expect(await disconnected).toBe(true);
      await expect(
        runWithTestUser(clsService, () =>
          app.get(BaseExportV2Service).exportBaseZip(otherBaseId, false)
        )
      ).rejects.toMatchObject({ status: 429 });
      expect(
        emitted.mock.calls.filter(([event]) => event === Events.BASE_EXPORT_COMPLETE)
      ).toHaveLength(0);
      pending.resolve({ name: 'Synthetic pending metadata' });
      await vi.waitFor(() => {
        expect(
          emitted.mock.calls
            .filter(([event]) => event === Events.BASE_EXPORT_COMPLETE)
            .map(([, result]) => result)
        ).toEqual([expect.objectContaining({ status: 'cancelled' })]);
      });
      lookup.mockRestore();
      const events = await readSse(
        `${appUrl}/api/base/${otherBaseId}/export-stream?includeData=false`
      );
      expect(events.some((event) => event.type === 'done')).toBe(true);
    } finally {
      abort.abort();
      pending.resolve({ name: 'Synthetic pending metadata' });
      await disconnected;
    }
  });

  it.each(['export', 'export-stream'])(
    'cancelling %s during lease acquisition notifies once after owner cleanup',
    async (route) => {
      const cache = app.get(CacheService);
      // This regression must exercise real Redis admission, including its owner-only release.
      expect(cache.getKeyv().opts.store).not.toBeInstanceOf(Map);
      const leaseKey: `lock:base-export:${string}` = `lock:base-export:${attachmentBaseId}`;
      const releaseAcquire = promiseWithResolvers.withResolvers<void>();
      const releaseCleanup = promiseWithResolvers.withResolvers<void>();
      const realAcquire = cache.setnx.bind(cache);
      const realRelease = cache.releaseLock.bind(cache);
      let acquireEntered = false;
      let cleanupEntered = false;
      let ownerToken: string | undefined;
      let releaseResult: boolean | undefined;
      const acquire = vi.spyOn(cache, 'setnx').mockImplementation(async (key, value, ttl) => {
        if (key === leaseKey && !acquireEntered) {
          acquireEntered = true;
          if (typeof value === 'string') ownerToken = value;
          await releaseAcquire.promise;
        }
        return realAcquire(key, value, ttl);
      });
      const cleanup = vi.spyOn(cache, 'releaseLock').mockImplementation(async (key, token) => {
        if (key === leaseKey && !cleanupEntered) {
          cleanupEntered = true;
          await releaseCleanup.promise;
          releaseResult = await realRelease(key, token);
          return releaseResult;
        }
        return realRelease(key, token);
      });
      const emitted = vi.spyOn(app.get(EventEmitterService), 'emit');
      const legacyPipe = vi.spyOn(app.get(BaseExportService), 'pipeArchive');
      const v2 = app.get(BaseExportV2Service) as unknown as ExportTestService;
      const tableRows = vi.spyOn(v2, 'getRawRows');
      const upload = vi.spyOn(v2.storageAdapter, 'uploadFileStream');
      const download = vi.spyOn(v2.storageAdapter, 'downloadFile');
      const exportRun = vi.spyOn(app.get(BaseExportCoordinator), 'run');
      expect(
        await app.get(PrismaService).base.findUniqueOrThrow({
          where: { id: attachmentBaseId },
          select: { v2Enabled: true },
        })
      ).toMatchObject({ v2Enabled });
      const abort = new AbortController();
      const request = fetch(`${appUrl}/api/base/${attachmentBaseId}/${route}?includeData=true`, {
        headers: { Accept: 'text/event-stream', Cookie: cookie },
        signal: abort.signal,
      }).then((response) =>
        route === 'export-stream' ? readSseResponse(response) : response.text()
      );
      // Observe rejection before causing the disconnect, including failures before headers.
      const disconnected = request.then(() => false, () => true);
      try {
        await vi.waitFor(() => expect(acquireEntered).toBe(true), { timeout: 5_000 });
        abort.abort();
        expect(await disconnected).toBe(true);
        await vi.waitFor(() => {
          const progress = route === 'export' ? undefined : expect.any(Function);
          expect(exportRun.mock.calls).toContainEqual([
            expect.objectContaining({
              baseId: attachmentBaseId,
              includeData: true,
              onProgress: progress,
              signal: expect.any(AbortSignal),
            }),
            expect.any(Function),
          ]);
          const httpCall = exportRun.mock.calls.find(([options]) =>
            options.baseId === attachmentBaseId && options.includeData === true &&
            options.signal instanceof AbortSignal &&
            (route === 'export'
              ? options.onProgress === undefined
              : typeof options.onProgress === 'function')
          );
          expect(httpCall?.[0].signal?.aborted).toBe(true);
        });
        expect(
          emitted.mock.calls.filter(([event]) => event === Events.BASE_EXPORT_COMPLETE)
        ).toHaveLength(0);
        expect(legacyPipe).not.toHaveBeenCalled();
        expect(tableRows).not.toHaveBeenCalled();
        expect(upload).not.toHaveBeenCalled();
        expect(download).not.toHaveBeenCalled();

        releaseAcquire.resolve();
        await vi.waitFor(() => expect(cleanupEntered).toBe(true), { timeout: 5_000 });
        expect(ownerToken).toEqual(expect.any(String));
        expect(await cache.get(leaseKey)).toBe(ownerToken);
        expect(
          emitted.mock.calls.filter(([event]) => event === Events.BASE_EXPORT_COMPLETE)
        ).toHaveLength(0);
        const busy = await fetch(`${appUrl}/api/base/${otherBaseId}/export?includeData=false`, {
          headers: { Cookie: cookie },
          signal: AbortSignal.timeout(2_000),
        });
        expect(busy.status).toBe(429);
        expect(legacyPipe).not.toHaveBeenCalled();
        expect(tableRows).not.toHaveBeenCalled();
        expect(upload).not.toHaveBeenCalled();
        expect(download).not.toHaveBeenCalled();

        releaseCleanup.resolve();
        await vi.waitFor(() => {
          expect(
            emitted.mock.calls
              .filter(([event]) => event === Events.BASE_EXPORT_COMPLETE)
              .map(([, result]) => result)
          ).toEqual([expect.objectContaining({ status: 'cancelled' })]);
        }, { timeout: 5_000 });
        expect(releaseResult).toBe(true);
        expect(await cache.get(leaseKey)).toBeUndefined();
        expect(legacyPipe).not.toHaveBeenCalled();
        expect(tableRows).not.toHaveBeenCalled();
        expect(upload).not.toHaveBeenCalled();
        expect(download).not.toHaveBeenCalled();
        await vi.waitFor(async () => {
          const events = await readSse(
            `${appUrl}/api/base/${otherBaseId}/export-stream?includeData=false`
          );
          expect(events.some((event) => event.type === 'done')).toBe(true);
        }, { timeout: 5_000 });
        expect(
          emitted.mock.calls
            .filter(([event]) => event === Events.BASE_EXPORT_COMPLETE)
            .map(([, result]) => result)
        ).toEqual([
          expect.objectContaining({ status: 'cancelled' }),
          expect.objectContaining({ status: 'success' }),
        ]);
      } finally {
        abort.abort();
        releaseAcquire.resolve();
        releaseCleanup.resolve();
        await disconnected;
        await Promise.allSettled(
          acquire.mock.results.flatMap((result) =>
            result.type === 'return' ? [result.value] : []
          )
        );
        await Promise.allSettled(
          cleanup.mock.results.flatMap((result) =>
            result.type === 'return' ? [result.value] : []
          )
        );
      }
    }
  );

  it.each(
    ['export', 'export-stream'].flatMap((route) =>
      ['success', 'failed'].flatMap((outcome) =>
        ['owner release', 'notification delivery'].map((phase) => ({ route, outcome, phase }))
      )
    )
  )(
    'disconnecting $route after $outcome preserves the outcome while $phase holds capacity',
    async ({ route, outcome, phase }) => {
      const cache = app.get(CacheService);
      expect(cache.getKeyv().opts.store).not.toBeInstanceOf(Map);
      const leaseKey: `lock:base-export:${string}` = `lock:base-export:${attachmentBaseId}`;
      const releaseCleanup = promiseWithResolvers.withResolvers<void>();
      const releaseNotification = promiseWithResolvers.withResolvers<void>();
      const realAcquire = cache.setnx.bind(cache);
      const realRelease = cache.releaseLock.bind(cache);
      let cleanupEntered = false;
      let notificationEntered = false;
      let ownerToken: string | undefined;
      let releaseResult: boolean | undefined;
      const acquire = vi.spyOn(cache, 'setnx').mockImplementation(async (key, value, ttl) => {
        if (key === leaseKey && typeof value === 'string') ownerToken = value;
        return realAcquire(key, value, ttl);
      });
      const cleanup = vi.spyOn(cache, 'releaseLock').mockImplementation(async (key, token) => {
        if (key === leaseKey && !cleanupEntered) {
          cleanupEntered = true;
          await releaseCleanup.promise;
          releaseResult = await realRelease(key, token);
          return releaseResult;
        }
        return realRelease(key, token);
      });
      const emitted = vi.spyOn(app.get(EventEmitterService), 'emit');
      const notificationService = app.get(NotificationService);
      const realNotify = notificationService.sendExportBaseResultNotify.bind(notificationService);
      const notified = vi
        .spyOn(notificationService, 'sendExportBaseResultNotify')
        .mockImplementation(async (notification) => {
          if (notification.baseId === attachmentBaseId && !notificationEntered) {
            notificationEntered = true;
            if (phase === 'notification delivery') await releaseNotification.promise;
          }
          return realNotify(notification);
        });
      const selected = (
        v2Enabled ? app.get(BaseExportV2Service) : app.get(BaseExportService)
      ) as unknown as ExportTestService;
      const exportRun = vi.spyOn(app.get(BaseExportCoordinator), 'run');
      const storage = selected.storageAdapter;
      // Success uses real storage; failure comes from the upload adapter's rejected promise.
      const upload = vi.spyOn(storage, 'uploadFileStream');
      const exportError = new Error('Synthetic upload failure before owner release');
      if (outcome === 'failed') upload.mockRejectedValueOnce(exportError);
      const terminalResult = outcome === 'success'
        ? { status: 'success' }
        : { status: 'failed', errorMessage: exportError.message };
      const terminalMessageKey = `common.email.templates.notify.exportBase.${outcome}.message`;
      const abort = new AbortController();
      const request = fetch(`${appUrl}/api/base/${attachmentBaseId}/${route}?includeData=true`, {
        headers: { Accept: 'text/event-stream', Cookie: cookie },
        signal: abort.signal,
      }).then((response) =>
        route === 'export-stream' ? readSseResponse(response) : response.text()
      );
      const disconnected = request.then(() => false, () => true);
      try {
        await vi.waitFor(
          () =>
            expect(
              phase === 'notification delivery' ? notificationEntered : cleanupEntered
            ).toBe(true),
          { timeout: 10_000 }
        );
        if (phase === 'notification delivery') expect(cleanupEntered).toBe(false);
        expect(ownerToken).toEqual(expect.any(String));
        expect(await cache.get(leaseKey)).toBe(ownerToken);
        expect(upload).toHaveBeenCalledTimes(1);
        expect(
          emitted.mock.calls
            .filter(([event]) => event === Events.BASE_EXPORT_COMPLETE)
            .map(([, result]) => result)
        ).toEqual([expect.objectContaining(terminalResult)]);
        expect(notified).toHaveBeenCalledTimes(1);
        expect(notified.mock.calls[0][0]).toMatchObject({
          baseId: attachmentBaseId,
          message: {
            i18nKey: terminalMessageKey,
            context: outcome === 'success'
              ? { previewUrl: expect.any(String) }
              : { errorMessage: exportError.message },
          },
        });

        abort.abort();
        expect(await disconnected).toBe(true);
        await vi.waitFor(() => {
          const httpCall = exportRun.mock.calls.find(([options]) =>
            options.baseId === attachmentBaseId && options.includeData === true &&
            options.signal instanceof AbortSignal &&
            (route === 'export'
              ? options.onProgress === undefined
              : typeof options.onProgress === 'function')
          );
          expect(httpCall?.[0].signal?.aborted).toBe(true);
        });
        const busy = await fetch(`${appUrl}/api/base/${otherBaseId}/export?includeData=false`, {
          headers: { Cookie: cookie },
          signal: AbortSignal.timeout(2_000),
        });
        expect(busy.status).toBe(429);
        expect(await cache.get(leaseKey)).toBe(ownerToken);
        if (phase === 'notification delivery') expect(cleanupEntered).toBe(false);
        if (outcome === 'success') expect(upload.mock.calls[0][4]?.aborted).toBe(false);

        releaseNotification.resolve();
        await vi.waitFor(() => expect(cleanupEntered).toBe(true), { timeout: 5_000 });

        releaseCleanup.resolve();
        await vi.waitFor(() => expect(releaseResult).toBe(true), { timeout: 5_000 });
        expect(await cache.get(leaseKey)).toBeUndefined();
        const uploaded = upload.mock.results[0];
        if (uploaded.type !== 'return') throw new Error('Expected asynchronous archive upload');
        if (outcome === 'success') {
          const { path } = await uploaded.value;
          const [bucket] = upload.mock.calls[0];
          const published = await storage.downloadFile(bucket, path);
          const chunks: Buffer[] = [];
          for await (const chunk of published) chunks.push(Buffer.from(chunk));
          const zip = await unzipper.Open.buffer(Buffer.concat(chunks));
          expect(zip.files.map((entry) => entry.path)).toContain('structure.json');
          expect(zip.files.map((entry) => entry.path)).toContain('attachments/attachments.csv');
          const attachment = zip.files.find((entry) =>
            /^attachments\/[^/]+\.txt$/.test(entry.path)
          );
          if (!attachment) throw new Error('Published archive lost its attachment');
          expect(await attachment.buffer()).toEqual(
            Buffer.from('Synthetic attachment export cancellation fixture.\n')
          );
        } else {
          await expect(uploaded.value).rejects.toBe(exportError);
        }
        await vi.waitFor(async () => {
          const events = await readSse(
            `${appUrl}/api/base/${otherBaseId}/export-stream?includeData=false`
          );
          expect(events.some((event) => event.type === 'done')).toBe(true);
        }, { timeout: 5_000 });
        expect(
          emitted.mock.calls
            .filter(([event]) => event === Events.BASE_EXPORT_COMPLETE)
            .map(([, result]) => result)
        ).toEqual([
          expect.objectContaining(terminalResult),
          expect.objectContaining({ status: 'success' }),
        ]);
        expect(notified.mock.calls.map(([notification]) => notification.message)).toEqual([
          expect.objectContaining({
            i18nKey: terminalMessageKey,
          }),
          expect.objectContaining({
            i18nKey: 'common.email.templates.notify.exportBase.success.message',
          }),
        ]);
      } finally {
        abort.abort();
        releaseNotification.resolve();
        releaseCleanup.resolve();
        await disconnected;
        await Promise.allSettled(
          acquire.mock.results.flatMap((result) =>
            result.type === 'return' ? [result.value] : []
          )
        );
        await Promise.allSettled(
          notified.mock.results.flatMap((result) =>
            result.type === 'return' ? [result.value] : []
          )
        );
        await Promise.allSettled(
          cleanup.mock.results.flatMap((result) =>
            result.type === 'return' ? [result.value] : []
          )
        );
      }
    }
  );

  it.each(['export', 'export-stream'])(
    'disconnecting the last %s client destroys a stalled attachment body and releases capacity',
    async (route) => {
      const service = (
        v2Enabled ? app.get(BaseExportV2Service) : app.get(BaseExportService)
      ) as unknown as ExportTestService;
      const emitted = vi.spyOn(app.get(EventEmitterService), 'emit');
      let sentChunk = false;
      let bodyReadIsPending = false;
      const body = new Readable({
        read() {
          if (!sentChunk) {
            sentChunk = true;
            this.push(Buffer.from('Synthetic attachment body prefix.\n'));
            return;
          }
          // The consumer has read the prefix and is waiting for more bytes. Never send EOF.
          bodyReadIsPending = true;
        },
      });
      const download = vi.spyOn(service.storageAdapter, 'downloadFile').mockResolvedValueOnce(body);
      let uploadSettled = false;
      const upload = vi
        .spyOn(service.storageAdapter, 'uploadFileStream')
        .mockImplementation(async (_bucket, path, input) => {
          try {
            await (input as Readable).forEach(() => undefined);
            return { hash: 'attachment-cancellation', path };
          } finally {
            uploadSettled = true;
          }
        });
      const abort = new AbortController();
      const request = fetch(`${appUrl}/api/base/${attachmentBaseId}/${route}?includeData=true`, {
        headers: { Accept: 'text/event-stream', Cookie: cookie },
        signal: abort.signal,
      }).then((response) =>
        route === 'export-stream' ? readSseResponse(response) : response.text()
      );
      const disconnected = request.then(
        () => false,
        () => true
      );
      try {
        await vi.waitFor(() => expect(bodyReadIsPending).toBe(true), { timeout: 5_000 });
        expect(body.destroyed).toBe(false);
        abort.abort();
        expect(await disconnected).toBe(true);
        await vi.waitFor(
          () => {
            expect(body.destroyed).toBe(true);
            expect(uploadSettled).toBe(true);
          },
          { timeout: 2_000 }
        );
        await vi.waitFor(() => {
          expect(
            emitted.mock.calls
              .filter(([event]) => event === Events.BASE_EXPORT_COMPLETE)
              .map(([, result]) => result)
          ).toEqual([expect.objectContaining({ status: 'cancelled' })]);
        });
        upload.mockRestore();
        download.mockRestore();
        await vi.waitFor(
          async () => {
            const events = await readSse(
              `${appUrl}/api/base/${otherBaseId}/export-stream?includeData=false`
            );
            expect(events.some((event) => event.type === 'done')).toBe(true);
          },
          { timeout: 5_000 }
        );
      } finally {
        abort.abort();
        // Failure-only teardown comes after the destruction/settlement assertions.
        body.destroy();
        await disconnected;
      }
    }
  );

  it.each(['export', 'export-stream'])(
    'disconnecting the last %s client aborts upload after EOF and retains capacity through cleanup',
    async (route) => {
      const service = (
        v2Enabled ? app.get(BaseExportV2Service) : app.get(BaseExportService)
      ) as unknown as ExportTestService;
      const emitted = vi.spyOn(app.get(EventEmitterService), 'emit');
      const pendingResponse = promiseWithResolvers.withResolvers<{ hash: string; path: string }>();
      const releaseCleanup = promiseWithResolvers.withResolvers<void>();
      let reachedEof = false;
      let uploadAborted = false;
      let uploadSettled = false;
      let uploadSource: Readable | undefined;
      const upload = vi
        .spyOn(service.storageAdapter, 'uploadFileStream')
        .mockImplementation(async (_bucket, _path, input, _metadata, signal?: AbortSignal) => {
          const onAbort = () => {
            uploadAborted = true;
            pendingResponse.reject(signal?.reason ?? new Error('Upload aborted'));
          };
          try {
            uploadSource = input as Readable;
            await uploadSource.forEach(() => undefined);
            reachedEof = true;
            signal?.addEventListener('abort', onAbort, { once: true });
            if (signal?.aborted) onAbort();
            return await pendingResponse.promise;
          } finally {
            signal?.removeEventListener('abort', onAbort);
            await releaseCleanup.promise;
            uploadSettled = true;
          }
        });
      const abort = new AbortController();
      const request = fetch(`${appUrl}/api/base/${attachmentBaseId}/${route}?includeData=true`, {
        headers: { Accept: 'text/event-stream', Cookie: cookie },
        signal: abort.signal,
      }).then((response) =>
        route === 'export-stream' ? readSseResponse(response) : response.text()
      );
      const disconnected = request.then(
        () => false,
        () => true
      );
      try {
        await vi.waitFor(() => expect(reachedEof).toBe(true), { timeout: 5_000 });
        expect(uploadSettled).toBe(false);
        abort.abort();
        expect(await disconnected).toBe(true);
        await vi.waitFor(() => expect(uploadAborted).toBe(true), { timeout: 2_000 });
        const busy = await fetch(`${appUrl}/api/base/${otherBaseId}/export?includeData=false`, {
          headers: { Cookie: cookie },
          signal: AbortSignal.timeout(2_000),
        });
        expect(busy.status).toBe(429);
        expect(uploadSettled).toBe(false);
        expect(
          emitted.mock.calls.filter(([event]) => event === Events.BASE_EXPORT_COMPLETE)
        ).toHaveLength(0);
        releaseCleanup.resolve();
        await vi.waitFor(() => expect(uploadSettled).toBe(true), { timeout: 2_000 });
        await vi.waitFor(() => {
          expect(
            emitted.mock.calls
              .filter(([event]) => event === Events.BASE_EXPORT_COMPLETE)
              .map(([, result]) => result)
          ).toEqual([expect.objectContaining({ status: 'cancelled' })]);
        });
        upload.mockRestore();
        await vi.waitFor(
          async () => {
            const events = await readSse(
              `${appUrl}/api/base/${otherBaseId}/export-stream?includeData=false`
            );
            expect(events.some((event) => event.type === 'done')).toBe(true);
          },
          { timeout: 5_000 }
        );
      } finally {
        abort.abort();
        // Settle a broken implementation for teardown without satisfying the abort assertion.
        uploadSource?.destroy();
        if (reachedEof) pendingResponse.reject(new Error('Export regression cleanup'));
        releaseCleanup.resolve();
        await disconnected;
      }
    }
  );

  it('reports an upload failure on the SSE stream and notifies instead of hanging', async () => {
    // The storage adapter is a shared singleton, so this also reaches the edition's own
    // export service subclass that the controller resolves.
    failUploadAfterFirstChunk(app.get(BaseExportV2Service) as unknown as ExportTestService);
    const emitSpy = vi.spyOn(app.get(EventEmitterService), 'emit');

    const events = await readSse(`${appUrl}/api/base/${baseId}/export-stream?includeData=true`);

    const errorEvent = events.find((event) => event.type === 'error');
    expect(errorEvent).toMatchObject({ message: expect.stringContaining('S3 upload failed') });
    expect(events.some((event) => event.type === 'done')).toBe(false);
    expect(emitSpy).toHaveBeenCalledWith(
      Events.BASE_EXPORT_COMPLETE,
      expect.objectContaining({ status: 'failed' })
    );
  });

  it.runIf(v2Enabled)('v2: fails when reading table rows errors mid-stream', async () => {
    const service = app.get(BaseExportV2Service) as unknown as ExportTestService;
    const getRawRows = service.getRawRows.bind(service);
    let calls = 0;
    vi.spyOn(service, 'getRawRows').mockImplementation(async (...args: unknown[]) => {
      calls += 1;
      if (calls === 2) throw new Error('Connection terminated unexpectedly');
      return getRawRows(...args);
    });
    const notifySpy = vi.spyOn(service, 'notifyExportResult');

    await expect(
      runWithTestUser(clsService, () => service.exportBaseZip(baseId, true, () => undefined))
    ).rejects.toThrow('Connection terminated unexpectedly');
    expect(notifySpy).toHaveBeenCalledWith(
      baseId,
      expect.anything(),
      expect.objectContaining({ status: 'failed' })
    );
  });

  it('v1: reports an upload failure', async () => {
    const service = app.get(BaseExportService) as unknown as ExportTestService;
    failUploadAfterFirstChunk(service);
    const notifySpy = vi.spyOn(service, 'notifyExportResult');

    await expect(
      runWithTestUser(clsService, () => service.exportBaseZip(baseId, true, () => undefined))
    ).rejects.toThrow('S3 upload failed');
    expect(notifySpy).toHaveBeenCalledWith(
      baseId,
      expect.anything(),
      expect.objectContaining({ status: 'failed' })
    );
  });

  it('still exports successfully after the failures above', async () => {
    const events = await readSse(`${appUrl}/api/base/${baseId}/export-stream?includeData=true`);
    expect(events.find((event) => event.type === 'error')).toBeUndefined();
    expect(events.some((event) => event.type === 'done')).toBe(true);
  });
});
