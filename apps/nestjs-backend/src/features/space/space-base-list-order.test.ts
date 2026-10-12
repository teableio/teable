import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SpaceController } from './space.controller';

vi.mock('@teable/db-main-prisma', () => ({
  MetaPrismaService: class MetaPrismaService {},
  Prisma: {},
  PrismaModule: class PrismaModule {},
  PrismaService: class PrismaService {},
  ProvisionState: {},
  getDatabaseUrl: vi.fn(),
}));
vi.mock('@teable/db-data-prisma', () => ({
  DataPrismaModule: class DataPrismaModule {},
  DataPrismaService: class DataPrismaService {},
  PrismaClient: class PrismaClient {},
  getMetaDatabaseUrl: vi.fn(),
}));
vi.mock('@prisma/client', () => ({
  Prisma: {},
  PrismaClient: class PrismaClient {},
}));
vi.mock('../invitation/invitation.service', () => ({
  InvitationService: class InvitationService {},
}));
vi.mock('../collaborator/collaborator.service', () => ({
  CollaboratorService: class CollaboratorService {},
}));
vi.mock('./data-db-binding.service', () => ({
  DataDbBindingService: class DataDbBindingService {},
}));
vi.mock('./data-db-preflight.service', () => ({
  DataDbPreflightService: class DataDbPreflightService {},
}));
vi.mock('./space-data-db-migration.service', () => ({
  SpaceDataDbMigrationService: class SpaceDataDbMigrationService {},
}));
vi.mock('./space.service', () => ({
  SpaceService: class SpaceService {},
}));

/**
 * A screen showing one space should not have to download every space to get its own
 * arrangement of projects, which is what it did while this route offered no `orderBy`.
 */
describe('one space’s project list', () => {
  let controller: SpaceController;
  const shared = [{ id: 'bse1' }, { id: 'bse2' }];
  const personal = [{ id: 'bse2' }, { id: 'bse1' }];
  const spaceService = { getBaseListBySpaceId: vi.fn() };
  const basePersonalOrderService = { sortForUser: vi.fn() };

  beforeEach(() => {
    spaceService.getBaseListBySpaceId.mockReset().mockResolvedValue(shared);
    basePersonalOrderService.sortForUser.mockReset().mockResolvedValue(personal);
    controller = new SpaceController(
      spaceService as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      basePersonalOrderService as never
    );
  });

  it('answers the space’s shared order by default', async () => {
    expect(await controller.getBaseList('spc1', {})).toBe(shared);
    expect(basePersonalOrderService.sortForUser).not.toHaveBeenCalled();
  });

  it('answers the caller’s own arrangement when asked for it', async () => {
    expect(await controller.getBaseList('spc1', { orderBy: 'personal' })).toBe(personal);
    // The same service `GET /base/access/all` sorts with — one arrangement, not two.
    expect(basePersonalOrderService.sortForUser).toHaveBeenCalledWith(shared);
  });

  it('asks only for the space it was given', async () => {
    await controller.getBaseList('spc1', { orderBy: 'personal' });
    expect(spaceService.getBaseListBySpaceId).toHaveBeenCalledWith('spc1');
  });
});
