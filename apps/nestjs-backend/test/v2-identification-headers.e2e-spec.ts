/* eslint-disable sonarjs/no-duplicate-string */
import type { INestApplication } from '@nestjs/common';
import { FieldKeyType, getRandomString } from '@teable/core';
import {
  axios,
  getTaskStatusCollection,
  getRecords,
  OPERATION_REDO_STREAM,
  OPERATION_UNDO_STREAM,
  redo,
  undo,
  updateRecord,
  urlBuilder,
} from '@teable/openapi';
import type { ITableFullVo, IUndoRedoStreamDoneEvent, IUndoRedoStreamEvent } from '@teable/openapi';
import { EventEmitterService } from '../src/event-emitter/event-emitter.service';
import { Events } from '../src/event-emitter/events';

import {
  X_TEABLE_V2_FEATURE_HEADER,
  X_TEABLE_V2_HEADER,
  X_TEABLE_V2_REASON_HEADER,
} from '../src/features/canary/interceptors/v2-indicator.interceptor';
import { X_TEABLE_UNDO_REDO_ENGINE_HEADER } from '../src/features/undo-redo/open-api/undo-redo.service';

import { createTable, initApp, permanentDeleteTable, updateRecordByApi } from './utils/init-app';

/**
 * REQ-V2-01: every table response must carry the V2 identification headers
 * (`x-teable-v2` / `x-teable-v2-reason` / `x-teable-v2-feature`).
 *
 * T7804: `GET /api/table/:tableId/aggregation/task-status-collection` reported
 * `x-teable-v2: false` + reason `no_feature` because the route never registered
 * a V2 feature with the request hub, unlike its aggregation siblings.
 *
 * T7805: `POST /api/table/:tableId/undo-redo/undo-stream` and `/redo-stream`
 * (the routes the grid actually calls for Cmd+Z / Cmd+Shift+Z) carried no V2
 * headers at all, because `UndoRedoController` was never wired to the hub and
 * the SSE response flushes its headers before the handler returns.
 */
const windowIdHeader = 'x-window-id';

const postSseStream = async (
  operation: string,
  tableId: string,
  cookie: string,
  windowId: string
): Promise<{
  status: number;
  headers: Record<string, string | null>;
  events: IUndoRedoStreamEvent[];
}> => {
  const streamUrl = axios.getUri({
    baseURL: axios.defaults.baseURL,
    url: urlBuilder(operation, { tableId }),
  });

  const response = await fetch(streamUrl, {
    method: 'POST',
    headers: {
      Accept: 'text/event-stream',
      Cookie: cookie,
      [windowIdHeader]: windowId,
    },
  });

  const events: IUndoRedoStreamEvent[] = [];
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  // eslint-disable-next-line no-constant-condition
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';

    for (const line of lines) {
      if (!line.startsWith('data:')) continue;
      const jsonStr = line.slice(5).trim();
      if (!jsonStr || jsonStr === '[DONE]') continue;
      events.push(JSON.parse(jsonStr) as IUndoRedoStreamEvent);
    }
  }

  return {
    status: response.status,
    headers: {
      [X_TEABLE_V2_HEADER]: response.headers.get(X_TEABLE_V2_HEADER),
      [X_TEABLE_V2_REASON_HEADER]: response.headers.get(X_TEABLE_V2_REASON_HEADER),
      [X_TEABLE_V2_FEATURE_HEADER]: response.headers.get(X_TEABLE_V2_FEATURE_HEADER),
      [X_TEABLE_UNDO_REDO_ENGINE_HEADER]: response.headers.get(X_TEABLE_UNDO_REDO_ENGINE_HEADER),
    },
    events,
  };
};

describe('V2 identification headers for task-status-collection and undo/redo (T7804 T7805)', () => {
  let app: INestApplication;
  let cookie: string;
  let table: ITableFullVo;
  let windowId: string;
  let previousWindowId: (typeof axios.defaults.headers.common)[string];
  let eventEmitterService: EventEmitterService;

  const baseId = globalThis.testConfig.baseId;

  beforeAll(async () => {
    const appContext = await initApp();
    app = appContext.app;
    cookie = appContext.cookie;
    eventEmitterService = app.get(EventEmitterService);
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    previousWindowId = axios.defaults.headers.common[windowIdHeader];
    windowId = `win${getRandomString(8)}`;
    axios.defaults.headers.common[windowIdHeader] = windowId;
    table = await createTable(baseId, { name: `v2_headers_${getRandomString(4)}` });
  });

  afterEach(async () => {
    try {
      await permanentDeleteTable(baseId, table.id);
    } finally {
      if (previousWindowId === undefined) {
        delete axios.defaults.headers.common[windowIdHeader];
      } else {
        axios.defaults.headers.common[windowIdHeader] = previousWindowId;
      }
    }
  });

  it('aggregation/task-status-collection identifies as V2 like its aggregation siblings (T7804)', async () => {
    const response = await getTaskStatusCollection(table.id);

    expect(response.status).toBe(200);
    expect(response.headers[X_TEABLE_V2_HEADER]).toBe('true');
    expect(response.headers[X_TEABLE_V2_REASON_HEADER]).toBe('env_force_v2_all');
    expect(response.headers[X_TEABLE_V2_FEATURE_HEADER]).toBe('getTaskStatusCollection');

    // control: the aggregation sibling keeps its own attribution
    const recordResponse = await getRecords(table.id, { take: 1 });
    expect(recordResponse.headers[X_TEABLE_V2_HEADER]).toBe('true');
    expect(recordResponse.headers[X_TEABLE_V2_FEATURE_HEADER]).toBe('getRecords');
  });

  it('undo-stream and redo-stream carry the V2 identification headers (T7805)', async () => {
    const recordId = table.records[0].id;
    const fieldId = table.fields[0].id;
    await updateRecordByApi(table.id, recordId, fieldId, 'new value');

    const undoStream = await postSseStream(OPERATION_UNDO_STREAM, table.id, cookie, windowId);
    expect(undoStream.status).toBe(200);
    expect(undoStream.headers[X_TEABLE_V2_HEADER]).toBe('true');
    expect(undoStream.headers[X_TEABLE_V2_REASON_HEADER]).toBe('undo_redo_engine');
    expect(undoStream.headers[X_TEABLE_V2_FEATURE_HEADER]).toBe('undoRedo');
    const undoDone = undoStream.events.find((event) => event.id === 'done') as
      | IUndoRedoStreamDoneEvent
      | undefined;
    expect(undoDone?.status).toBe('fulfilled');
    expect(undoDone?.engine).toBe('v2');

    const redoStream = await postSseStream(OPERATION_REDO_STREAM, table.id, cookie, windowId);
    expect(redoStream.status).toBe(200);
    expect(redoStream.headers[X_TEABLE_V2_HEADER]).toBe('true');
    expect(redoStream.headers[X_TEABLE_V2_REASON_HEADER]).toBe('undo_redo_engine');
    expect(redoStream.headers[X_TEABLE_V2_FEATURE_HEADER]).toBe('undoRedo');
    const redoDone = redoStream.events.find((event) => event.id === 'done') as
      | IUndoRedoStreamDoneEvent
      | undefined;
    expect(redoDone?.status).toBe('fulfilled');
    expect(redoDone?.engine).toBe('v2');
  });

  it('records order-only updates and their replay on the v2 engine (T8437)', async () => {
    const [firstRecord, secondRecord] = table.records;

    const writeResponse = await updateRecord(table.id, firstRecord.id, {
      fieldKeyType: FieldKeyType.Id,
      record: { fields: {} },
      order: {
        viewId: table.views[0].id,
        anchorId: secondRecord.id,
        position: 'after',
      },
    });
    expect(writeResponse.headers[X_TEABLE_V2_HEADER]).toBe('true');
    expect(writeResponse.headers[X_TEABLE_V2_FEATURE_HEADER]).toBe('updateRecord');
    expect(writeResponse.headers[X_TEABLE_V2_REASON_HEADER]).not.toBe('unsupported_feature');

    const undoResponse = await undo(table.id);
    expect(undoResponse.data.status).toBe('fulfilled');
    expect(undoResponse.headers[X_TEABLE_UNDO_REDO_ENGINE_HEADER]).toBe('v2');
    expect(undoResponse.headers[X_TEABLE_V2_HEADER]).toBe('true');

    const redoResponse = await redo(table.id);
    expect(redoResponse.data.status).toBe('fulfilled');
    expect(redoResponse.headers[X_TEABLE_UNDO_REDO_ENGINE_HEADER]).toBe('v2');
    expect(redoResponse.headers[X_TEABLE_V2_HEADER]).toBe('true');
  });

  it('attributes historical v1 undo and redo to v1 even on a v2-routed request', async () => {
    const recordId = table.records[0].id;
    const fieldId = table.fields[0].id;
    const originalValue = table.records[0].fields[fieldId];
    const forceV2All = process.env.FORCE_V2_ALL;
    const enableCanary = process.env.ENABLE_CANARY_FEATURE;

    // A real v1-mode write seeds historical replay without relying on an
    // unsupported payload or replacing either engine's history.
    process.env.FORCE_V2_ALL = 'false';
    process.env.ENABLE_CANARY_FEATURE = 'false';
    let releasePush: (() => void) | undefined;
    try {
      // The v1 stack is filled asynchronously: `UndoRedoStackService.push` emits
      // OPERATION_PUSH only after the entry is persisted, so subscribe before the
      // PATCH and wait for that push before replaying. The wait is bounded and
      // explicitly disposed so a failed v1 persistence cannot strand the shared app.
      const v1StackPush = new Promise<boolean>((resolve) => {
        const emitter = eventEmitterService.eventEmitter;
        const onPush = () => {
          clearTimeout(timer);
          emitter.off(Events.OPERATION_PUSH, onPush);
          resolve(true);
        };
        const timer: ReturnType<typeof setTimeout> = setTimeout(() => {
          emitter.off(Events.OPERATION_PUSH, onPush);
          resolve(false);
        }, 5000);
        releasePush = () => {
          clearTimeout(timer);
          emitter.off(Events.OPERATION_PUSH, onPush);
        };
        emitter.once(Events.OPERATION_PUSH, onPush);
      });
      const writeResponse = await updateRecord(table.id, recordId, {
        fieldKeyType: FieldKeyType.Id,
        record: { fields: { [fieldId]: 'historical v1 value' } },
      });
      expect(writeResponse.headers[X_TEABLE_V2_HEADER]).toBe('false');
      expect(writeResponse.headers[X_TEABLE_V2_REASON_HEADER]).toBe('disabled');
      // Checked after the header assertions so a routing regression fails fast
      // instead of waiting on an event the v2 pipeline never emits.
      expect(await v1StackPush, 'v1 history push was not observed within five seconds').toBe(true);
    } finally {
      releasePush?.();
      if (forceV2All === undefined) delete process.env.FORCE_V2_ALL;
      else process.env.FORCE_V2_ALL = forceV2All;
      if (enableCanary === undefined) delete process.env.ENABLE_CANARY_FEATURE;
      else process.env.ENABLE_CANARY_FEATURE = enableCanary;
    }

    // The v2 stack has nothing for this window, so the service replays the
    // legacy stack: the response reports that stack, not the canary decision.
    const undoResponse = await undo(table.id);
    expect(undoResponse.data.status).toBe('fulfilled');
    expect(undoResponse.headers[X_TEABLE_UNDO_REDO_ENGINE_HEADER]).toBe('v1');
    expect(undoResponse.headers[X_TEABLE_V2_HEADER]).toBe('false');
    expect(undoResponse.headers[X_TEABLE_V2_REASON_HEADER]).toBe('undo_redo_engine');
    expect(undoResponse.headers[X_TEABLE_V2_FEATURE_HEADER]).toBe('undoRedo');
    const undoneRecords = (await getRecords(table.id, { fieldKeyType: FieldKeyType.Id })).data;
    expect(undoneRecords.records.find(({ id }) => id === recordId)?.fields[fieldId]).toEqual(
      originalValue
    );

    // Nothing left to replay: no stack replayed, so the canary stamp stays.
    const emptyUndoResponse = await undo(table.id);
    expect(emptyUndoResponse.data.status).toBe('empty');
    expect(emptyUndoResponse.headers[X_TEABLE_V2_HEADER]).toBe('true');

    const redoResponse = await redo(table.id);
    expect(redoResponse.data.status).toBe('fulfilled');
    expect(redoResponse.headers[X_TEABLE_UNDO_REDO_ENGINE_HEADER]).toBe('v1');
    expect(redoResponse.headers[X_TEABLE_V2_HEADER]).toBe('false');
    expect(redoResponse.headers[X_TEABLE_V2_REASON_HEADER]).toBe('undo_redo_engine');
    expect(redoResponse.headers[X_TEABLE_V2_FEATURE_HEADER]).toBe('undoRedo');
    const redoneRecords = (await getRecords(table.id, { fieldKeyType: FieldKeyType.Id })).data;
    expect(redoneRecords.records.find(({ id }) => id === recordId)?.fields[fieldId]).toBe(
      'historical v1 value'
    );

    const undoStream = await postSseStream(OPERATION_UNDO_STREAM, table.id, cookie, windowId);
    expect(undoStream.headers[X_TEABLE_UNDO_REDO_ENGINE_HEADER]).toBe('v1');
    expect(undoStream.headers[X_TEABLE_V2_HEADER]).toBe('false');
    expect(undoStream.headers[X_TEABLE_V2_REASON_HEADER]).toBe('undo_redo_engine');
    expect(undoStream.events).toContainEqual(
      expect.objectContaining({ id: 'done', engine: 'v1', status: 'fulfilled' })
    );

    const redoStream = await postSseStream(OPERATION_REDO_STREAM, table.id, cookie, windowId);
    expect(redoStream.headers[X_TEABLE_UNDO_REDO_ENGINE_HEADER]).toBe('v1');
    expect(redoStream.headers[X_TEABLE_V2_HEADER]).toBe('false');
    expect(redoStream.headers[X_TEABLE_V2_REASON_HEADER]).toBe('undo_redo_engine');
  });
});
