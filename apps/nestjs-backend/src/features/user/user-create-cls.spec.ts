import { AsyncLocalStorage } from 'node:async_hooks';
import { ClsService } from 'nestjs-cls';
import { describe, expect, it, vi } from 'vitest';
import type { IClsStore } from '../../types/cls';
import { UserService } from './user.service';

const createFixture = () => {
  const cls = new ClsService<IClsStore>(new AsyncLocalStorage());
  const tx = {
    user: {
      findFirst: vi.fn().mockResolvedValue({ id: 'usrAdmin' }),
      create: vi.fn(async ({ data }: { data: { id: string; name: string } }) => data),
    },
  };
  const prismaService = { txClient: () => tx };
  const service = new UserService(
    prismaService as never,
    cls,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    { isCloud: true } as never,
    {} as never,
    {} as never
  );
  const spaceCreators: Array<string | undefined> = [];
  vi.spyOn(service, 'createSpaceBySignup').mockImplementation(async () => {
    spaceCreators.push(cls.get('user.id'));
    return {} as never;
  });
  return { cls, service, spaceCreators };
};

describe('UserService.createUser signup space', () => {
  it('creates the signup space as the new user without changing the caller identity', async () => {
    const { cls, service, spaceCreators } = createFixture();

    const callerAfter = await cls.run(async () => {
      cls.set('user', { id: 'usrInviter', name: 'Inviter', email: 'inviter@example.com' });
      await service.createUser({
        id: 'usrInvitee',
        email: 'invitee@example.com',
        avatar: 'avatar.png',
      });
      return cls.get('user');
    });

    expect(spaceCreators).toEqual(['usrInvitee']);
    expect(callerAfter).toEqual({
      id: 'usrInviter',
      name: 'Inviter',
      email: 'inviter@example.com',
    });
  });
});
