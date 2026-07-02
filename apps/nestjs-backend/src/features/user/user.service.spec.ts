import type { TestingModule } from '@nestjs/testing';
import { Test } from '@nestjs/testing';
import { vi } from 'vitest';
import { GlobalModule } from '../../global/global.module';
import { UserModule } from './user.module';
import { UserService } from './user.service';

describe('UserService', () => {
  let service: UserService;

  const createNotifyMetaMergeService = (notifyMeta?: string | null) => {
    const queryRaw = vi.fn().mockResolvedValue([{ notifyMeta }]);
    const update = vi.fn().mockResolvedValue(undefined);
    const tx = vi.fn(async (fn: () => Promise<void>) => await fn());
    const prismaService = {
      $tx: tx,
      txClient: () => ({
        $queryRaw: queryRaw,
        user: {
          update,
        },
      }),
    };
    const mergeService = new UserService(
      prismaService as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never
    );

    return {
      mergeService,
      queryRaw,
      tx,
      update,
    };
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      imports: [GlobalModule, UserModule],
    }).compile();

    service = module.get<UserService>(UserService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('merges notify meta updates with existing values', async () => {
    const { mergeService, queryRaw, tx, update } = createNotifyMetaMergeService(
      JSON.stringify({ email: true, appBuilderChatIntroDismissed: true })
    );

    await mergeService.updateNotifyMeta('usrTest', { email: false });

    expect(tx).toHaveBeenCalledTimes(1);
    expect(queryRaw).toHaveBeenCalledTimes(1);
    expect(queryRaw.mock.calls[0][0].join('')).toContain('FOR UPDATE');
    expect(queryRaw.mock.calls[0][1]).toBe('usrTest');
    expect(update).toHaveBeenCalledWith({
      data: {
        notifyMeta: JSON.stringify({ email: false, appBuilderChatIntroDismissed: true }),
      },
      where: { id: 'usrTest', deletedTime: null },
    });
  });

  it('keeps existing notify switches when dismissing app builder intro', async () => {
    const { mergeService, update } = createNotifyMetaMergeService(JSON.stringify({ email: true }));

    await mergeService.updateNotifyMeta('usrTest', { appBuilderChatIntroDismissed: true });

    expect(update).toHaveBeenCalledWith({
      data: {
        notifyMeta: JSON.stringify({ email: true, appBuilderChatIntroDismissed: true }),
      },
      where: { id: 'usrTest', deletedTime: null },
    });
  });

  it('ignores malformed existing notify meta when merging updates', async () => {
    const { mergeService, update } = createNotifyMetaMergeService('legacy-invalid-json');

    await mergeService.updateNotifyMeta('usrTest', { appBuilderChatIntroDismissed: true });

    expect(update).toHaveBeenCalledWith({
      data: {
        notifyMeta: JSON.stringify({ appBuilderChatIntroDismissed: true }),
      },
      where: { id: 'usrTest', deletedTime: null },
    });
  });
});
