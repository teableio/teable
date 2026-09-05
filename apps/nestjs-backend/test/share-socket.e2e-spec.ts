/* eslint-disable @typescript-eslint/no-explicit-any */
import type { INestApplication } from '@nestjs/common';
import { HttpErrorCode, IdPrefix, ViewType } from '@teable/core';
import {
  enableShareView as apiEnableShareView,
  disableShareView as apiDisableShareView,
} from '@teable/openapi';
import { map } from 'lodash';
import type { Connection, Doc } from 'sharedb/lib/client';
import { vi } from 'vitest';
import { ViewService } from '../src/features/view/view.service';
import { ShareDbService } from '../src/share-db/share-db.service';
import { getError } from './utils/get-error';
import { initApp, updateViewColumnMeta, createTable, permanentDeleteTable } from './utils/init-app';

describe('Share (socket-e2e) (e2e)', () => {
  let app: INestApplication;
  let tableId: string;
  let shareId: string;
  let viewId: string;
  let port: string;
  const baseId = globalThis.testConfig.baseId;
  const defaultTimeout = 2000;
  const timeoutErrorMessage = 'connection timeout';
  let fieldIds: string[] = [];
  let shareDbService!: ShareDbService;
  let previousForceV2All: string | undefined;

  beforeAll(async () => {
    previousForceV2All = process.env.FORCE_V2_ALL;
    process.env.FORCE_V2_ALL = 'true';
    const appCtx = await initApp();
    app = appCtx.app;
    port = process.env.PORT!;
    shareDbService = app.get(ShareDbService);

    const table = await createTable(baseId, {
      name: 'table1',
      views: [
        {
          type: ViewType.Grid,
          name: 'view1',
        },
        {
          type: ViewType.Form,
          name: 'view2',
        },
      ],
    });
    tableId = table.id;
    viewId = table.defaultViewId!;
    const shareResult = await apiEnableShareView({ tableId, viewId });
    fieldIds = map(table.fields, 'id');
    // hidden last one field
    const field = table.fields[fieldIds.length - 1];
    await updateViewColumnMeta(tableId, viewId, [
      { fieldId: field.id, columnMeta: { hidden: true } },
    ]);
    shareId = shareResult.data.shareId;
  });

  afterAll(async () => {
    await permanentDeleteTable(baseId, tableId);

    await app.close();
    if (previousForceV2All == null) delete process.env.FORCE_V2_ALL;
    else process.env.FORCE_V2_ALL = previousForceV2All;
  });

  const createConnection = (shareId: string): Connection => {
    return shareDbService.connect(undefined, {
      url: `ws://localhost:${port}/socket?shareId=${shareId}`,
      headers: {},
    });
  };

  const getQuery = (collection: string, shareId: string, timeout = defaultTimeout) => {
    return new Promise<Doc<any>[]>((resolve, reject) => {
      const connection = createConnection(shareId);
      const cleanup = () => {
        connection.removeAllListeners('error');
        connection.agent?.stream.removeAllListeners('error');
      };

      connection.createFetchQuery(collection, {}, {}, (err, result) => {
        cleanup();
        if (err) return reject(err);
        resolve(result);
      });

      connection.on('error', (err) => {
        cleanup();
        reject(err);
      });

      connection.agent?.stream.on('error', (err) => {
        cleanup();
        reject(err);
      });

      shareDbService.once('error', (err) => {
        cleanup();
        reject(err);
      });

      setTimeout(() => {
        cleanup();
        reject(new Error(timeoutErrorMessage));
      }, timeout);
    });
  };

  const getDocument = (
    collection: string,
    docId: string,
    shareId: string,
    timeout = defaultTimeout
  ) => {
    return new Promise<Doc<any>>((resolve, reject) => {
      const connection = createConnection(shareId);
      const cleanup = () => {
        connection.removeAllListeners('error');
        connection.agent?.stream.removeAllListeners('error');
      };

      const doc = connection.get(collection, docId);
      doc.fetch((err) => {
        cleanup();
        if (err) return reject(err);
        resolve(doc);
      });

      connection.on('error', (err) => {
        cleanup();
        reject(err);
      });

      setTimeout(() => {
        cleanup();
        reject(new Error(timeoutErrorMessage));
      }, timeout);
    });
  };

  describe('Field queries', () => {
    it('should retrieve fields other than those that are hidden', async () => {
      const collection = `${IdPrefix.Field}_${tableId}`;
      const fields = await getQuery(collection, shareId);
      expect(fields.length).toEqual(fieldIds.length - 1);
    });

    it('should not include hidden field in query results', async () => {
      const hiddenFieldId = fieldIds[fieldIds.length - 1];
      const collection = `${IdPrefix.Field}_${tableId}`;
      const fields = await getQuery(collection, shareId);

      const hiddenField = fields.find((f) => f.id === hiddenFieldId);
      expect(hiddenField).toBeUndefined();
    });
  });

  describe('View queries', () => {
    it('should only get the shared view through v2 without using ViewService', async () => {
      const viewService = app.get(ViewService);
      const legacyDocIdsSpy = vi.spyOn(viewService, 'getDocIdsByQuery');
      const legacySnapshotsSpy = vi.spyOn(viewService, 'getSnapshotBulk');
      const collection = `${IdPrefix.View}_${tableId}`;
      const views = await getQuery(collection, shareId);

      expect(views.length).toEqual(1);
      expect(views[0].id).toEqual(viewId);
      expect(legacyDocIdsSpy).not.toHaveBeenCalled();
      expect(legacySnapshotsSpy).not.toHaveBeenCalled();
      legacyDocIdsSpy.mockRestore();
      legacySnapshotsSpy.mockRestore();
    });

    it('should get view document by id', async () => {
      const collection = `${IdPrefix.View}_${tableId}`;
      const doc = await getDocument(collection, viewId, shareId);

      expect(doc.data).toBeDefined();
      expect(doc.id).toEqual(viewId);
    });
  });

  describe('Record queries', () => {
    it('should be able to query records from shared view', async () => {
      const collection = `${IdPrefix.Record}_${tableId}`;
      const records = await getQuery(collection, shareId);

      // Records may be empty, but the query should succeed
      expect(Array.isArray(records)).toBe(true);
    });
  });

  describe('Error handling', () => {
    it('should reject with validation error for invalid shareId', async () => {
      const collection = `${IdPrefix.View}_${tableId}`;
      const error = await getError(() => getQuery(collection, 'invalid-share-id'));
      expect(error?.code).toEqual('validation_error');
    });

    it('should reject with error for malformed shareId', async () => {
      const collection = `${IdPrefix.View}_${tableId}`;
      const error = await getError(() => getQuery(collection, ''));
      expect(error).toBeDefined();
    });
  });

  describe('Connection lifecycle', () => {
    it('should handle multiple concurrent connections', async () => {
      const collection = `${IdPrefix.View}_${tableId}`;

      const queries = await Promise.all([
        getQuery(collection, shareId),
        getQuery(collection, shareId),
        getQuery(collection, shareId),
      ]);

      expect(queries.length).toEqual(3);
      queries.forEach((views) => {
        expect(views.length).toEqual(1);
        expect(views[0].id).toEqual(viewId);
      });
    });
  });

  describe('Share state changes', () => {
    let tempTableId: string;
    let tempViewId: string;
    let tempShareId: string;

    beforeAll(async () => {
      const table = await createTable(baseId, {
        name: 'temp-share-test-table',
        views: [
          {
            type: ViewType.Grid,
            name: 'temp-view',
          },
        ],
      });
      tempTableId = table.id;
      tempViewId = table.defaultViewId!;
      const shareResult = await apiEnableShareView({ tableId: tempTableId, viewId: tempViewId });
      tempShareId = shareResult.data.shareId;
    });

    afterAll(async () => {
      await permanentDeleteTable(baseId, tempTableId);
    });

    it('should reject queries after share is disabled', async () => {
      // First verify share works
      const collection = `${IdPrefix.View}_${tempTableId}`;
      const views = await getQuery(collection, tempShareId);
      expect(views.length).toEqual(1);

      // Disable share
      await apiDisableShareView({ tableId: tempTableId, viewId: tempViewId });

      // Query should fail
      const error = await getError(() => getQuery(collection, tempShareId));
      expect(error).toBeDefined();

      // Re-enable share for cleanup
      const shareResult = await apiEnableShareView({ tableId: tempTableId, viewId: tempViewId });
      tempShareId = shareResult.data.shareId;
    });
  });

  describe('Computed activity subscriptions', () => {
    it.each(['subscribe', 'fetch'] as const)(
      'rejects cached private computed activity %s without hanging the connection',
      async (operation) => {
        // ShareDB exposes bulk helpers at runtime, but @types/sharedb omits them.
        const connection = createConnection(shareId) as Connection & {
          startBulk(): void;
          endBulk(): void;
        };
        const doc = connection.get(`cmp_${tableId}`, 'table');
        const docs =
          operation === 'subscribe' ? [doc, connection.get(`cmp_${tableId}`, fieldIds[0])] : [doc];
        // A client opened before aggregate documents became private can retain a version.
        docs.forEach((document) => (document.version = 1));

        try {
          await vi.waitFor(() => expect(connection.state).toBe('connected'));
          const errors = await new Promise<unknown[]>((resolve, reject) => {
            const errors: unknown[] = [];
            const timer = setTimeout(
              () => reject(new Error('Computed activity authorization response timeout')),
              defaultTimeout
            );
            if (operation === 'subscribe') connection.startBulk();
            docs.forEach((document) => {
              document[operation]((error) => {
                errors.push(error);
                if (errors.length === docs.length) {
                  clearTimeout(timer);
                  resolve(errors);
                }
              });
            });
            if (operation === 'subscribe') connection.endBulk();
          });

          expect(errors).toEqual(
            docs.map(() => expect.objectContaining({ code: HttpErrorCode.RESTRICTED_RESOURCE }))
          );
          expect(doc.data).toBeUndefined();
          expect(doc.subscribed).toBe(false);

          const visibleField = connection.get(`${IdPrefix.Field}_${tableId}`, fieldIds[0]);
          await new Promise<void>((resolve, reject) => {
            visibleField.fetch((error) => (error ? reject(error) : resolve()));
          });
          expect(visibleField.data.id).toBe(fieldIds[0]);
        } finally {
          connection.close();
        }
      }
    );

    it('replays a later generation into an uncreated client document', async () => {
      const fieldId = fieldIds[0];
      const data = { status: 'running', generation: 3 };
      shareDbService.setComputedActivitySnapshotLoader(async (requestedTableId) => {
        expect(requestedTableId).toBe(tableId);
        return { [fieldId]: { version: 3, data } };
      });

      const connection = createConnection(shareId);
      const doc = connection.get(`cmp_${tableId}`, fieldId) as Doc<typeof data>;
      doc.version = 0;
      const errors: unknown[] = [];
      doc.on('error', (error) => errors.push(error));
      connection.on('error', (error) => errors.push(error));

      try {
        await new Promise<void>((resolve, reject) => {
          const timer = setTimeout(
            () => reject(new Error('Computed activity subscription timeout')),
            defaultTimeout
          );
          doc.subscribe((error) => {
            clearTimeout(timer);
            if (error) {
              reject(error);
              return;
            }
            resolve();
          });
        });

        expect(errors).toEqual([]);
        expect(doc.version).toBe(3);
        expect(doc.data).toEqual(data);
      } finally {
        connection.close();
      }
    });
  });
});
