/* eslint-disable sonarjs/no-duplicate-string */
import type { INestApplication } from '@nestjs/common';
import { FieldKeyType, getRandomString } from '@teable/core';
import {
  axios,
  ensureUndoRedoWindowIdHeader,
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
import { createEventPromise } from './utils/event-promise';
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
    },
    events,
  };
};

describe('V2 identification headers for task-status-collection and undo/redo (T7804 T7805)', () => {
  let app: INestApplication;
  let cookie: string;
  let table: ITableFullVo;
  let windowId: string;
  let eventEmitterService: EventEmitterService;
  const baseId = globalThis.testConfig.baseId;

  beforeAll(async () => {
    const appContext = await initApp();
    app = appContext.app;
    cookie = appContext.cookie;
    eventEmitterService = app.get(EventEmitterService);
    // Spec files share one axios instance per worker (E2E_SHARED_APP), and
    // ensureUndoRedoWindowIdHeader keeps the window id a previous file already
    // installed. Adopt whatever it returns so the write and the streams below
    // address the same undo/redo window.
    windowId = ensureUndoRedoWindowIdHeader(`win${getRandomString(8)}`);
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    table = await createTable(baseId, { name: `v2_headers_${getRandomString(4)}` });
  });

  afterEach(async () => {
    await permanentDeleteTable(baseId, table.id);
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
    expect(undoStream.headers[X_TEABLE_V2_REASON_HEADER]).toBe('env_force_v2_all');
    expect(undoStream.headers[X_TEABLE_V2_FEATURE_HEADER]).toBe('undoRedo');
    const undoDone = undoStream.events.find((event) => event.id === 'done') as
      | IUndoRedoStreamDoneEvent
      | undefined;
    expect(undoDone?.status).toBe('fulfilled');
    expect(undoDone?.engine).toBe('v2');

    const redoStream = await postSseStream(OPERATION_REDO_STREAM, table.id, cookie, windowId);
    expect(redoStream.status).toBe(200);
    expect(redoStream.headers[X_TEABLE_V2_HEADER]).toBe('true');
    expect(redoStream.headers[X_TEABLE_V2_REASON_HEADER]).toBe('env_force_v2_all');
    expect(redoStream.headers[X_TEABLE_V2_FEATURE_HEADER]).toBe('undoRedo');
    const redoDone = redoStream.events.find((event) => event.id === 'done') as
      | IUndoRedoStreamDoneEvent
      | undefined;
    expect(redoDone?.status).toBe('fulfilled');
    expect(redoDone?.engine).toBe('v2');
  });

  it('reports the v1 engine instead of claiming v2 when the replay falls back (T7805)', async () => {
    const [firstRecord, secondRecord] = table.records;

    // A PATCH carrying only `order` is classified `unsupported_feature` by
    // V2FeatureGuard, so this write is captured by the v1 pipeline and lands on the
    // v1 undo stack (the v1 stack is filled from the OPERATION_* events, asynchronously).
    const v1StackPush = createEventPromise(eventEmitterService, Events.OPERATION_PUSH);
    const writeResponse = await updateRecord(table.id, firstRecord.id, {
      fieldKeyType: FieldKeyType.Id,
      record: { fields: {} },
      order: {
        viewId: table.views[0].id,
        anchorId: secondRecord.id,
        position: 'after',
      },
    });
    expect(writeResponse.headers[X_TEABLE_V2_HEADER]).toBe('false');
    expect(writeResponse.headers[X_TEABLE_V2_REASON_HEADER]).toBe('unsupported_feature');
    await v1StackPush;

    // The v2 stack has nothing for this window, so the service replays through the
    // v1 engine: the response must not claim v2 even though the canary routed the
    // route itself to v2.
    const undoResponse = await undo(table.id);
    expect(undoResponse.data.status).toBe('fulfilled');
    expect(undoResponse.headers[X_TEABLE_UNDO_REDO_ENGINE_HEADER]).toBe('v1');
    expect(undoResponse.headers[X_TEABLE_V2_HEADER]).toBe('false');
    expect(undoResponse.headers[X_TEABLE_V2_REASON_HEADER]).toBe('unsupported_feature');

    // Nothing left to replay: no engine ran, so the canary stamp stays (the same
    // request cannot be corrected on the stream routes either).
    const emptyUndoResponse = await undo(table.id);
    expect(emptyUndoResponse.data.status).toBe('empty');
    expect(emptyUndoResponse.headers[X_TEABLE_UNDO_REDO_ENGINE_HEADER]).toBe('v1');
    expect(emptyUndoResponse.headers[X_TEABLE_V2_HEADER]).toBe('true');

    const redoResponse = await redo(table.id);
    expect(redoResponse.data.status).toBe('fulfilled');
    expect(redoResponse.headers[X_TEABLE_UNDO_REDO_ENGINE_HEADER]).toBe('v1');
    expect(redoResponse.headers[X_TEABLE_V2_HEADER]).toBe('false');
    expect(redoResponse.headers[X_TEABLE_V2_REASON_HEADER]).toBe('unsupported_feature');
  });
});
