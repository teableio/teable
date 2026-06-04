import { HttpErrorCode } from '@teable/core';
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

describe('SpaceController data DB admin gate', () => {
  let controller: SpaceController;
  const dataDbPreflightService = {
    preflight: vi.fn(),
    getSummary: vi.fn(),
  };
  const dataDbBindingService = {
    updateBindingForSpace: vi.fn(),
  };
  const cls = {
    get: vi.fn().mockReturnValue('usrxxx'),
  };
  const spaceDataDbMigrationService = {
    cancelMigrationForSpace: vi.fn(),
    getMigrationJobStatus: vi.fn(),
    rollbackMigrationForSpace: vi.fn(),
  };

  beforeEach(() => {
    dataDbPreflightService.preflight.mockReset();
    dataDbPreflightService.getSummary.mockReset();
    dataDbBindingService.updateBindingForSpace.mockReset();
    cls.get.mockClear();
    spaceDataDbMigrationService.cancelMigrationForSpace.mockReset();
    spaceDataDbMigrationService.getMigrationJobStatus.mockReset();
    spaceDataDbMigrationService.rollbackMigrationForSpace.mockReset();
    controller = new SpaceController(
      {} as never,
      {} as never,
      {} as never,
      dataDbPreflightService as never,
      dataDbBindingService as never,
      cls as never,
      spaceDataDbMigrationService as never
    );
  });

  it('rejects migrate-space preflight requests from the non-admin space API', async () => {
    await expect(
      controller.preflightDataDb({
        url: 'postgresql://teable:secret@example.com:5432/teable_data',
        targetMode: 'migrate-space',
      })
    ).rejects.toMatchObject({
      code: HttpErrorCode.RESTRICTED_RESOURCE,
      data: { errorCode: 'SPACE_DATA_DB_ADMIN_ONLY' },
    });
    expect(dataDbPreflightService.preflight).not.toHaveBeenCalled();
  });

  it('rejects migrate-space updates from the non-admin space API', async () => {
    await expect(
      controller.updateSpaceDataDb('spcxxx', {
        url: 'postgresql://teable:secret@example.com:5432/teable_data',
        targetMode: 'migrate-space',
      })
    ).rejects.toMatchObject({
      code: HttpErrorCode.RESTRICTED_RESOURCE,
      data: { errorCode: 'SPACE_DATA_DB_ADMIN_ONLY' },
    });
    expect(dataDbBindingService.updateBindingForSpace).not.toHaveBeenCalled();
  });

  it('rejects migration job operations from the non-admin space API', async () => {
    await expect(controller.getSpaceDataDbMigration('spcxxx', 'sdmjxxx')).rejects.toMatchObject({
      code: HttpErrorCode.RESTRICTED_RESOURCE,
      data: { errorCode: 'SPACE_DATA_DB_ADMIN_ONLY' },
    });
    await expect(controller.cancelSpaceDataDbMigration('spcxxx', 'sdmjxxx')).rejects.toMatchObject({
      code: HttpErrorCode.RESTRICTED_RESOURCE,
      data: { errorCode: 'SPACE_DATA_DB_ADMIN_ONLY' },
    });
    await expect(
      controller.rollbackSpaceDataDbMigration('spcxxx', 'sdmjxxx')
    ).rejects.toMatchObject({
      code: HttpErrorCode.RESTRICTED_RESOURCE,
      data: { errorCode: 'SPACE_DATA_DB_ADMIN_ONLY' },
    });
    expect(spaceDataDbMigrationService.getMigrationJobStatus).not.toHaveBeenCalled();
    expect(spaceDataDbMigrationService.cancelMigrationForSpace).not.toHaveBeenCalled();
    expect(spaceDataDbMigrationService.rollbackMigrationForSpace).not.toHaveBeenCalled();
  });
});
