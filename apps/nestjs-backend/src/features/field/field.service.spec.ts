import type { TestingModule } from '@nestjs/testing';
import { Test } from '@nestjs/testing';
import { PrismaService } from '@teable-group/db-main-prisma';
import { ClsService } from 'nestjs-cls';
import { FieldModule } from './field.module';
import { FieldService } from './field.service';

describe('FieldService', () => {
  let service: FieldService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      imports: [FieldModule],
    })
      .useMocker((token) => {
        if (token === PrismaService) {
          return jest.fn();
        }
        if (token === ClsService) {
          return jest.fn();
        }
      })
      .compile();

    service = module.get<FieldService>(FieldService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
