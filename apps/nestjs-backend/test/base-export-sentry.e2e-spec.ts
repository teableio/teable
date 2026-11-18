/* eslint-disable @typescript-eslint/naming-convention */
import { createRequire } from 'node:module';
import type { INestApplication } from '@nestjs/common';
import type * as Sentry from '@sentry/nestjs';
import { PrismaService } from '@teable/db-main-prisma';
import { ClsService } from 'nestjs-cls';
import { vi } from 'vitest';
import { EventEmitterService } from '../src/event-emitter/event-emitter.service';
import { Events } from '../src/event-emitter/events';
import type StorageAdapter from '../src/features/attachments/plugins/adapter';
import { BaseExportV2Service } from '../src/features/base/base-export-v2.service';
import { BaseExportService } from '../src/features/base/base-export.service';
import { NotificationService } from '../src/features/notification/notification.service';
import type { IClsStore } from '../src/types/cls';
import { createBase, initApp, permanentDeleteBase, runWithTestUser } from './utils/init-app';

const sentry = createRequire(import.meta.url)('@sentry/nestjs') as typeof Sentry;

describe('Base export sentry reporting (e2e)', () => {
  let app: INestApplication;
  let baseExportService: BaseExportService;
  let clsService: ClsService<IClsStore>;
  let baseId: string;
  const sentryEvents: Sentry.ErrorEvent[] = [];
  let sentryClient: Sentry.NodeClient;
  let sentryScope: ReturnType<typeof sentry.getCurrentScope>;
  let previousSentryClient: ReturnType<typeof sentry.getClient>;

  beforeAll(async () => {
    const appCtx = await initApp();
    app = appCtx.app;
    clsService = app.get(ClsService);
    baseExportService = app.get(BaseExportService);
    const base = await createBase({
      name: `sentry-export-${Date.now()}`,
      spaceId: globalThis.testConfig.spaceId,
    });
    baseId = base.id;
  });

  afterAll(async () => {
    if (baseId) {
      await permanentDeleteBase(baseId);
    }
    await app.close();
  });

  beforeEach(() => {
    sentryEvents.length = 0;
    sentryScope = sentry.getCurrentScope();
    previousSentryClient = sentryScope.getClient();
    sentryClient = new sentry.NodeClient({
      dsn: 'https://public@sentry.invalid/1',
      integrations: [],
      stackParser: sentry.defaultStackParser,
      sendClientReports: false,
      transport: () => ({
        send(envelope) {
          for (const [header, payload] of envelope[1]) {
            if (header.type === 'event') sentryEvents.push(payload as Sentry.ErrorEvent);
          }
          return Promise.resolve({ statusCode: 200 });
        },
        flush: () => Promise.resolve(true),
      }),
    });
    sentryScope.setClient(sentryClient);
    sentryClient.init();
  });

  afterEach(async () => {
    try {
      await sentryClient.close(2_000);
    } finally {
      sentryScope.setClient(previousSentryClient);
      vi.restoreAllMocks();
    }
  });

  it('rejects asynchronous export failures and reports them to Sentry and notifications', async () => {
    const exportError = new Error('mock export failure');
    const storage = app.get<StorageAdapter>(Symbol.for('ObjectStorage'));
    vi.spyOn(storage, 'uploadFileStream').mockRejectedValue(exportError);
    const notifySpy = vi
      .spyOn(app.get(NotificationService), 'sendExportBaseResultNotify')
      .mockResolvedValue(undefined);
    const emitted = vi.spyOn(app.get(EventEmitterService), 'emit');

    await expect(
      runWithTestUser(clsService, () => baseExportService.exportBaseZip(baseId, false))
    ).rejects.toBe(exportError);

    expect(await sentryClient.flush(2_000)).toBe(true);
    expect(sentryEvents).toEqual([
      expect.objectContaining({
        exception: expect.objectContaining({
          values: [
            expect.objectContaining({ type: exportError.name, value: exportError.message }),
          ],
        }),
        tags: expect.objectContaining({
          feature: 'base-export',
          'export.stage': 'processExport',
        }),
        contexts: expect.objectContaining({
          'base-export': expect.objectContaining({
            baseId,
            baseName: expect.any(String),
            includeData: false,
            userId: expect.any(String),
          }),
        }),
      }),
    ]);
    expect(notifySpy).toHaveBeenCalledTimes(1);
    expect(notifySpy).toHaveBeenCalledWith({
      baseId,
      toUserId: expect.any(String),
      message: {
        i18nKey: 'common.email.templates.notify.exportBase.failed.message',
        context: {
          baseId,
          baseName: expect.any(String),
          errorMessage: exportError.message,
        },
      },
    });
    expect(
      emitted.mock.calls
        .filter(([event]) => event === Events.BASE_EXPORT_COMPLETE)
        .map(([, result]) => result)
    ).toEqual([{ status: 'failed', errorMessage: exportError.message }]);
  });

  it.each(
    ['v1', 'v2'].flatMap((engine) =>
      ['success', 'failed'].map((outcome) => ({ engine, outcome }))
    )
  )(
    '$engine reports $outcome notification rejection without publishing another outcome',
    async ({ engine, outcome }) => {
      await app.get(PrismaService).base.update({
        where: { id: baseId },
        data: { v2Enabled: engine === 'v2' },
      });
      const service = engine === 'v2' ? app.get(BaseExportV2Service) : baseExportService;
      const exportError = new Error('Synthetic export upload error before failed notification');
      const notificationError = new Error('Synthetic terminal notification delivery error');
      const storage = app.get<StorageAdapter>(Symbol.for('ObjectStorage'));
      if (outcome === 'failed') {
        vi.spyOn(storage, 'uploadFileStream').mockRejectedValueOnce(exportError);
      }
      const notify = vi
        .spyOn(app.get(NotificationService), 'sendExportBaseResultNotify')
        .mockRejectedValue(notificationError);
      const emitted = vi.spyOn(app.get(EventEmitterService), 'emit');

      await expect(
        runWithTestUser(clsService, () => service.exportBaseZip(baseId, false))
      ).rejects.toBe(notificationError);

      expect(await sentryClient.flush(2_000)).toBe(true);

      expect(notify).toHaveBeenCalledTimes(1);
      expect(
        emitted.mock.calls
          .filter(([event]) => event === Events.BASE_EXPORT_COMPLETE)
          .map(([, result]) => result)
      ).toEqual([
        expect.objectContaining({
          status: outcome,
          ...(outcome === 'failed' ? { errorMessage: exportError.message } : {}),
        }),
      ]);
      expect(sentryEvents.map((event) => event.exception?.values)).toEqual(
        (outcome === 'failed' ? [exportError, notificationError] : [notificationError]).map(
          (error) => [expect.objectContaining({ type: error.name, value: error.message })]
        )
      );
      const feature = engine === 'v2' ? 'base-export-v2' : 'base-export';
      for (const event of sentryEvents) {
        expect(event).toEqual(
          expect.objectContaining({
            tags: expect.objectContaining({ feature }),
            contexts: expect.objectContaining({
              [feature]: expect.objectContaining({
                baseId,
                baseName: expect.any(String),
                includeData: false,
                userId: expect.any(String),
              }),
            }),
          })
        );
      }
    }
  );
});
