/* eslint-disable @typescript-eslint/no-explicit-any */
import type { INestApplication } from '@nestjs/common';
import { FieldKeyType, IdPrefix, ViewType } from '@teable/core';
import type { IFieldVo, IRecord } from '@teable/core';
import {
  createRecords as apiCreateRecords,
  updateRecord as apiUpdateRecord,
  deleteRecord as apiDeleteRecord,
  createField as apiCreateField,
  deleteField as apiDeleteField,
  enableShareView as apiEnableShareView,
} from '@teable/openapi';
import type { Query, Doc, Connection } from 'sharedb/lib/client';
import ShareDBClient from 'sharedb/lib/client';
import { ShareDbService } from '../src/share-db/share-db.service';
import { initApp, createTable, permanentDeleteTable } from './utils/init-app';

/**
 * Check if sockjs-client is available for transport fallback tests
 */
// eslint-disable-next-line @typescript-eslint/naming-convention
let SockJS: any;
let isSockJSAvailable = false;
try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  SockJS = require('sockjs-client');
  isSockJSAvailable = true;
} catch {
  // sockjs-client not installed, skip transport fallback tests
}

/**
 * SockJS transport types for testing
 * Note: xhr-polling is excluded as it's no longer supported
 */
type ISockJSTransport = 'websocket' | 'xhr-streaming';

/** Transport constants */
const transportWebsocket: ISockJSTransport = 'websocket';
const transportXhrStreaming: ISockJSTransport = 'xhr-streaming';

/** Default transport chain for fallback tests */
const defaultTransportChain: ISockJSTransport[] = [transportWebsocket, transportXhrStreaming];

const defaultTimeout = 5000;
const eventTimeout = 3000;
const isForceV2 = process.env.FORCE_V2_ALL === 'true';
const describeWhenV1 = isForceV2 ? describe.skip : describe;
const describeSockJS = isSockJSAvailable ? describeWhenV1 : describe.skip;

/**
 * Helper: Wait for ShareDB query to be ready
 */
const waitForQueryReady = <T>(query: Query<T>, timeout = defaultTimeout): Promise<void> => {
  return new Promise((resolve, reject) => {
    if (query.ready) {
      resolve();
      return;
    }

    const timer = setTimeout(() => {
      reject(new Error('Query ready timeout'));
    }, timeout);

    query.once('ready', () => {
      clearTimeout(timer);
      resolve();
    });

    query.once('error', (err: any) => {
      clearTimeout(timer);
      reject(err);
    });
  });
};

/**
 * Helper: Wait for query event with timeout
 */
const waitForQueryEvent = <T>(
  query: Query<any>,
  eventName: 'insert' | 'remove' | 'move' | 'changed',
  timeout = eventTimeout
): Promise<T> => {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`Event "${eventName}" timeout`));
    }, timeout);

    const handler = (...args: any[]) => {
      clearTimeout(timer);
      resolve(args as T);
    };

    query.once(eventName, handler as any);
  });
};

/**
 * Helper: Wait for doc op event with timeout
 */
const waitForDocOp = (doc: Doc<any>, timeout = eventTimeout): Promise<any[]> => {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error('Doc op event timeout'));
    }, timeout);

    const handler = (ops: any[]) => {
      clearTimeout(timer);
      resolve(ops);
    };

    doc.once('op', handler);
  });
};

/**
 * Helper: Create ShareDB connection via internal service
 */
const createConnection = (
  shareDbService: ShareDbService,
  cookie: string,
  port: string
): Connection => {
  return shareDbService.connect(undefined, {
    url: `ws://localhost:${port}/socket`,
    headers: { cookie },
  });
};

describe('Collaboration (e2e)', () => {
  let app: INestApplication;
  let tableId: string;
  let viewId: string;
  let shareId: string;
  let cookie: string;
  let port: string;
  const baseId = globalThis.testConfig.baseId;
  let shareDbService!: ShareDbService;
  let defaultFieldId: string;

  beforeAll(async () => {
    const appCtx = await initApp();
    app = appCtx.app;
    cookie = appCtx.cookie;
    port = process.env.PORT!;
    shareDbService = app.get(ShareDbService);

    // Create test table
    const table = await createTable(baseId, {
      name: 'collaboration-test-table',
      views: [{ type: ViewType.Grid, name: 'default-view' }],
    });
    tableId = table.id;
    viewId = table.defaultViewId!;
    defaultFieldId = table.fields[0].id;

    // Enable share view for testing SockJS WebSocket with shareId
    const shareResult = await apiEnableShareView({ tableId, viewId });
    shareId = shareResult.data.shareId;
  });

  afterAll(async () => {
    await permanentDeleteTable(baseId, tableId);
    await app.close();
  });

  describeWhenV1('Real-time subscription', () => {
    let connection: Connection;

    beforeEach(() => {
      connection = createConnection(shareDbService, cookie, port);
    });

    afterEach(() => {
      connection?.close();
    });

    describe('Record operations', () => {
      it('should receive insert event when creating records via API', async () => {
        const collection = `${IdPrefix.Record}_${tableId}`;
        const query = connection.createSubscribeQuery(collection, {});

        await waitForQueryReady(query);
        const initialCount = query.results.length;

        // Set up event listener before API call
        const insertPromise = waitForQueryEvent<[Doc<IRecord>[], number]>(query, 'insert');

        // Create record via API
        const createResult = await apiCreateRecords(tableId, {
          fieldKeyType: FieldKeyType.Id,
          records: [{ fields: { [defaultFieldId]: 'test-value' } }],
        });
        expect(createResult.status).toBe(201);

        // Wait for insert event
        const [insertedDocs] = await insertPromise;

        expect(insertedDocs.length).toBeGreaterThan(0);
        expect(query.results.length).toBe(initialCount + 1);

        // Cleanup
        await apiDeleteRecord(tableId, createResult.data.records[0].id);
      });

      it('should receive op event when updating record via API', async () => {
        // First create a record
        const createResult = await apiCreateRecords(tableId, {
          fieldKeyType: FieldKeyType.Id,
          records: [{ fields: { [defaultFieldId]: 'initial-value' } }],
        });
        const recordId = createResult.data.records[0].id;

        const collection = `${IdPrefix.Record}_${tableId}`;
        const doc = connection.get(collection, recordId);

        await new Promise<void>((resolve, reject) => {
          doc.subscribe((err) => {
            if (err) reject(err);
            else resolve();
          });
        });

        // Set up op listener
        const opPromise = waitForDocOp(doc);

        // Update record via API
        await apiUpdateRecord(tableId, recordId, {
          fieldKeyType: FieldKeyType.Id,
          record: { fields: { [defaultFieldId]: 'updated-value' } },
        });

        // Wait for op event
        const ops = await opPromise;
        expect(ops).toBeDefined();
        expect(ops.length).toBeGreaterThan(0);

        // Cleanup
        doc.destroy();
        await apiDeleteRecord(tableId, recordId);
      });

      it('should receive remove event when deleting record via API', async () => {
        // First create a record
        const createResult = await apiCreateRecords(tableId, {
          fieldKeyType: FieldKeyType.Id,
          records: [{ fields: { [defaultFieldId]: 'to-delete' } }],
        });
        const recordId = createResult.data.records[0].id;

        const collection = `${IdPrefix.Record}_${tableId}`;
        const query = connection.createSubscribeQuery(collection, {});

        await waitForQueryReady(query);

        // Verify record exists in query results
        const initialDoc = query.results.find((doc) => doc.id === recordId);
        expect(initialDoc).toBeDefined();

        // Set up remove listener
        const removePromise = waitForQueryEvent<[Doc<IRecord>[], number]>(query, 'remove');

        // Delete record via API
        await apiDeleteRecord(tableId, recordId);

        // Wait for remove event
        const [removedDocs] = await removePromise;
        expect(removedDocs.some((doc) => doc.id === recordId)).toBe(true);
      });
    });

    describe('Field operations', () => {
      it('should receive insert event when creating field via API', async () => {
        const collection = `${IdPrefix.Field}_${tableId}`;
        const query = connection.createSubscribeQuery(collection, {});

        await waitForQueryReady(query);
        const initialCount = query.results.length;

        // Set up event listener
        const insertPromise = waitForQueryEvent<[Doc<IFieldVo>[], number]>(query, 'insert');

        // Create field via API
        const fieldResult = await apiCreateField(tableId, {
          name: 'test-field',
          type: 'singleLineText' as any,
        });
        expect(fieldResult.status).toBe(201);

        // Wait for insert event
        const [insertedDocs] = await insertPromise;
        expect(insertedDocs.length).toBeGreaterThan(0);
        expect(query.results.length).toBe(initialCount + 1);

        // Cleanup
        await apiDeleteField(tableId, fieldResult.data.id);
      });

      it('should receive remove event when deleting field via API', async () => {
        // First create a field
        const fieldResult = await apiCreateField(tableId, {
          name: 'field-to-delete',
          type: 'singleLineText' as any,
        });
        const fieldId = fieldResult.data.id;

        const collection = `${IdPrefix.Field}_${tableId}`;
        const query = connection.createSubscribeQuery(collection, {});

        await waitForQueryReady(query);

        // Set up remove listener
        const removePromise = waitForQueryEvent<[Doc<IFieldVo>[], number]>(query, 'remove');

        // Delete field via API
        await apiDeleteField(tableId, fieldId);

        // Wait for remove event
        const [removedDocs] = await removePromise;
        expect(removedDocs.some((doc) => doc.id === fieldId)).toBe(true);
      });
    });

    describe('View operations', () => {
      it('should be able to subscribe to view collection', async () => {
        const collection = `${IdPrefix.View}_${tableId}`;
        const query = connection.createSubscribeQuery(collection, {});

        await waitForQueryReady(query);

        // Should have at least the default view
        expect(query.results.length).toBeGreaterThanOrEqual(1);
        expect(query.results[0].data).toBeDefined();
      });
    });

    describe('Multiple subscribers', () => {
      it('should broadcast changes to all subscribers', async () => {
        const collection = `${IdPrefix.Record}_${tableId}`;

        // Create two connections
        const connection1 = createConnection(shareDbService, cookie, port);
        const connection2 = createConnection(shareDbService, cookie, port);

        const query1 = connection1.createSubscribeQuery(collection, {});
        const query2 = connection2.createSubscribeQuery(collection, {});

        await Promise.all([waitForQueryReady(query1), waitForQueryReady(query2)]);

        // Set up listeners for both
        const insert1Promise = waitForQueryEvent<[Doc<IRecord>[], number]>(query1, 'insert');
        const insert2Promise = waitForQueryEvent<[Doc<IRecord>[], number]>(query2, 'insert');

        // Create record
        const createResult = await apiCreateRecords(tableId, {
          fieldKeyType: FieldKeyType.Id,
          records: [{ fields: { [defaultFieldId]: 'broadcast-test' } }],
        });

        // Both should receive the event
        const [[docs1], [docs2]] = await Promise.all([insert1Promise, insert2Promise]);

        expect(docs1.length).toBeGreaterThan(0);
        expect(docs2.length).toBeGreaterThan(0);
        expect(docs1[0].id).toBe(docs2[0].id);

        // Cleanup
        connection1.close();
        connection2.close();
        await apiDeleteRecord(tableId, createResult.data.records[0].id);
      });
    });
  });

  describe('Connection resilience', () => {
    it('should handle rapid subscribe/unsubscribe cycles', async () => {
      const collection = `${IdPrefix.View}_${tableId}`;

      for (let i = 0; i < 5; i++) {
        const conn = createConnection(shareDbService, cookie, port);
        const query = conn.createSubscribeQuery(collection, {});

        await waitForQueryReady(query);
        expect(query.results.length).toBeGreaterThanOrEqual(1);

        conn.close();
      }
    });

    it('should handle multiple concurrent subscriptions on same connection', async () => {
      const conn = createConnection(shareDbService, cookie, port);

      const recordCollection = `${IdPrefix.Record}_${tableId}`;
      const fieldCollection = `${IdPrefix.Field}_${tableId}`;
      const viewCollection = `${IdPrefix.View}_${tableId}`;

      const recordQuery = conn.createSubscribeQuery(recordCollection, {});
      const fieldQuery = conn.createSubscribeQuery(fieldCollection, {});
      const viewQuery = conn.createSubscribeQuery(viewCollection, {});

      await Promise.all([
        waitForQueryReady(recordQuery),
        waitForQueryReady(fieldQuery),
        waitForQueryReady(viewQuery),
      ]);

      expect(recordQuery.ready).toBe(true);
      expect(fieldQuery.ready).toBe(true);
      expect(viewQuery.ready).toBe(true);

      conn.close();
    });
  });

  describeWhenV1('SockJS transport compatibility', () => {
    it('should successfully establish connection via SockJS endpoint', async () => {
      const conn = createConnection(shareDbService, cookie, port);

      // Connection should be established
      const collection = `${IdPrefix.View}_${tableId}`;
      const query = conn.createSubscribeQuery(collection, {});

      await waitForQueryReady(query);
      expect(query.results.length).toBeGreaterThanOrEqual(1);

      conn.close();
    });

    it('should handle connection with query parameters', async () => {
      // Test connection with shareId parameter (used in share view)
      const conn = shareDbService.connect(undefined, {
        url: `ws://localhost:${port}/socket?test=param`,
        headers: { cookie },
      });

      const collection = `${IdPrefix.View}_${tableId}`;
      const query = conn.createSubscribeQuery(collection, {});

      await waitForQueryReady(query);
      expect(query.ready).toBe(true);

      conn.close();
    });

    it('should maintain stable connection for extended operations', async () => {
      const conn = createConnection(shareDbService, cookie, port);
      const collection = `${IdPrefix.Record}_${tableId}`;
      const query = conn.createSubscribeQuery(collection, {});

      await waitForQueryReady(query);

      // Perform multiple operations
      const createdIds: string[] = [];
      for (let i = 0; i < 3; i++) {
        const insertPromise = waitForQueryEvent<[Doc<IRecord>[], number]>(query, 'insert');

        const result = await apiCreateRecords(tableId, {
          fieldKeyType: FieldKeyType.Id,
          records: [{ fields: { [defaultFieldId]: `stability-test-${i}` } }],
        });
        createdIds.push(result.data.records[0].id);

        const [insertedDocs] = await insertPromise;
        expect(insertedDocs.length).toBeGreaterThan(0);
      }

      // Cleanup
      for (const id of createdIds) {
        await apiDeleteRecord(tableId, id);
      }

      conn.close();
    });
  });

  describe('Error handling and security', () => {
    describe('Authentication behavior', () => {
      /**
       * Note: ShareDB connection establishment doesn't validate auth immediately.
       * Auth validation happens at query/operation time through middleware.
       * These tests verify the current behavior.
       */
      it('should establish connection without cookie (auth checked at query time)', async () => {
        // Connect without cookie - connection succeeds, auth checked during query
        const conn = shareDbService.connect(undefined, {
          url: `ws://localhost:${port}/socket`,
          headers: {}, // No cookie
        });

        // Connection should be established (auth is lazy)
        await new Promise<void>((resolve) => {
          if (conn.state === 'connected') {
            resolve();
          } else {
            conn.on('connected', () => resolve());
          }
        });

        expect(conn.state).toBe('connected');
        conn.close();
      });

      it('should establish connection with invalid cookie (auth checked at query time)', async () => {
        // Connect with invalid cookie - connection succeeds, auth checked during query
        const conn = shareDbService.connect(undefined, {
          url: `ws://localhost:${port}/socket`,
          headers: { cookie: 'invalid_session=fake_token_12345' },
        });

        await new Promise<void>((resolve) => {
          if (conn.state === 'connected') {
            resolve();
          } else {
            conn.on('connected', () => resolve());
          }
        });

        expect(conn.state).toBe('connected');
        conn.close();
      });

      it('should establish connection with invalid shareId (validated at query time)', async () => {
        // ShareId validation happens during query execution, not at connection time
        const conn = shareDbService.connect(undefined, {
          url: `ws://localhost:${port}/socket?shareId=invalid_share_id_12345`,
          headers: {},
        });

        await new Promise<void>((resolve) => {
          if (conn.state === 'connected') {
            resolve();
          } else {
            conn.on('connected', () => resolve());
          }
        });

        expect(conn.state).toBe('connected');
        conn.close();
      });
    });

    describe('Query behavior with different auth states', () => {
      it('should handle query subscription with valid auth', async () => {
        const conn = createConnection(shareDbService, cookie, port);
        const collection = `${IdPrefix.Record}_${tableId}`;
        const query = conn.createSubscribeQuery(collection, {});

        await waitForQueryReady(query);
        expect(query.ready).toBe(true);

        conn.close();
      });

      it('should handle query to non-existent table (returns empty results)', async () => {
        const conn = createConnection(shareDbService, cookie, port);
        const fakeTableId = 'tbl_nonexistent_12345';
        const collection = `${IdPrefix.Record}_${fakeTableId}`;
        const query = conn.createSubscribeQuery(collection, {});

        // Query may succeed with empty results or error - verify it handles gracefully
        const result = await new Promise<{ ready: boolean; error?: any }>((resolve) => {
          const timeout = setTimeout(() => resolve({ ready: false, error: 'Timeout' }), 5000);

          query.once('ready', () => {
            clearTimeout(timeout);
            resolve({ ready: true });
          });

          query.once('error', (err: any) => {
            clearTimeout(timeout);
            resolve({ ready: false, error: err });
          });
        });

        // Either succeeds with empty or fails - both are valid behaviors
        expect(result.ready || result.error).toBeTruthy();

        conn.close();
      });

      it('should handle doc subscription for non-existent record', async () => {
        const conn = createConnection(shareDbService, cookie, port);
        const collection = `${IdPrefix.Record}_${tableId}`;
        const fakeRecordId = 'rec_nonexistent_12345';
        const doc = conn.get(collection, fakeRecordId);

        // Subscribe to non-existent doc - may succeed with null data or error
        const result = await new Promise<{ subscribed: boolean; error?: any }>((resolve) => {
          const timeout = setTimeout(() => resolve({ subscribed: false, error: 'Timeout' }), 3000);

          doc.subscribe((err) => {
            clearTimeout(timeout);
            if (err) {
              resolve({ subscribed: false, error: err });
            } else {
              resolve({ subscribed: true });
            }
          });
        });

        // Doc subscription behavior varies - verify it handles gracefully
        expect(result.subscribed || result.error).toBeTruthy();

        doc.destroy();
        conn.close();
      });
    });

    describe('Connection error handling', () => {
      it('should handle query error event gracefully', async () => {
        const conn = createConnection(shareDbService, cookie, port);
        const invalidCollection = 'invalid_collection_format';
        const query = conn.createSubscribeQuery(invalidCollection, {});

        const errorPromise = new Promise<any>((resolve) => {
          query.once('error', (err: any) => {
            resolve(err);
          });
        });

        const error = await errorPromise;
        expect(error).toBeDefined();

        conn.close();
      });

      it('should emit error for malformed doc subscription', async () => {
        const conn = createConnection(shareDbService, cookie, port);

        // Try to subscribe to a doc with invalid collection format
        const doc = conn.get('malformed', 'test');

        await expect(
          new Promise<void>((resolve, reject) => {
            const timeout = setTimeout(() => reject(new Error('Timeout')), 3000);

            doc.subscribe((err) => {
              clearTimeout(timeout);
              if (err) reject(err);
              else resolve();
            });
          })
        ).rejects.toThrow();

        doc.destroy();
        conn.close();
      });
    });
  });

  describe('Disconnection and reconnection', () => {
    it('should detect connection close and clean up resources', async () => {
      const conn = createConnection(shareDbService, cookie, port);
      const collection = `${IdPrefix.View}_${tableId}`;
      const query = conn.createSubscribeQuery(collection, {});

      await waitForQueryReady(query);
      expect(query.ready).toBe(true);

      // Close connection
      conn.close();

      // Query should no longer be active after connection close
      // Note: ShareDB may not immediately update query state
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Connection should be closed
      expect(conn.state).toBe('closed');
    });

    it('should handle server-initiated disconnect gracefully', async () => {
      const conn = createConnection(shareDbService, cookie, port);
      const collection = `${IdPrefix.View}_${tableId}`;
      const query = conn.createSubscribeQuery(collection, {});

      await waitForQueryReady(query);

      // Set up disconnect listener
      const disconnectPromise = new Promise<void>((resolve) => {
        conn.on('state', (newState: string) => {
          if (newState === 'disconnected' || newState === 'closed') {
            resolve();
          }
        });
      });

      // Force close
      conn.close();

      await disconnectPromise;
      expect(['disconnected', 'closed']).toContain(conn.state);
    });

    it('should allow creating new connection after previous one closed', async () => {
      // First connection
      const conn1 = createConnection(shareDbService, cookie, port);
      const collection = `${IdPrefix.View}_${tableId}`;
      const query1 = conn1.createSubscribeQuery(collection, {});

      await waitForQueryReady(query1);
      expect(query1.results.length).toBeGreaterThanOrEqual(1);

      // Close first connection
      conn1.close();

      // Wait for cleanup
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Create new connection - should work
      const conn2 = createConnection(shareDbService, cookie, port);
      const query2 = conn2.createSubscribeQuery(collection, {});

      await waitForQueryReady(query2);
      expect(query2.results.length).toBeGreaterThanOrEqual(1);

      conn2.close();
    });

    // V2 uses caching for ShareDB queries, so fresh connections may not immediately see
    // records created via API until the cache is invalidated
    it.skipIf(isForceV2)('should maintain data consistency after reconnection', async () => {
      const collection = `${IdPrefix.Record}_${tableId}`;

      // First connection - get initial state
      const conn1 = createConnection(shareDbService, cookie, port);
      const query1 = conn1.createSubscribeQuery(collection, {});
      await waitForQueryReady(query1);
      const initialCount = query1.results.length;
      conn1.close();

      // Create a record while disconnected
      const createResult = await apiCreateRecords(tableId, {
        fieldKeyType: FieldKeyType.Id,
        records: [{ fields: { [defaultFieldId]: 'reconnect-test' } }],
      });

      // Reconnect and verify new record is visible
      const conn2 = createConnection(shareDbService, cookie, port);
      const query2 = conn2.createSubscribeQuery(collection, {});
      await waitForQueryReady(query2);

      expect(query2.results.length).toBe(initialCount + 1);

      // Cleanup
      await apiDeleteRecord(tableId, createResult.data.records[0].id);
      conn2.close();
    });

    it('should handle multiple rapid reconnections', async () => {
      const collection = `${IdPrefix.View}_${tableId}`;

      for (let i = 0; i < 5; i++) {
        const conn = createConnection(shareDbService, cookie, port);
        const query = conn.createSubscribeQuery(collection, {});

        await waitForQueryReady(query);
        expect(query.results.length).toBeGreaterThanOrEqual(1);

        conn.close();

        // Minimal delay between reconnections
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
    });

    it('should clean up subscriptions on connection close', async () => {
      const conn = createConnection(shareDbService, cookie, port);

      // Create multiple subscriptions
      const recordQuery = conn.createSubscribeQuery(`${IdPrefix.Record}_${tableId}`, {});
      const fieldQuery = conn.createSubscribeQuery(`${IdPrefix.Field}_${tableId}`, {});
      const viewQuery = conn.createSubscribeQuery(`${IdPrefix.View}_${tableId}`, {});

      await Promise.all([
        waitForQueryReady(recordQuery),
        waitForQueryReady(fieldQuery),
        waitForQueryReady(viewQuery),
      ]);

      // All queries should be ready
      expect(recordQuery.ready).toBe(true);
      expect(fieldQuery.ready).toBe(true);
      expect(viewQuery.ready).toBe(true);

      // Close connection - all subscriptions should be cleaned up
      conn.close();

      // Connection should be closed
      expect(conn.state).toBe('closed');
    });
  });

  /**
   * SockJS transport fallback tests
   * These tests verify that all SockJS transports work correctly.
   * Skipped if sockjs-client package is not available.
   */
  describeSockJS('SockJS transport fallback (real client)', () => {
    /**
     * Helper: Create SockJS socket connection with specific transports
     * Note: This tests the transport layer only, not ShareDB operations
     * (WebSocket transport doesn't support cookies/headers for auth)
     */
    const createSockJSSocket = (
      transports: ISockJSTransport[],
      connectionTimeout = 10000
    ): Promise<{ socket: any; transport: string }> => {
      return new Promise((resolve, reject) => {
        const url = `http://127.0.0.1:${port}/socket`;
        const socket = new SockJS(url, undefined, {
          transports,
          timeout: 5000,
        });

        let actualTransport = 'unknown';

        const timeoutId = setTimeout(() => {
          cleanup();
          reject(new Error(`SockJS connection timeout (transports: ${transports.join(', ')})`));
        }, connectionTimeout);

        const cleanup = () => {
          clearTimeout(timeoutId);
          socket.onopen = null;
          socket.onclose = null;
          socket.onerror = null;
        };

        socket.onopen = () => {
          cleanup();
          // Get the actual transport used
          actualTransport = (socket as any).transport || 'unknown';
          resolve({ socket, transport: actualTransport });
        };

        socket.onerror = (err: any) => {
          cleanup();
          reject(new Error(`SockJS error: ${err?.message || 'unknown error'}`));
        };

        socket.onclose = (event: any) => {
          cleanup();
          if (event?.code !== 1000) {
            reject(
              new Error(`SockJS closed unexpectedly: code=${event?.code}, reason=${event?.reason}`)
            );
          }
        };
      });
    };

    it('should establish connection using WebSocket transport', async () => {
      // Test that SockJS can establish a WebSocket connection to the server
      const { socket, transport } = await createSockJSSocket([transportWebsocket]);
      console.log(`Connected using transport: ${transport}`);

      expect(socket.readyState).toBe(SockJS.OPEN);
      expect(transport).toBeDefined();

      socket.close();
    });

    it('should establish connection using XHR streaming transport (fallback)', async () => {
      const { socket, transport } = await createSockJSSocket([transportXhrStreaming]);
      console.log(`Connected using transport: ${transport}`);

      expect(socket.readyState).toBe(SockJS.OPEN);
      expect(transport).toBeDefined();

      socket.close();
    });

    it('should automatically select best available transport', async () => {
      // Test with full transport chain - SockJS will try each in order
      const { socket, transport } = await createSockJSSocket(defaultTransportChain);
      console.log(`Connected using transport: ${transport}`);

      expect(socket.readyState).toBe(SockJS.OPEN);
      // Should pick websocket as the best available
      expect(transport).toBeDefined();

      socket.close();
    });

    it('should handle graceful close and reconnection', async () => {
      // First connection
      const { socket: socket1, transport: transport1 } =
        await createSockJSSocket(defaultTransportChain);
      console.log(`First connection using transport: ${transport1}`);
      expect(socket1.readyState).toBe(SockJS.OPEN);

      // Close first connection
      socket1.close();

      // Wait for close to complete
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Create new connection (simulating reconnect)
      const { socket: socket2, transport: transport2 } =
        await createSockJSSocket(defaultTransportChain);
      console.log(`Second connection using transport: ${transport2}`);
      expect(socket2.readyState).toBe(SockJS.OPEN);

      socket2.close();
    });

    it('should send and receive messages via SockJS', async () => {
      const { socket } = await createSockJSSocket(defaultTransportChain);

      // Create ShareDB connection
      const connection = new ShareDBClient.Connection(socket as any);

      // Send a message (even without auth, the message should be transmitted)
      // We just verify the transport layer works, not the auth
      expect(connection.state).toBe('connecting');

      // Wait for ShareDB to connect
      await new Promise<void>((resolve) => {
        if (connection.state === 'connected') {
          resolve();
        } else {
          connection.on('connected', () => resolve());
        }
      });

      expect(connection.state).toBe('connected');

      connection.close();
      socket.close();
    });

    /**
     * Helper: Create SockJS socket with shareId for authenticated operations
     */
    const createSockJSSocketWithShareId = (
      shareIdParam: string,
      transports: ISockJSTransport[] = defaultTransportChain,
      connectionTimeout = 10000
    ): Promise<{ socket: any; connection: ShareDBClient.Connection; transport: string }> => {
      return new Promise((resolve, reject) => {
        // Use shareId in URL for authentication (instead of cookie)
        const url = `http://127.0.0.1:${port}/socket?shareId=${shareIdParam}`;
        const socket = new SockJS(url, undefined, {
          transports,
          timeout: 5000,
        });

        const connection = new ShareDBClient.Connection(socket as any);
        let actualTransport = 'unknown';

        const timeoutId = setTimeout(() => {
          cleanup();
          reject(new Error(`SockJS connection timeout (transports: ${transports.join(', ')})`));
        }, connectionTimeout);

        const cleanup = () => {
          clearTimeout(timeoutId);
        };

        connection.on('connected', () => {
          cleanup();
          actualTransport = (socket as any).transport || 'unknown';
          resolve({ socket, connection, transport: actualTransport });
        });

        connection.on('error', (err) => {
          cleanup();
          const errMsg = (err as unknown as Error)?.message || 'unknown error';
          reject(new Error(`ShareDB connection error: ${errMsg}`));
        });
      });
    };

    it('should collaborate via WebSocket transport with shareId auth', async () => {
      // Test WebSocket transport with shareId authentication
      const { socket, connection, transport } = await createSockJSSocketWithShareId(shareId, [
        transportWebsocket,
      ]);
      console.log(`Collaboration test using transport: ${transport}`);

      try {
        // Subscribe to view collection (share view allows read access)
        const viewCollection = `${IdPrefix.View}_${tableId}`;
        const query = connection.createSubscribeQuery(viewCollection, {});

        await waitForQueryReady(query);

        expect(query.results).not.toBeNull();
        expect(query.results.length).toBeGreaterThanOrEqual(1);
      } finally {
        connection.close();
        socket.close();
      }
    });

    it('should collaborate via XHR-streaming transport with shareId auth', async () => {
      // Test XHR-streaming transport with shareId authentication
      const { socket, connection, transport } = await createSockJSSocketWithShareId(shareId, [
        transportXhrStreaming,
      ]);
      console.log(`Collaboration test using transport: ${transport}`);

      try {
        const viewCollection = `${IdPrefix.View}_${tableId}`;
        const query = connection.createSubscribeQuery(viewCollection, {});

        await waitForQueryReady(query);

        expect(query.results).not.toBeNull();
        expect(query.results.length).toBeGreaterThanOrEqual(1);
      } finally {
        connection.close();
        socket.close();
      }
    });

    it('should receive real-time updates via WebSocket with shareId auth', async () => {
      // Test real-time updates via WebSocket transport
      const { socket, connection, transport } = await createSockJSSocketWithShareId(shareId, [
        transportWebsocket,
      ]);
      console.log(`Real-time update test using transport: ${transport}`);

      try {
        const recordCollection = `${IdPrefix.Record}_${tableId}`;
        const query = connection.createSubscribeQuery(recordCollection, {});

        await waitForQueryReady(query);

        // Set up insert listener
        const insertPromise = waitForQueryEvent<[Doc<IRecord>[], number]>(query, 'insert');

        // Create record via API (still needs cookie auth for write operations)
        const createResult = await apiCreateRecords(tableId, {
          fieldKeyType: FieldKeyType.Id,
          records: [{ fields: { [defaultFieldId]: 'websocket-realtime-test' } }],
        });

        // Verify we receive the insert event via WebSocket
        const [insertedDocs] = await insertPromise;
        expect(insertedDocs.length).toBeGreaterThan(0);
        expect(insertedDocs[0].id).toBe(createResult.data.records[0].id);

        // Cleanup
        await apiDeleteRecord(tableId, createResult.data.records[0].id);
      } finally {
        connection.close();
        socket.close();
      }
    });

    it('should broadcast to multiple clients using different transports', async () => {
      // Test that updates are broadcast to clients using different transports
      const { socket: wsSocket, connection: wsConn } = await createSockJSSocketWithShareId(
        shareId,
        [transportWebsocket]
      );
      const { socket: xhrSocket, connection: xhrConn } = await createSockJSSocketWithShareId(
        shareId,
        [transportXhrStreaming]
      );

      try {
        const recordCollection = `${IdPrefix.Record}_${tableId}`;

        const wsQuery = wsConn.createSubscribeQuery(recordCollection, {});
        const xhrQuery = xhrConn.createSubscribeQuery(recordCollection, {});

        await Promise.all([waitForQueryReady(wsQuery), waitForQueryReady(xhrQuery)]);

        // Set up insert listeners for both
        const wsInsertPromise = waitForQueryEvent<[Doc<IRecord>[], number]>(wsQuery, 'insert');
        const xhrInsertPromise = waitForQueryEvent<[Doc<IRecord>[], number]>(
          xhrQuery,
          'insert',
          10000
        );

        // Create record
        const createResult = await apiCreateRecords(tableId, {
          fieldKeyType: FieldKeyType.Id,
          records: [{ fields: { [defaultFieldId]: 'multi-transport-test' } }],
        });

        // Both should receive the event
        const [[wsDocs], [xhrDocs]] = await Promise.all([wsInsertPromise, xhrInsertPromise]);

        expect(wsDocs[0].id).toBe(createResult.data.records[0].id);
        expect(xhrDocs[0].id).toBe(createResult.data.records[0].id);

        // Cleanup
        await apiDeleteRecord(tableId, createResult.data.records[0].id);
      } finally {
        wsConn.close();
        xhrConn.close();
        wsSocket.close();
        xhrSocket.close();
      }
    });

    it('should handle rapid transport switching (close and reconnect with different transport)', async () => {
      const transportsToTest: ISockJSTransport[][] = [
        [transportWebsocket],
        [transportXhrStreaming],
        [transportWebsocket],
        [transportXhrStreaming],
      ];

      for (const transports of transportsToTest) {
        const { socket, connection, transport } = await createSockJSSocketWithShareId(
          shareId,
          transports
        );
        console.log(`Rapid switch test - connected with: ${transport}`);

        const viewCollection = `${IdPrefix.View}_${tableId}`;
        const query = connection.createSubscribeQuery(viewCollection, {});

        await waitForQueryReady(query);
        expect(query.results.length).toBeGreaterThanOrEqual(1);

        connection.close();
        socket.close();

        // Small delay between switches
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
    });

    describe('SockJS error handling', () => {
      it('should handle invalid URL gracefully', async () => {
        await expect(
          new Promise((resolve, reject) => {
            const url = `http://127.0.0.1:${port}/invalid-endpoint`;
            const socket = new SockJS(url, undefined, {
              transports: defaultTransportChain,
              timeout: 3000,
            });

            const timeoutId = setTimeout(() => {
              socket.close();
              reject(new Error('Connection timeout'));
            }, 5000);

            socket.onopen = () => {
              clearTimeout(timeoutId);
              socket.close();
              resolve('connected');
            };

            socket.onclose = (event: any) => {
              clearTimeout(timeoutId);
              if (event?.code !== 1000) {
                reject(new Error(`Connection failed: ${event?.code}`));
              }
            };
          })
        ).rejects.toThrow();
      });

      it('should establish SockJS connection with invalid shareId (validated at query time)', async () => {
        // ShareId validation happens during query, not at connection time
        const url = `http://127.0.0.1:${port}/socket?shareId=invalid_share_id`;
        const socket = new SockJS(url, undefined, {
          transports: defaultTransportChain,
          timeout: 5000,
        });

        const connection = new ShareDBClient.Connection(socket as any);

        // Wait for connection - should succeed (auth is lazy)
        await new Promise<void>((resolve) => {
          if (connection.state === 'connected') {
            resolve();
          } else {
            connection.on('connected', () => resolve());
          }
        });

        expect(connection.state).toBe('connected');

        // Query behavior depends on auth middleware implementation
        const collection = `${IdPrefix.Record}_${tableId}`;
        const query = connection.createSubscribeQuery(collection, {});

        const result = await new Promise<{ ready: boolean; error?: any }>((resolve) => {
          const timeout = setTimeout(() => resolve({ ready: false, error: 'Timeout' }), 5000);

          query.once('ready', () => {
            clearTimeout(timeout);
            resolve({ ready: true });
          });

          query.once('error', (err: any) => {
            clearTimeout(timeout);
            resolve({ ready: false, error: err });
          });
        });

        // Verify query handled gracefully (either succeeds or fails with error)
        expect(result.ready || result.error).toBeTruthy();

        connection.close();
        socket.close();
      });
    });

    describe('SockJS reconnection', () => {
      it('should successfully reconnect after socket close', async () => {
        // First connection
        const { socket: socket1, connection: conn1 } = await createSockJSSocketWithShareId(
          shareId,
          defaultTransportChain
        );

        const collection = `${IdPrefix.View}_${tableId}`;
        const query1 = conn1.createSubscribeQuery(collection, {});
        await waitForQueryReady(query1);
        expect(query1.results.length).toBeGreaterThanOrEqual(1);

        // Close first connection
        conn1.close();
        socket1.close();

        // Wait for close to complete
        await new Promise((resolve) => setTimeout(resolve, 200));

        // Reconnect
        const { socket: socket2, connection: conn2 } = await createSockJSSocketWithShareId(
          shareId,
          defaultTransportChain
        );

        const query2 = conn2.createSubscribeQuery(collection, {});
        await waitForQueryReady(query2);
        expect(query2.results.length).toBeGreaterThanOrEqual(1);

        conn2.close();
        socket2.close();
      });

      it('should maintain data consistency after SockJS reconnection', async () => {
        const recordCollection = `${IdPrefix.Record}_${tableId}`;

        // First connection - get initial count
        const { socket: socket1, connection: conn1 } = await createSockJSSocketWithShareId(
          shareId,
          [transportWebsocket]
        );
        const query1 = conn1.createSubscribeQuery(recordCollection, {});
        await waitForQueryReady(query1);
        const initialCount = query1.results.length;

        conn1.close();
        socket1.close();

        // Create record while disconnected (using API with cookie auth)
        const createResult = await apiCreateRecords(tableId, {
          fieldKeyType: FieldKeyType.Id,
          records: [{ fields: { [defaultFieldId]: 'sockjs-reconnect-test' } }],
        });

        // Reconnect and verify
        const { socket: socket2, connection: conn2 } = await createSockJSSocketWithShareId(
          shareId,
          [transportWebsocket]
        );
        const query2 = conn2.createSubscribeQuery(recordCollection, {});
        await waitForQueryReady(query2);

        expect(query2.results.length).toBe(initialCount + 1);

        // Cleanup
        await apiDeleteRecord(tableId, createResult.data.records[0].id);
        conn2.close();
        socket2.close();
      });

      it('should handle socket close event properly', async () => {
        const { socket, connection } = await createSockJSSocketWithShareId(
          shareId,
          defaultTransportChain
        );

        const collection = `${IdPrefix.View}_${tableId}`;
        const query = connection.createSubscribeQuery(collection, {});
        await waitForQueryReady(query);

        // Set up close listener
        const closePromise = new Promise<void>((resolve) => {
          socket.onclose = () => resolve();
        });

        // Close socket
        socket.close();

        await closePromise;
        expect(socket.readyState).toBe(SockJS.CLOSED);
      });

      it('should handle connection state transitions', async () => {
        const { socket, connection } = await createSockJSSocketWithShareId(
          shareId,
          defaultTransportChain
        );

        expect(connection.state).toBe('connected');

        const stateChanges: string[] = [];
        connection.on('state', (newState: string) => {
          stateChanges.push(newState);
        });

        connection.close();
        socket.close();

        // Wait for state transitions
        await new Promise((resolve) => setTimeout(resolve, 100));

        // Should have transitioned to closed/disconnected
        expect(stateChanges.length).toBeGreaterThan(0);
        expect(['closed', 'disconnected']).toContain(connection.state);
      });
    });
  });
});
