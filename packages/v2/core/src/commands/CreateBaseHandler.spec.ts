import { err, ok } from 'neverthrow';
import { describe, expect, it } from 'vitest';

import type { Base } from '../domain/base/Base';
import { BaseId } from '../domain/base/BaseId';
import { ActorId } from '../domain/shared/ActorId';
import { domainError, type DomainError } from '../domain/shared/DomainError';
import type { IDomainEvent } from '../domain/shared/DomainEvent';
import type { OffsetPagination } from '../domain/shared/pagination/OffsetPagination';
import type { IBaseRepository } from '../ports/BaseRepository';
import type { IEventBus } from '../ports/EventBus';
import type { IExecutionContext } from '../ports/ExecutionContext';
import { CreateBaseCommand } from './CreateBaseCommand';
import { CreateBaseHandler } from './CreateBaseHandler';

const createContext = (): IExecutionContext => {
  const actorId = ActorId.create('system')._unsafeUnwrap();
  return { actorId };
};

class FakeBaseRepository implements IBaseRepository {
  inserted: BaseId[] = [];
  failInsert: DomainError | undefined;

  async insert(_: IExecutionContext, base: { id: () => BaseId }) {
    if (this.failInsert) return err(this.failInsert);
    this.inserted.push(base.id());
    return ok(base as never);
  }

  async findOne(_context: IExecutionContext, _baseId: BaseId) {
    return ok<Base | null, DomainError>(null);
  }

  async find(_context: IExecutionContext, _pagination: OffsetPagination) {
    return ok({ bases: [], total: 0 });
  }
}

class FakeEventBus implements IEventBus {
  published: IDomainEvent[] = [];

  async publish(_: IExecutionContext, event: IDomainEvent) {
    this.published.push(event);
    return ok(undefined);
  }

  async publishMany(_: IExecutionContext, events: ReadonlyArray<IDomainEvent>) {
    this.published.push(...events);
    return ok(undefined);
  }
}

describe('CreateBaseHandler', () => {
  it('creates bases and publishes events', async () => {
    const baseId = BaseId.create(`bse${'a'.repeat(16)}`)._unsafeUnwrap();
    const command = CreateBaseCommand.create({
      baseId: baseId.toString(),
      name: 'Workspace',
    })._unsafeUnwrap();

    const repository = new FakeBaseRepository();
    const eventBus = new FakeEventBus();
    const handler = new CreateBaseHandler(repository, eventBus);

    const result = await handler.handle(createContext(), command);
    const payload = result._unsafeUnwrap();

    expect(payload.base.id().toString()).toBe(baseId.toString());
    expect(repository.inserted).toHaveLength(1);
    expect(eventBus.published.length).toBeGreaterThan(0);
  });

  it('returns repository errors', async () => {
    const command = CreateBaseCommand.create({
      name: 'Workspace',
    })._unsafeUnwrap();

    const repository = new FakeBaseRepository();
    repository.failInsert = domainError.unexpected({ message: 'insert failed' });
    const eventBus = new FakeEventBus();
    const handler = new CreateBaseHandler(repository, eventBus);

    const result = await handler.handle(createContext(), command);
    expect(result._unsafeUnwrapErr().message).toBe('insert failed');
  });

  it('falls back to generated ids', async () => {
    const command = CreateBaseCommand.create({ name: 'Auto' })._unsafeUnwrap();
    const repository = new FakeBaseRepository();
    const eventBus = new FakeEventBus();
    const handler = new CreateBaseHandler(repository, eventBus);

    const result = await handler.handle(createContext(), command);
    const payload = result._unsafeUnwrap();

    expect(payload.base.id().toString()).toMatch(/^bse/);
    expect(payload.base.name().toString()).toBe('Auto');
  });
});
