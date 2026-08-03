import { ConfigService } from '@nestjs/config';
import type { TestingModule } from '@nestjs/testing';
import { Test } from '@nestjs/testing';
import { vi } from 'vitest';

type IMockConfigService = Partial<ConfigService>;

export const createMockConfigService = (
  mockValues: Record<string, unknown> = {}
): IMockConfigService => {
  return {
    get: vi.fn().mockImplementation((key: string) => mockValues[key]),
  };
};

describe('ConfigService', () => {
  let configService: ConfigService;

  beforeAll(async () => {
    const mockConfigService = createMockConfigService({ PORT: 3001 });

    const app: TestingModule = await Test.createTestingModule({
      providers: [
        {
          provide: ConfigService,
          useValue: mockConfigService,
        },
      ],
    }).compile();

    configService = app.get<ConfigService>(ConfigService);
  });

  it('should be defined', () => {
    expect(configService).toBeDefined();
  });

  it('should return port value', () => {
    expect(configService.get<number>('PORT')).toStrictEqual(3001);
  });
});
