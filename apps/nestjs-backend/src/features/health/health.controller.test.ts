import type { TestingModule } from '@nestjs/testing';
import { Test } from '@nestjs/testing';
import { HealthCheckService, PrismaHealthIndicator } from '@nestjs/terminus';
import { PrismaService } from '@teable/db-main-prisma';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { HealthController } from './health.controller';

describe('HealthController', () => {
  let controller: HealthController;
  const health = {
    check: vi.fn(),
  };
  const db = {
    pingCheck: vi.fn(),
  };
  const metaPrisma = {};

  beforeEach(async () => {
    health.check.mockReset();
    db.pingCheck.mockReset();
    health.check.mockResolvedValue({ status: 'ok' });
    db.pingCheck.mockResolvedValue({ status: 'up' });

    const module: TestingModule = await Test.createTestingModule({
      controllers: [HealthController],
      providers: [
        { provide: HealthCheckService, useValue: health },
        { provide: PrismaHealthIndicator, useValue: db },
        { provide: PrismaService, useValue: metaPrisma },
      ],
    }).compile();

    controller = module.get<HealthController>(HealthController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  it('checks the meta database without assuming a global data database', async () => {
    await controller.check();

    expect(health.check).toHaveBeenCalledTimes(1);

    const indicators = health.check.mock.calls[0][0] as Array<() => Promise<unknown>>;
    expect(indicators).toHaveLength(1);

    await indicators[0]();

    expect(db.pingCheck).toHaveBeenNthCalledWith(1, 'metaDatabase', metaPrisma);
  });
});
