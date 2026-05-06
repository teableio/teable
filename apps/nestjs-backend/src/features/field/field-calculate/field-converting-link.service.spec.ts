import type { TestingModule } from '@nestjs/testing';
import { Test } from '@nestjs/testing';
import { GlobalModule } from '../../../global/global.module';
import { FieldOpenApiModule } from '../open-api/field-open-api.module';
import { FieldConvertingLinkService } from './field-converting-link.service';

describe('FieldConvertingLinkService', () => {
  let service: FieldConvertingLinkService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      imports: [GlobalModule, FieldOpenApiModule],
    }).compile();

    service = module.get<FieldConvertingLinkService>(FieldConvertingLinkService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('creates link storage objects in the data database', async () => {
    const metaExecuteRawUnsafe = vi.fn();
    const dataExecuteRawUnsafe = vi.fn().mockResolvedValue(undefined);
    const prismaService = {
      txClient: () => ({
        $executeRawUnsafe: metaExecuteRawUnsafe,
        tableMeta: {
          findMany: vi.fn().mockResolvedValue([
            { id: 'tblA', dbTableName: 'bseTest.table_a' },
            { id: 'tblB', dbTableName: 'bseTest.table_b' },
          ]),
        },
      }),
    };
    const dataPrismaService = {
      txClient: () => ({
        $executeRawUnsafe: dataExecuteRawUnsafe,
      }),
    };
    const dbProvider = {
      createColumnSchema: vi.fn().mockReturnValue(['create link storage']),
    };
    const tableDomainQueryService = {
      getTableDomainById: vi.fn().mockResolvedValue({}),
    };
    const service = new FieldConvertingLinkService(
      prismaService as never,
      dataPrismaService as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      dbProvider as never,
      tableDomainQueryService as never
    );

    await (
      service as unknown as {
        createForeignKeyUsingDbProvider: (tableId: string, field: unknown) => Promise<void>;
      }
    ).createForeignKeyUsingDbProvider('tblA', {
      options: { foreignTableId: 'tblB' },
    });

    expect(dataExecuteRawUnsafe).toHaveBeenCalledWith('create link storage');
    expect(metaExecuteRawUnsafe).not.toHaveBeenCalled();
  });
});
