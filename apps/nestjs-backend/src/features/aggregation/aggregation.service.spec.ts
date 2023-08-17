import type { TestingModule } from '@nestjs/testing';
import { Test } from '@nestjs/testing';
import { TeableEventEmitterModule } from '../../event-emitter/event-emitter.module';
import { AggregationModule } from './aggregation.module';
import { AggregationService } from './aggregation.service';

describe('AggregateService', () => {
  let service: AggregationService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      imports: [AggregationModule, TeableEventEmitterModule.register()],
    }).compile();

    service = module.get<AggregationService>(AggregationService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
