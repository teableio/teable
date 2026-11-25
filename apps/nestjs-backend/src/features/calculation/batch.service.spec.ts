import type { TestingModule } from '@nestjs/testing';
import { Test } from '@nestjs/testing';
import { IdPrefix } from '@teable/core';
import Knex from 'knex';
import { PostgresProvider } from '../../db-provider/postgres.provider';
import type { IDataPrismaQueryExecutor } from '../../global/database-router.service';
import { GlobalModule } from '../../global/global.module';
import { RawOpType } from '../../share-db/interface';
import { RawOpStagingService } from '../../share-db/raw-op-staging.service';
import { SchemaType } from '../field/util';
import { BatchService } from './batch.service';
import { CalculationModule } from './calculation.module';

describe('BatchService', () => {
  let service: BatchService;
  let module: TestingModule;

  beforeEach(async () => {
    module = await Test.createTestingModule({
      imports: [GlobalModule, CalculationModule],
    }).compile();

    service = module.get<BatchService>(BatchService);
  });

  afterEach(async () => {
    await module.close();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});

describe('RawOpStagingService', () => {
  it('keeps prepared audit operations out of document publication until explicitly published', () => {
    let pending: unknown[] = [];
    const freezeRecordEventContext = vi.fn();
    const cls = {
      getId: () => 'source',
      get: () => pending,
      set: (_key: string, value: unknown[]) => {
        pending = value;
      },
    };
    const service = new RawOpStagingService(cls as never, { freezeRecordEventContext } as never);
    const rawOps = service.saveRawOps(
      'tblAudit',
      RawOpType.Create,
      IdPrefix.Record,
      [{ docId: 'recAudit', version: 0 }],
      { publish: false }
    );
    expect(pending).toEqual([]);
    expect(freezeRecordEventContext).toHaveBeenCalledWith([rawOps]);
    service.publishRawOps(rawOps);
    expect(pending).toEqual([rawOps]);
    expect(pending[0]).toBe(rawOps);
  });
});

describe('BatchService transaction routing', () => {
  it('uses the supplied transaction for every temporary-table and row mutation without resolving a root client', async () => {
    const knex = Knex({ client: 'pg' });
    const execute = vi.fn().mockResolvedValue(1);
    const executor: IDataPrismaQueryExecutor = {
      $queryRawUnsafe: vi.fn(),
      $executeRawUnsafe: execute,
    };
    const resolveRoot = vi.fn(() => {
      throw new Error('Must not resolve a root client');
    });
    const service = Object.create(BatchService.prototype) as BatchService;
    Object.assign(service, {
      knex,
      dbProvider: new PostgresProvider(knex),
      prismaService: { txClient: resolveRoot },
      databaseRouter: { dataPrismaTransactionForTable: resolveRoot },
    });
    await service.batchUpdateDB(
      'base.actors',
      '__id',
      [
        { dbFieldName: 'text', schemaType: SchemaType.Text },
        { dbFieldName: '__last_modified_by_actor_id', schemaType: SchemaType.Text },
      ],
      [{ id: 'recActor', values: { text: 'after', __last_modified_by_actor_id: 'apuActor' } }],
      'tblActor',
      executor
    );
    expect(resolveRoot).not.toHaveBeenCalled();
    expect(execute).toHaveBeenCalledTimes(4);
    expect(execute.mock.calls.some(([sql]) => String(sql).includes('"base"."actors"'))).toBe(true);
    expect(
      execute.mock.calls.some(([sql]) => String(sql).includes('__last_modified_by_actor_id'))
    ).toBe(true);
    await knex.destroy();
  });
});
