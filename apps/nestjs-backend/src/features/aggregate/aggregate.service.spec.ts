import { EventEmitterModule } from '@nestjs/event-emitter';
import type { TestingModule } from '@nestjs/testing';
import { Test } from '@nestjs/testing';
import { AggregateModule } from './aggregate.module';
import { AggregateService } from './aggregate.service';

describe('AggregateService', () => {
  let service: AggregateService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      imports: [AggregateModule, EventEmitterModule.forRoot()],
    }).compile();

    service = module.get<AggregateService>(AggregateService);
  });

  it('test1', async () => {
    // expect(service).toBeDefined();
    const data = await service.calculateAggregates({
      tableId: 'tblUa0zJX7Qm3f5OJER',
    });

    console.log(JSON.stringify(data, null, 2));
  });
});
