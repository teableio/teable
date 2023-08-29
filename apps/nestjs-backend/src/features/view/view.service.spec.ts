import type { TestingModule } from '@nestjs/testing';
import { Test } from '@nestjs/testing';
import { PrismaService } from '@teable-group/db-main-prisma';
import { ViewModule } from './view.module';
import { ViewService } from './view.service';

describe('ViewService', () => {
  let service: ViewService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      imports: [ViewModule],
    })
      .useMocker((token) => {
        if (token === PrismaService) {
          return jest.fn();
        }
      })
      .compile();

    service = module.get<ViewService>(ViewService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
