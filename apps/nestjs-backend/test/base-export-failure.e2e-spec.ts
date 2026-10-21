/* eslint-disable @typescript-eslint/no-explicit-any */
import { randomBytes } from 'node:crypto';
import type { Readable } from 'node:stream';
import type { INestApplication } from '@nestjs/common';
import { FieldKeyType, FieldType } from '@teable/core';
import type { IExportBaseSSEEvent } from '@teable/openapi';
import { ClsService } from 'nestjs-cls';
import { vi } from 'vitest';
import { EventEmitterService } from '../src/event-emitter/event-emitter.service';
import { Events } from '../src/event-emitter/events';
import { BaseExportV2Service } from '../src/features/base/base-export-v2.service';
import { BaseExportService } from '../src/features/base/base-export.service';
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

// Before the export archive guard, the v2 failures below left the export hanging forever:
// archiver never settled finalize(), no failure notification was sent, and the SSE stream
// stayed open on heartbeats.
describe('Base export failures (e2e)', () => {
  let app: INestApplication;
  let appUrl: string;
  let cookie: string;
  let clsService: ClsService<IClsStore>;
  let baseId: string;

  beforeAll(async () => {
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
  });

  afterAll(async () => {
    if (baseId) {
      await permanentDeleteBase(baseId);
    }
    await app.close();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // Mirrors S3 giving up on a multipart part mid-upload: the upload stops reading (so the
  // archive backs up), then rejects after the same stream cleanup the real S3
  // uploadFileStream does.
  const failUploadAfterFirstChunk = (service: any) =>
    vi
      .spyOn(service.storageAdapter, 'uploadFileStream')
      .mockImplementation((_bucket: unknown, _path: unknown, stream: unknown) => {
        const source = stream as Readable;
        return new Promise((_, reject) => {
          source.once('data', () => {
            source.pause();
            setTimeout(() => {
              source.removeAllListeners();
              source.destroy();
              reject(new Error('S3 upload failed: Your socket connection to the server was idle'));
            }, 300);
          });
        });
      });

  const readSse = async (url: string) => {
    const response = await fetch(url, {
      headers: { Accept: 'text/event-stream', Cookie: cookie },
      signal: AbortSignal.timeout(30_000),
    });
    return (await response.text())
      .split(/\r?\n/)
      .filter((line) => line.startsWith('data: '))
      .map((line) => JSON.parse(line.slice(6)) as IExportBaseSSEEvent);
  };

  it('v2: reports an upload failure on the SSE stream and notifies instead of hanging', async () => {
    // The storage adapter is a shared singleton, so this also reaches the edition's own
    // export service subclass that the controller resolves.
    failUploadAfterFirstChunk(app.get(BaseExportV2Service));
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

  it('v2: fails the export when reading table rows errors mid-stream', async () => {
    const service = app.get(BaseExportV2Service) as any;
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
    const service = app.get(BaseExportService) as any;
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
