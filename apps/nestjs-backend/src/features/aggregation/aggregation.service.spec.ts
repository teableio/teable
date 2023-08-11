import { EventEmitterModule } from '@nestjs/event-emitter';
import type { TestingModule } from '@nestjs/testing';
import { Test } from '@nestjs/testing';
import { AggregationModule } from './aggregation.module';
import { AggregationService } from './aggregation.service';

describe('AggregateService', () => {
  let service: AggregationService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      imports: [AggregationModule, EventEmitterModule.forRoot()],
    }).compile();

    service = module.get<AggregationService>(AggregationService);
  });

  it('test1', async () => {
    // expect(service).toBeDefined();
    const data = await service.calculateAggregations({
      tableId: 'tblUa0zJX7Qm3f5OJER',
    });

    console.log(JSON.stringify(data, null, 2));
  });
});
