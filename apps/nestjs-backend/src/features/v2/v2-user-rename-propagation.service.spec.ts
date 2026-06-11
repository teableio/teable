import { PropagateUserRenameCommand, v2CoreTokens } from '@teable/v2-core';
import { describe, expect, it, vi } from 'vitest';

import type { V2ContainerService } from './v2-container.service';
import { V2UserRenamePropagationService } from './v2-user-rename-propagation.service';

const okResult = <T>(value: T) => ({
  isErr: () => false,
  isOk: () => true,
  value,
});

describe('V2UserRenamePropagationService', () => {
  it('dispatches the internal user-rename command through the internal v2 command bus', async () => {
    const commandBus = {
      execute: vi.fn().mockResolvedValue(okResult(undefined)),
    };
    const container = {
      resolve: (token: symbol) => {
        if (token === v2CoreTokens.internalCommandBus) return commandBus;
        if (token === v2CoreTokens.tracer) return {};
        throw new Error(`Unexpected token: ${String(token)}`);
      },
    };
    const service = new V2UserRenamePropagationService({
      getContainer: vi.fn().mockResolvedValue(container),
    } as unknown as V2ContainerService);

    await service.propagateUserRename({
      actorId: `usr${'a'.repeat(17)}`,
      userId: `usr${'b'.repeat(17)}`,
      name: 'Renamed User',
      requestId: 'test-request-id',
    });

    expect(commandBus.execute).toHaveBeenCalledTimes(1);
    const [context, command] = commandBus.execute.mock.calls[0] as [
      { actorId: { toString: () => string }; requestId: string },
      PropagateUserRenameCommand,
    ];
    expect(context.actorId.toString()).toBe(`usr${'a'.repeat(17)}`);
    expect(context.requestId).toBe('test-request-id');
    expect(command).toBeInstanceOf(PropagateUserRenameCommand);
    expect(command.userId.toString()).toBe(`usr${'b'.repeat(17)}`);
    expect(command.name).toBe('Renamed User');
  });
});
