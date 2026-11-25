import { describe, expect, it, vi } from 'vitest';
import { RecordActorResolverService } from './record-actor-resolver.service';

const setup = () => {
  const prisma = {
    tableMeta: { findFirst: vi.fn().mockResolvedValue({ baseId: 'bseFixture' }) },
    base: { findFirst: vi.fn().mockResolvedValue({ spaceId: 'spcFixture' }) },
    collaborator: { findMany: vi.fn().mockResolvedValue([{ principalId: 'usrMember' }]) },
    user: {
      findMany: vi
        .fn()
        .mockResolvedValue([{ id: 'usrMember', name: 'Platform Member', avatar: null }]),
    },
  };
  const profiles = { resolve: vi.fn().mockResolvedValue({ ['appUser:apuDenied']: null }) };
  return { prisma, profiles, service: new RecordActorResolverService(prisma as never, profiles) };
};

describe('RecordActorResolverService presentation boundary', () => {
  it('Y4394 resolves only base/space collaborators and preserves denied App identity without PII', async () => {
    const { service, prisma, profiles } = setup();
    const result = await service.resolve('tblFixture', [
      { actorType: 'user', actorId: 'usrMember' },
      { actorType: 'user', actorId: 'usrOutside' },
      { actorType: 'appUser', actorId: 'apuDenied' },
      { actorType: 'appUser', actorId: 'apuDenied' },
      { actorType: null, actorId: null },
    ]);

    expect(result).toEqual({
      ['user:usrMember']: { name: 'Platform Member', avatar: null },
      ['user:usrOutside']: null,
      ['appUser:apuDenied']: null,
    });
    expect(prisma.collaborator.findMany).toHaveBeenCalledWith({
      where: {
        principalType: 'user',
        principalId: { in: ['usrMember', 'usrOutside'] },
        OR: [
          { resourceType: 'base', resourceId: 'bseFixture' },
          { resourceType: 'space', resourceId: 'spcFixture' },
        ],
      },
      select: { principalId: true },
    });
    expect(prisma.user.findMany).toHaveBeenCalledExactlyOnceWith({
      where: { id: { in: ['usrMember'] }, deletedTime: null },
      select: { id: true, name: true, avatar: true },
    });
    expect(profiles.resolve).toHaveBeenCalledExactlyOnceWith('bseFixture', [
      { type: 'appUser', id: 'apuDenied' },
    ]);
  });

  it('keeps old unattributed rows unknown even with a known technical executor', async () => {
    const { service, prisma, profiles } = setup();
    const oldRows = [{ actorType: null, actorId: null, createdBy: 'usrMember' }];

    expect(await service.resolve('tblFixture', oldRows)).toEqual({});
    expect(prisma.user.findMany).not.toHaveBeenCalled();
    expect(profiles.resolve).not.toHaveBeenCalled();
  });

  it('Y4393 preserves stable type/id as null display when a platform actor has been deleted', async () => {
    const { service, prisma } = setup();
    prisma.user.findMany.mockResolvedValueOnce([]);

    expect(
      await service.resolve('tblFixture', [{ actorType: 'user', actorId: 'usrMember' }])
    ).toEqual({ ['user:usrMember']: null });
  });
});
