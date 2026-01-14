import { err, ok } from 'neverthrow';
import { describe, expect, it } from 'vitest';

import { Base } from '../domain/base/Base';
import { BaseId } from '../domain/base/BaseId';
import { BaseName } from '../domain/base/BaseName';
import { ActorId } from '../domain/shared/ActorId';
import { domainError } from '../domain/shared/DomainError';
import type { IBaseRepository } from '../ports/BaseRepository';
import type { IExecutionContext } from '../ports/ExecutionContext';
import { ListBasesHandler } from './ListBasesHandler';
import { ListBasesQuery } from './ListBasesQuery';

const createContext = (): IExecutionContext => {
  const actorId = ActorId.create('system')._unsafeUnwrap();
  return { actorId };
};

const buildBase = (seed: string) => {
  const baseId = BaseId.create(`bse${seed.repeat(16)}`)._unsafeUnwrap();
  const baseName = BaseName.create(`Base ${seed}`)._unsafeUnwrap();
  return Base.builder().withId(baseId).withName(baseName).build()._unsafeUnwrap();
};

describe('ListBasesHandler', () => {
  it('returns paginated results', async () => {
    const base = buildBase('a');
    const repository: IBaseRepository = {
      insert: async () => ok(base),
      findOne: async () => ok(base),
      find: async (_context, pagination) => {
        return ok({ bases: [base], total: pagination.limit().toNumber() });
      },
    };

    const query = ListBasesQuery.create({ limit: 1, offset: 0 })._unsafeUnwrap();
    const handler = new ListBasesHandler(repository);
    const result = await handler.handle(createContext(), query);
    const payload = result._unsafeUnwrap();

    expect(payload.bases).toHaveLength(1);
    expect(payload.total).toBe(1);
    expect(payload.limit).toBe(1);
    expect(payload.offset).toBe(0);
  });

  it('returns repository errors', async () => {
    const repository: IBaseRepository = {
      insert: async () => err(domainError.unexpected({ message: 'nope' })),
      findOne: async () => err(domainError.unexpected({ message: 'nope' })),
      find: async () => err(domainError.unexpected({ message: 'failed' })),
    };

    const query = ListBasesQuery.create({})._unsafeUnwrap();
    const handler = new ListBasesHandler(repository);
    const result = await handler.handle(createContext(), query);

    expect(result._unsafeUnwrapErr().message).toBe('failed');
  });

  it('uses pagination from query', async () => {
    const base = buildBase('b');
    const repository: IBaseRepository = {
      insert: async () => ok(base),
      findOne: async () => ok(base),
      find: async (_context, queryPagination) => {
        expect(queryPagination.limit().toNumber()).toBe(5);
        expect(queryPagination.offset().toNumber()).toBe(10);
        return ok({ bases: [base], total: 1 });
      },
    };

    const query = ListBasesQuery.create({ limit: 5, offset: 10 })._unsafeUnwrap();
    const handler = new ListBasesHandler(repository);
    const result = await handler.handle(createContext(), query);

    expect(result._unsafeUnwrap().bases).toHaveLength(1);
  });
});
