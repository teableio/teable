import { ok } from 'neverthrow';
import { describe, expect, it, vi } from 'vitest';

import { Base } from '../domain/base/Base';
import { BaseId } from '../domain/base/BaseId';
import { BaseName } from '../domain/base/BaseName';
import { ActorId } from '../domain/shared/ActorId';
import { domainError } from '../domain/shared/DomainError';
import type { IExecutionContext } from '../ports/ExecutionContext';
import { DuplicateBaseByIdCommand } from './DuplicateBaseByIdCommand';
import { DuplicateBaseByIdHandler } from './DuplicateBaseByIdHandler';

describe('DuplicateBaseByIdHandler', () => {
  it('uses bounded base transactions, preserves the domain error, and cleans up failure', async () => {
    const sourceBaseId = BaseId.create(`bse${'s'.repeat(16)}`)._unsafeUnwrap();
    const sourceBase = Base.builder()
      .withId(sourceBaseId)
      .withName(BaseName.create('Source')._unsafeUnwrap())
      .build()
      ._unsafeUnwrap();
    const context: IExecutionContext = {
      actorId: ActorId.create('system')._unsafeUnwrap(),
    };
    let insertedBaseId: BaseId | undefined;
    const baseRepository = {
      findOne: vi.fn(async () => ok(sourceBase)),
      insert: vi.fn(async (_context: IExecutionContext, base: Base) => {
        insertedBaseId = base.id();
        return ok(base);
      }),
      delete: vi.fn(async () => ok(undefined)),
    };
    const tableRepository = {
      find: vi.fn(async () => ok([])),
    };
    const forbidden = domainError.forbidden({
      code: 'duplicate_base.forbidden',
      message: 'duplicate forbidden',
    });
    const commandBus = {
      execute: vi.fn(async (_context: IExecutionContext) => {
        const stream = (async function* () {
          const event = {
            id: 'error' as const,
            code: forbidden.code,
            message: forbidden.message,
            error: forbidden,
          };
          yield event;
        })();
        return ok(stream);
      }),
    };
    const transactionScopes: string[] = [];
    const unitOfWork = {
      withTransaction: vi.fn(
        async (
          _context: IExecutionContext,
          callback: (transactionContext: IExecutionContext) => Promise<unknown>,
          options?: { scope?: string }
        ) => {
          transactionScopes.push(options?.scope ?? 'data');
          return callback(context);
        }
      ),
    };
    const handler = new DuplicateBaseByIdHandler(
      baseRepository as never,
      tableRepository as never,
      {} as never,
      {} as never,
      commandBus as never,
      { publishMany: vi.fn(async () => ok(undefined)) } as never,
      unitOfWork as never
    );
    const command = DuplicateBaseByIdCommand.create({
      sourceBaseId: sourceBaseId.toString(),
      withRecords: false,
    })._unsafeUnwrap();

    const result = await handler.handle(context, command);

    expect(result._unsafeUnwrapErr()).toBe(forbidden);
    expect(insertedBaseId).toBeDefined();
    expect(baseRepository.delete).toHaveBeenCalledWith(context, insertedBaseId);
    expect(transactionScopes).toEqual(['meta', 'meta']);
    expect(commandBus.execute).toHaveBeenCalledWith(context, expect.anything());
  });
});
