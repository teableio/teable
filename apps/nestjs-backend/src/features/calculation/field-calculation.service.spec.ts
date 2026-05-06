import type { TestingModule } from '@nestjs/testing';
import { Test } from '@nestjs/testing';
import { knex as createKnex } from 'knex';
import { GlobalModule } from '../../global/global.module';
import { CalculationModule } from './calculation.module';
import { FieldCalculationService } from './field-calculation.service';

describe('FieldCalculationService', () => {
  let service: FieldCalculationService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      imports: [GlobalModule, CalculationModule],
    }).compile();

    service = module.get<FieldCalculationService>(FieldCalculationService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('reads row counts from the data database', async () => {
    const metaQueryRawUnsafe = vi.fn();
    const dataQueryRawUnsafe = vi.fn().mockResolvedValue([{ count: 7n }]);
    const knex = createKnex({ client: 'pg' });
    const service = new FieldCalculationService(
      {
        txClient: () => ({ $queryRawUnsafe: metaQueryRawUnsafe }),
      } as never,
      {
        txClient: () => ({ $queryRawUnsafe: dataQueryRawUnsafe }),
      } as never,
      {} as never,
      {} as never,
      knex as never,
      { calcChunkSize: 100 } as never
    );

    await expect(service.getRowCount('bseTest.projects')).resolves.toBe(7);
    expect(dataQueryRawUnsafe).toHaveBeenCalledTimes(1);
    expect(metaQueryRawUnsafe).not.toHaveBeenCalled();
    await knex.destroy();
  });
});
