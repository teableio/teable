import { err, ok } from 'neverthrow';
import { describe, expect, it, vi } from 'vitest';

import { ActorId } from '../domain/shared/ActorId';
import { domainError, type DomainError } from '../domain/shared/DomainError';
import type { IExecutionContext } from '../ports/ExecutionContext';
import type {
  IUserRenamePropagationService,
  UserRenamePropagationInput,
} from '../ports/UserRenamePropagationService';
import { PropagateUserRenameCommand } from './PropagateUserRenameCommand';
import { PropagateUserRenameHandler } from './PropagateUserRenameHandler';

const createContext = (): IExecutionContext => ({
  actorId: ActorId.create(`usr${'a'.repeat(17)}`)._unsafeUnwrap(),
});

describe('PropagateUserRenameHandler', () => {
  it('delegates the rename payload to the user-rename propagation port', async () => {
    const propagateUserRename = vi.fn().mockResolvedValue(ok(undefined));
    const handler = new PropagateUserRenameHandler({
      propagateUserRename,
    } as unknown as IUserRenamePropagationService);
    const context = createContext();
    const command = PropagateUserRenameCommand.create({
      userId: `usr${'b'.repeat(17)}`,
      name: 'Renamed User',
    })._unsafeUnwrap();

    const result = await handler.handle(context, command);

    expect(result.isOk()).toBe(true);
    expect(propagateUserRename).toHaveBeenCalledWith(
      context,
      expect.objectContaining<UserRenamePropagationInput>({
        userId: expect.objectContaining({ toString: expect.any(Function) }),
        name: 'Renamed User',
      })
    );
    const [, payload] = propagateUserRename.mock.calls[0] as [
      IExecutionContext,
      UserRenamePropagationInput,
    ];
    expect(payload.userId.toString()).toBe(`usr${'b'.repeat(17)}`);
  });

  it('returns the port error unchanged', async () => {
    const renameError: DomainError = domainError.unexpected({
      message: 'rename failed',
    });
    const handler = new PropagateUserRenameHandler({
      propagateUserRename: vi.fn().mockResolvedValue(err(renameError)),
    } as unknown as IUserRenamePropagationService);
    const context = createContext();
    const command = PropagateUserRenameCommand.create({
      userId: `usr${'c'.repeat(17)}`,
      name: 'Renamed User',
    })._unsafeUnwrap();

    const result = await handler.handle(context, command);

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error).toBe(renameError);
    }
  });
});
