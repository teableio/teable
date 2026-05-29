import type { TestingModule } from '@nestjs/testing';
import { Test } from '@nestjs/testing';
import { GlobalModule } from '../../global/global.module';
import { TableModule } from './table.module';
import { TableService } from './table.service';

describe('TableService', () => {
  let service: TableService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      imports: [GlobalModule, TableModule],
    }).compile();

    service = module.get<TableService>(TableService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('should convert table name to valid db table name', () => {
    const dbTableName = service.generateValidName('!@#$1_a ha3ha 中文');
    expect(dbTableName).toBe('t1_a_ha3ha_Zhong_Wen');
  });

  it('should limit table name to 40', () => {
    const dbTableName = service.generateValidName('t'.repeat(50));
    expect(dbTableName).toBe('t'.repeat(40));
  });

  it('should convert chinese to pin yin', () => {
    const dbTableName = service.generateValidName('中文');
    expect(dbTableName).toBe('Zhong_Wen');
  });

  it('should convert empty table name unnamed', () => {
    const dbTableName = service.generateValidName('');
    expect(dbTableName).toBe('unnamed');
  });

  it('uses the routed data transaction client when creating a physical table', async () => {
    const dataTxClient = {
      $executeRawUnsafe: vi.fn().mockResolvedValue(0),
    };
    const dataRootClient = {
      txClient: vi.fn().mockReturnValue(dataTxClient),
      $executeRawUnsafe: vi.fn().mockResolvedValue(0),
    };
    const metaTxClient = {
      tableMeta: {
        findMany: vi.fn().mockResolvedValue([]),
        findFirst: vi.fn().mockResolvedValue(null),
        create: vi.fn().mockResolvedValue({ id: 'tblTest', dbTableName: 'bseTest.orders' }),
        update: vi.fn().mockResolvedValue(undefined),
      },
    };
    const mockedService = new TableService(
      { get: vi.fn().mockReturnValue('usrTest') } as never,
      { txClient: vi.fn().mockReturnValue(metaTxClient) } as never,
      { dataPrismaForBase: vi.fn().mockResolvedValue(dataRootClient) } as never,
      {} as never,
      {
        driver: 'sqlite',
        generateDbTableName: vi.fn((_baseId: string, name: string) => `bseTest.${name}`),
        dropTable: vi.fn((name: string) => `drop table ${name}`),
      } as never,
      {
        schema: {
          createTable: vi.fn().mockReturnValue({
            toSQL: () => [{ sql: 'create table "bseTest"."orders" ("__id" text)' }],
          }),
        },
      } as never
    );

    await (
      mockedService as unknown as {
        createDBTable(
          baseId: string,
          tableRo: { name: string },
          createTable?: boolean
        ): Promise<void>;
      }
    ).createDBTable('bseTest', { name: 'orders' });

    expect(dataRootClient.txClient).toHaveBeenCalled();
    expect(dataTxClient.$executeRawUnsafe).toHaveBeenCalledWith(
      'create table "bseTest"."orders" ("__id" text)'
    );
    expect(dataRootClient.$executeRawUnsafe).not.toHaveBeenCalled();
  });
});
