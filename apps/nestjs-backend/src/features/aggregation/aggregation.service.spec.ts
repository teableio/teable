import type { TestingModule } from '@nestjs/testing';
import { Test } from '@nestjs/testing';
import { GlobalModule } from '../../global/global.module';
import { AggregationModule } from './aggregation.module';
import { AggregationService } from './aggregation.service';

describe('AggregateService', () => {
  let service: AggregationService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      imports: [GlobalModule, AggregationModule],
    }).compile();

    service = module.get<AggregationService>(AggregationService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('should execute row count SQL through the table scoped data database client', async () => {
    const queryRaw = vi.fn().mockResolvedValue([{ count: 7 }]);
    const databaseRouter = {
      queryDataPrismaForTable: queryRaw,
    };
    const recordPermissionService = {
      wrapView: vi.fn().mockResolvedValue({
        builder: {},
      }),
    };
    const recordQueryBuilder = {
      createRecordAggregateBuilder: vi.fn().mockResolvedValue({
        qb: {
          toQuery: () => 'SELECT COUNT(*)::int AS count FROM "bse1"."tbl1"',
        },
        alias: 'tbl1',
        selectionMap: {},
      }),
    };
    const service = new AggregationService(
      {} as never,
      {} as never,
      {} as never,
      databaseRouter as never,
      { queryBuilder: vi.fn().mockReturnValue({}) } as never,
      {} as never,
      {} as never,
      { get: vi.fn().mockReturnValue('usr1') } as never,
      recordPermissionService as never,
      recordQueryBuilder as never
    );

    const serviceInternals = service as unknown as {
      fetchStatisticsParams: () => Promise<unknown>;
      getDbTableName: () => Promise<string>;
    };
    vi.spyOn(serviceInternals, 'fetchStatisticsParams').mockResolvedValue({
      statisticsData: {},
      fieldInstanceMap: {},
    });
    vi.spyOn(serviceInternals, 'getDbTableName').mockResolvedValue('bse1.tbl1');

    const result = await service.performRowCount('tbl1', { viewId: 'viw1' });

    expect(result.rowCount).toBe(7);
    expect(queryRaw).toHaveBeenCalledWith(
      'tbl1',
      'SELECT COUNT(*)::int AS count FROM "bse1"."tbl1"'
    );
  });
});
