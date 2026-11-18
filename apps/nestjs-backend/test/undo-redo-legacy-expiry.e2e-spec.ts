import type { INestApplication } from '@nestjs/common';
import { FieldKeyType, FieldType, getRandomString } from '@teable/core';
import {
  axios,
  getRecords,
  X_CANARY_HEADER,
  type ITableFullVo,
  type IUndoRedoStreamEvent,
  type IClearSelectionStreamEvent,
} from '@teable/openapi';
import {
  ActorId,
  TableId,
  v2CoreTokens,
  type IUndoRedoStore,
  type UndoScope,
} from '@teable/v2-core';
import type { Redis } from 'ioredis';
import type Keyv from 'keyv';
import { CacheService } from '../src/cache/cache.service';
import { X_TEABLE_V2_HEADER } from '../src/features/canary/interceptors/v2-indicator.interceptor';
import { buildUndoRedoEnginePreferenceKey } from '../src/features/undo-redo/open-api/undo-redo-engine-preference';
import { X_TEABLE_UNDO_REDO_ENGINE_HEADER } from '../src/features/undo-redo/open-api/undo-redo.service';
import { V2ContainerService } from '../src/features/v2/v2-container.service';
import { createTable, initApp, permanentDeleteTable } from './utils/init-app';

type SplitMetadata = {
  format: 'split-v1';
  entryIds: string[];
  cursor: number;
  nextSequence: number;
  groups?: unknown[];
};

type HistoryEnvelope = { value: SplitMetadata; expires: number };
type PayloadSnapshot = { key: string; raw: string; ttl: number };
type Fixture = {
  table: ITableFullVo;
  scope: UndoScope;
  scopeKey: string;
  store: IUndoRedoStore;
  headers: Record<string, string>;
};

type RedisCacheStore = {
  redis?: Redis;
  client?: Redis;
  _getKeyName?: (key: string) => string;
};

const parseEvents = <T>(body: string): T[] =>
  body
    .split('\n')
    .filter((line) => line.startsWith('data: '))
    .map((line) => JSON.parse(line.slice(6)) as T);

describe('T8388 legacy split history payload expiry (public HTTP)', () => {
  let app: INestApplication;
  let keyv: Keyv<unknown>;
  let redis: Redis;
  let physicalKey: (logicalKey: string) => string;
  const baseId = globalThis.testConfig.baseId;

  beforeAll(async () => {
    ({ app } = await initApp());
    keyv = app.get(CacheService).getKeyv();
    // Use the worker-isolated Redis connection and key naming from the real
    // CacheProvider, including KeyvRedis's optional second namespace prefix.
    const cacheStore = keyv.opts.store as unknown as RedisCacheStore;
    const client = cacheStore.redis ?? cacheStore.client;
    if (!client) throw new Error('This HTTP regression requires the real fixture Redis store');
    redis = client;
    physicalKey = (logicalKey) => {
      const namespaced = `${keyv.opts.namespace}:${logicalKey}`;
      return cacheStore._getKeyName?.(namespaced) ?? namespaced;
    };
  });

  afterAll(async () => {
    await app?.close();
  });

  const readMetadata = async (scopeKey: string) => {
    const raw = await redis.get(physicalKey(scopeKey));
    expect(raw).not.toBeNull();
    const deserialize = keyv.opts.deserialize ?? JSON.parse;
    const envelope = (await deserialize(raw!)) as HistoryEnvelope;
    expect(envelope.value.format).toBe('split-v1');
    expect(envelope.expires).toBeGreaterThan(Date.now());
    // Prove the physical key/envelope came from this owned HTTP fixture, not
    // an assumed Redis namespace or an idealized adapter replacement.
    expect(await keyv.get(scopeKey, { raw: true })).toEqual(envelope);
    return { raw: raw!, envelope };
  };

  const snapshotPayload = async (logicalKey: string): Promise<PayloadSnapshot> => {
    const key = physicalKey(logicalKey);
    const raw = await redis.get(key);
    const ttl = await redis.pttl(key);
    expect(raw).not.toBeNull();
    expect(ttl).toBeGreaterThan(0);
    return { key, raw: raw!, ttl };
  };

  const expectPayloadUntouched = async (snapshot: PayloadSnapshot) => {
    expect(await redis.get(snapshot.key)).toBe(snapshot.raw);
    const ttl = await redis.pttl(snapshot.key);
    expect(ttl).toBeGreaterThan(0);
    expect(ttl).toBeLessThanOrEqual(snapshot.ttl);
  };

  const dropGroupCache = async (scopeKey: string) => {
    const { envelope } = await readMetadata(scopeKey);
    expect(envelope.value.groups).toBeDefined();
    const legacy = { ...envelope.value };
    delete legacy.groups;
    const beforeTtl = await redis.pttl(physicalKey(scopeKey));
    expect(beforeTtl).toBeGreaterThan(0);
    const serialize = keyv.opts.serialize ?? JSON.stringify;
    // Keep both expiry clocks: SET KEEPTTL preserves the Redis deadline and
    // copying the owned envelope preserves Keyv's embedded absolute deadline.
    await redis.set(
      physicalKey(scopeKey),
      await serialize({ ...envelope, value: legacy }),
      'KEEPTTL'
    );
    const after = await readMetadata(scopeKey);
    expect(after.envelope).toEqual({ ...envelope, value: legacy });
    expect(after.envelope.value).not.toHaveProperty('groups');
    const afterTtl = await redis.pttl(physicalKey(scopeKey));
    expect(afterTtl).toBeGreaterThan(0);
    expect(afterTtl).toBeLessThanOrEqual(beforeTtl);
    return legacy;
  };

  const cleanupHistory = async (fixture: Fixture) => {
    // SCAN only this randomly named window's payload keys. Never flush a DB,
    // enumerate another window, or disconnect the shared app's Redis client.
    let cursor = '0';
    do {
      const page = await redis.scan(
        cursor,
        'MATCH',
        `${physicalKey(`${fixture.scopeKey}:entry:`)}*`,
        'COUNT',
        100
      );
      cursor = page[0];
      if (page[1].length) await redis.del(...page[1]);
    } while (cursor !== '0');
    await keyv.delete(fixture.scopeKey);
    await keyv.delete(
      buildUndoRedoEnginePreferenceKey(
        fixture.scope.actorId.toString(),
        fixture.table.id,
        fixture.scope.windowId
      )
    );
    // The adapter's distributed mutex is deliberately outside Keyv's envelope.
    await redis.del(`${fixture.scopeKey}:lock`);
  };

  const withFixture = async (recordCount: number, run: (fixture: Fixture) => Promise<void>) => {
    const previousWindowHeaders = Object.entries(axios.defaults.headers.common).filter(
      ([name]) => name.toLowerCase() === 'x-window-id'
    );
    for (const [name] of previousWindowHeaders) delete axios.defaults.headers.common[name];
    let table: ITableFullVo | undefined;
    let fixture: Fixture | undefined;
    try {
      // Table creation is outside the history window. Only the public record
      // writes below seed its two independent legacy actions.
      table = await createTable(baseId, {
        name: `legacy-expiry-${getRandomString(8)}`,
        fields: [{ name: 'Value', type: FieldType.SingleLineText }],
        records: Array.from({ length: recordCount }, (_, index) => ({
          fields: { Value: `row-${index}` },
        })),
      });
      const windowId = `win-legacy-expiry-${getRandomString(16)}`;
      const scope: UndoScope = {
        actorId: ActorId.create(globalThis.testConfig.userId)._unsafeUnwrap(),
        tableId: TableId.create(table.id)._unsafeUnwrap(),
        windowId,
      };
      const container = await app.get(V2ContainerService).getContainerForTable(table.id);
      fixture = {
        table,
        scope,
        scopeKey: `v2:undo-redo:${scope.actorId}:${table.id}:${windowId}`,
        store: container.resolve<IUndoRedoStore>(v2CoreTokens.undoRedoStore),
        headers: { [X_CANARY_HEADER]: 'true', 'X-Window-Id': windowId },
      };
      await run(fixture);
    } finally {
      try {
        if (table) await permanentDeleteTable(baseId, table.id);
      } finally {
        try {
          if (fixture) await cleanupHistory(fixture);
        } finally {
          for (const [name, value] of previousWindowHeaders) {
            axios.defaults.headers.common[name] = value;
          }
        }
      }
    }
  };

  const writeValue = async (fixture: Fixture, index: number, value: string) => {
    const response = await axios.patch(
      `/table/${fixture.table.id}/record/${fixture.table.records[index].id}`,
      {
        fieldKeyType: FieldKeyType.Id,
        record: { fields: { [fixture.table.fields[0].id]: value } },
      },
      { headers: fixture.headers, validateStatus: () => true }
    );
    return response;
  };

  const readValues = async (fixture: Fixture) =>
    (
      await getRecords(fixture.table.id, {
        take: 1000,
        fieldKeyType: FieldKeyType.Id,
      })
    ).data.records;

  const seedLegacyGap = async (fixture: Fixture) => {
    for (const [index, value] of ['legacy-old', 'legacy-new'].entries()) {
      const response = await writeValue(fixture, index, value);
      expect(response.status, JSON.stringify(response.data)).toBe(200);
      expect(response.headers[X_TEABLE_V2_HEADER]).toBe('true');
    }
    const entries = (await fixture.store.list(fixture.scope))._unsafeUnwrap();
    expect(entries).toHaveLength(2);
    expect(new Set(entries.map((entry) => entry.groupId ?? entry.requestId)).size).toBe(2);
    const { envelope } = await readMetadata(fixture.scopeKey);
    expect(envelope.value.entryIds).toHaveLength(2);
    expect(envelope.value.cursor).toBe(2);
    const [olderId, newerId] = envelope.value.entryIds;
    const healthy = await snapshotPayload(`${fixture.scopeKey}:entry:${newerId}`);
    const legacy = await dropGroupCache(fixture.scopeKey);
    // Deterministic equivalent of the older payload's Redis expiry; leave the
    // newer action and metadata alive, with their original payload/expiry bytes.
    expect(await redis.del(physicalKey(`${fixture.scopeKey}:entry:${olderId}`))).toBe(1);
    expect(await keyv.get(`${fixture.scopeKey}:entry:${olderId}`)).toBeUndefined();
    await expectPayloadUntouched(healthy);
    expect((await readMetadata(fixture.scopeKey)).envelope.value).toEqual(legacy);
    return { healthy, legacyIds: envelope.value.entryIds };
  };

  const undoFresh = async (fixture: Fixture) => {
    const response = await axios.post(`/table/${fixture.table.id}/undo-redo/undo`, undefined, {
      headers: fixture.headers,
    });
    expect(response.status).toBe(201);
    expect(response.headers[X_TEABLE_UNDO_REDO_ENGINE_HEADER]).toBe('v2');
    expect(response.data).toMatchObject({ status: 'fulfilled' });
  };

  it.each(['create', 'update'] as const)(
    'accepts public %s after an expired independent legacy payload and undoes fresh then healthy legacy history',
    async (operation) => {
      await withFixture(3, async (fixture) => {
        const { healthy } = await seedLegacyGap(fixture);
        const fieldId = fixture.table.fields[0].id;
        const response =
          operation === 'create'
            ? await axios.post(
                `/table/${fixture.table.id}/record`,
                {
                  fieldKeyType: FieldKeyType.Id,
                  records: [{ fields: { [fieldId]: 'fresh-action' } }],
                },
                { headers: fixture.headers, validateStatus: () => true }
              )
            : await writeValue(fixture, 2, 'fresh-action');
        // Read committed state before asserting the response: the original
        // failure reports an error after the user's write already committed.
        const committed = await readValues(fixture);
        expect(
          committed.filter((record) => record.fields[fieldId] === 'fresh-action')
        ).toHaveLength(1);
        expect(response.status, JSON.stringify(response.data)).toBe(
          operation === 'create' ? 201 : 200
        );
        expect(response.headers[X_TEABLE_V2_HEADER]).toBe('true');
        await expectPayloadUntouched(healthy);

        await undoFresh(fixture);
        const afterFreshUndo = await readValues(fixture);
        expect(afterFreshUndo).toHaveLength(3);
        expect(afterFreshUndo.some((record) => record.fields[fieldId] === 'fresh-action')).toBe(
          false
        );
        expect(
          afterFreshUndo.find(({ id }) => id === fixture.table.records[2].id)?.fields[fieldId]
        ).toBe('row-2');
        expect(
          afterFreshUndo.find(({ id }) => id === fixture.table.records[1].id)?.fields[fieldId]
        ).toBe('legacy-new');
        await expectPayloadUntouched(healthy);

        await undoFresh(fixture);
        const afterLegacyUndo = await readValues(fixture);
        expect(afterLegacyUndo).toHaveLength(3);
        expect(
          afterLegacyUndo.find(({ id }) => id === fixture.table.records[1].id)?.fields[fieldId]
        ).toBe('row-1');
        expect(
          afterLegacyUndo.find(({ id }) => id === fixture.table.records[0].id)?.fields[fieldId]
        ).toBe('legacy-old');
      });
    }
  );

  const clearStream = async (fixture: Fixture, firstIndex: number) => {
    const response = await axios.patch<string>(
      `/table/${fixture.table.id}/selection/clear-by-id-stream`,
      {
        viewId: fixture.table.views[0].id,
        selection: {
          recordIds: fixture.table.records.slice(firstIndex).map(({ id }) => id),
          fieldIds: [fixture.table.fields[0].id],
        },
      },
      { headers: fixture.headers, responseType: 'text', validateStatus: () => true }
    );
    expect(response.status).toBe(200);
    return parseEvents<IClearSelectionStreamEvent>(response.data);
  };

  it('records and fully undoes a fresh multi-chunk clear stream beside an expired independent legacy payload', async () => {
    // 501 selected records span several production chunks without a test batch override.
    await withFixture(503, async (fixture) => {
      const { healthy, legacyIds } = await seedLegacyGap(fixture);
      const events = await clearStream(fixture, 2);
      const fieldId = fixture.table.fields[0].id;
      const selectedIds = new Set(fixture.table.records.slice(2).map(({ id }) => id));
      const cleared = await readValues(fixture);
      expect(cleared).toHaveLength(503);
      for (const record of cleared.filter(({ id }) => selectedIds.has(id))) {
        expect(record.fields[fieldId] ?? null, record.id).toBeNull();
      }
      expect(events.filter((event) => event.id === 'error')).toEqual([]);
      expect(events.find((event) => event.id === 'done')).toMatchObject({ clearedCount: 501 });
      const metadata = (await readMetadata(fixture.scopeKey)).envelope.value;
      expect(
        metadata.entryIds.filter((id) => !legacyIds.includes(id)).length
      ).toBeGreaterThanOrEqual(2);
      await expectPayloadUntouched(healthy);

      await undoFresh(fixture);
      const restored = new Map(
        (await readValues(fixture)).map((record) => [record.id, record.fields[fieldId]])
      );
      for (const [index, record] of fixture.table.records.entries()) {
        const expected = index === 0 ? 'legacy-old' : index === 1 ? 'legacy-new' : `row-${index}`;
        expect(restored.get(record.id), record.id).toBe(expected);
      }
      await undoFresh(fixture);
      const legacyUndone = await readValues(fixture);
      expect(
        legacyUndone.find(({ id }) => id === fixture.table.records[1].id)?.fields[fieldId]
      ).toBe('row-1');
      expect(
        legacyUndone.find(({ id }) => id === fixture.table.records[0].id)?.fields[fieldId]
      ).toBe('legacy-old');
    });
  });

  it('fails closed instead of skipping a missing selected cacheless group chunk and retries the complete real HTTP undo', async () => {
    await withFixture(501, async (fixture) => {
      const events = await clearStream(fixture, 0);
      expect(events.filter((event) => event.id === 'error')).toEqual([]);
      expect(events.find((event) => event.id === 'done')).toMatchObject({ clearedCount: 501 });
      const entries = (await fixture.store.list(fixture.scope))._unsafeUnwrap();
      expect(entries.length).toBeGreaterThanOrEqual(2);
      expect(entries[0].groupId).toBeTruthy();
      expect(new Set(entries.map((entry) => entry.groupId)).size).toBe(1);
      const legacy = await dropGroupCache(fixture.scopeKey);
      const missing = await snapshotPayload(`${fixture.scopeKey}:entry:${legacy.entryIds[0]}`);
      const missingEnvelope = await keyv.get(`${fixture.scopeKey}:entry:${legacy.entryIds[0]}`, {
        raw: true,
      });
      if (!missingEnvelope || typeof missingEnvelope.expires !== 'number') {
        throw new Error('The owned stream payload must retain its original expiry');
      }
      const healthy = await snapshotPayload(`${fixture.scopeKey}:entry:${legacy.entryIds.at(-1)}`);
      expect(await redis.del(missing.key)).toBe(1);
      const metadataBefore = (await readMetadata(fixture.scopeKey)).raw;
      const clearedBefore = await readValues(fixture);
      const fieldId = fixture.table.fields[0].id;
      expect(clearedBefore).toHaveLength(501);
      for (const record of clearedBefore) expect(record.fields[fieldId] ?? null).toBeNull();

      const response = await axios.post<string>(
        `/table/${fixture.table.id}/undo-redo/undo-stream`,
        undefined,
        { headers: fixture.headers, responseType: 'text' }
      );
      expect(response.status).toBe(200);
      const undoEvents = parseEvents<IUndoRedoStreamEvent>(response.data);
      expect(undoEvents.find((event) => event.id === 'error')).toMatchObject({
        engine: 'v2',
        code: 'undo_redo.entry_missing',
      });
      expect(undoEvents.some((event) => event.id === 'done' && event.status === 'fulfilled')).toBe(
        false
      );
      expect(await readValues(fixture)).toEqual(clearedBefore);
      expect((await readMetadata(fixture.scopeKey)).raw).toBe(metadataBefore);
      await expectPayloadUntouched(healthy);

      // Restore only the owned missing bytes at their original Keyv deadline.
      // The failed selection must not consume its cursor or strand a reservation.
      expect(missingEnvelope.expires).toBeGreaterThan(Date.now());
      await redis.set(missing.key, missing.raw);
      await redis.pexpireat(missing.key, missingEnvelope.expires);
      await undoFresh(fixture);
      const restored = new Map(
        (await readValues(fixture)).map((record) => [record.id, record.fields[fieldId]])
      );
      expect(restored.size).toBe(501);
      for (const [index, record] of fixture.table.records.entries()) {
        expect(restored.get(record.id), record.id).toBe(`row-${index}`);
      }
    });
  });
});
