import { ShortLinkType } from '@teable/openapi';
import { v2MetaDbTokens } from '@teable/v2-adapter-db-postgres-pg';
import {
  ActorId,
  BaseId,
  TableId,
  ViewId,
  ViewShareDisabled,
  ViewShareIdRefreshed,
} from '@teable/v2-core';
import { vi } from 'vitest';

import { generateShortLinkCacheKey } from '../../performance-cache/generate-keys';
import {
  V2ViewShareIdRefreshedShortLinkProjection,
  V2ViewShareSideEffectService,
} from './v2-view-share-side-effect.service';

const createQuery = <T>(result: T) => {
  const where: Array<[string, string, unknown]> = [];
  const query = {
    where,
    select: vi.fn(),
    set: vi.fn(),
    execute: vi.fn().mockResolvedValue(result),
  };
  const chain = {
    select: (column: string) => {
      query.select(column);
      return chain;
    },
    set: (value: unknown) => {
      query.set(value);
      return chain;
    },
    where: (column: string, operator: string, value: unknown) => {
      where.push([column, operator, value]);
      return chain;
    },
    execute: query.execute,
  };
  return { query, chain };
};

const buildEvent = (...args: [] | [string | undefined]) => {
  const previousShareId = args.length === 0 ? `shr${'a'.repeat(16)}` : args[0];
  return ViewShareIdRefreshed.create({
    baseId: BaseId.create('bse0000000000000001')._unsafeUnwrap(),
    tableId: TableId.create('tbl0000000000000001')._unsafeUnwrap(),
    viewId: ViewId.create('viw0000000000000001')._unsafeUnwrap(),
    previousShareId,
    nextShareId: `shr${'b'.repeat(16)}`,
  });
};

const buildDisabledEvent = () =>
  ViewShareDisabled.create({
    baseId: BaseId.create('bse0000000000000001')._unsafeUnwrap(),
    tableId: TableId.create('tbl0000000000000001')._unsafeUnwrap(),
    viewId: ViewId.create('viw0000000000000001')._unsafeUnwrap(),
    previousShareId: `shr${'a'.repeat(16)}`,
    shareMeta: { includeRecords: true },
  });

describe('V2ViewShareSideEffectService', () => {
  it('registers the short-link projection with v2 Kysely', () => {
    const db = {};
    const cache = { del: vi.fn() };
    const container = {
      resolve: vi.fn().mockReturnValue(db),
      registerInstance: vi.fn(),
    };

    new V2ViewShareSideEffectService(cache as never).registerProjections(container as never);

    expect(container.resolve).toHaveBeenCalledWith(v2MetaDbTokens.db);
    expect(container.registerInstance).toHaveBeenCalledWith(
      V2ViewShareIdRefreshedShortLinkProjection,
      expect.any(V2ViewShareIdRefreshedShortLinkProjection)
    );
  });

  it('marks the old share short link deleted and invalidates its performance cache', async () => {
    const select = createQuery([{ code: 'short-code' }]);
    const update = createQuery(undefined);
    const db = {
      selectFrom: vi.fn(() => select.chain),
      updateTable: vi.fn(() => update.chain),
    };
    const cache = { del: vi.fn().mockResolvedValue(undefined) };
    const projection = new V2ViewShareIdRefreshedShortLinkProjection(db as never, cache as never);

    const result = await projection.handle(
      { actorId: ActorId.create('system')._unsafeUnwrap() },
      buildEvent()
    );

    expect(result.isOk()).toBe(true);
    expect(select.query.where).toEqual([
      ['type', '=', ShortLinkType.ViewShare],
      ['resource_id', '=', `shr${'a'.repeat(16)}`],
      ['deleted_time', 'is', null],
    ]);
    expect(update.query.set).toHaveBeenCalledWith({ deleted_time: expect.any(Date) });
    expect(update.query.where).toEqual(select.query.where);
    expect(cache.del).toHaveBeenCalledWith(generateShortLinkCacheKey('short-code'));
  });

  it('invalidates the current share short link when sharing is disabled', async () => {
    const select = createQuery([{ code: 'disabled-code' }]);
    const update = createQuery(undefined);
    const db = {
      selectFrom: vi.fn(() => select.chain),
      updateTable: vi.fn(() => update.chain),
    };
    const cache = { del: vi.fn().mockResolvedValue(undefined) };
    const projection = new V2ViewShareIdRefreshedShortLinkProjection(db as never, cache as never);

    const result = await projection.handle(
      { actorId: ActorId.create('system')._unsafeUnwrap() },
      buildDisabledEvent()
    );

    expect(result.isOk()).toBe(true);
    expect(update.query.where).toContainEqual(['resource_id', '=', `shr${'a'.repeat(16)}`]);
    expect(cache.del).toHaveBeenCalledWith(generateShortLinkCacheKey('disabled-code'));
  });

  it('skips storage when there was no previous share ID and keeps cleanup advisory', async () => {
    const db = {
      selectFrom: vi.fn(() => {
        throw new Error('cleanup failed');
      }),
    };
    const cache = { del: vi.fn() };
    const projection = new V2ViewShareIdRefreshedShortLinkProjection(db as never, cache as never);

    expect((await projection.handle({} as never, buildEvent(undefined))).isOk()).toBe(true);
    expect(db.selectFrom).not.toHaveBeenCalled();
    expect((await projection.handle({} as never, buildEvent())).isOk()).toBe(true);
  });
});
