/* eslint-disable @typescript-eslint/naming-convention */
import type { TestingModule } from '@nestjs/testing';
import { Test } from '@nestjs/testing';
import { FieldType } from '@teable-group/core';
import { plainToInstance } from 'class-transformer';
import { ShareDbService } from '../../../share-db/share-db.service';
import { TransactionService } from '../../../share-db/transaction.service';
import { FieldSupplementService } from '../field-supplement.service';
import { FieldService } from '../field.service';
import { LinkFieldDto } from '../model/field-dto/link-field.dto';
import { FieldOpenApiService } from './field-open-api.service';

describe('FieldOpenApiService', () => {
  let service: FieldOpenApiService;
  let shareDbService: ShareDbService;
  let transactionService: TransactionService;
  let fieldSupplementService: FieldSupplementService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        FieldOpenApiService,
        { provide: ShareDbService, useValue: {} }, // to be mocked
        { provide: TransactionService, useValue: {} }, // to be mocked
        { provide: FieldSupplementService, useValue: {} }, // to be mocked
        { provide: FieldService, useValue: {} }, // to be mocked
      ],
    }).compile();

    service = module.get<FieldOpenApiService>(FieldOpenApiService);
    shareDbService = module.get<ShareDbService>(ShareDbService);
    transactionService = module.get<TransactionService>(TransactionService);
    fieldSupplementService = module.get<FieldSupplementService>(FieldSupplementService);
  });

  it('should create a field', async () => {
    // setup mocks for dependencies
    transactionService.getTransaction = jest.fn().mockResolvedValue({
      /* mocked prisma instance */
    });
    fieldSupplementService.supplementByCreate = jest.fn().mockResolvedValue({
      /* mocked symmetricField instance */
    });
    fieldSupplementService.createReference = jest.fn().mockResolvedValue(undefined);
    const createDoc = jest.fn((_, __, ___, callback) => callback(null));
    shareDbService.connect = jest.fn().mockReturnValue({
      get: jest.fn().mockReturnValue({
        create: createDoc,
      }),
    });

    // invoke the method
    const tableId = 'someTableId';
    const fieldRaw = {
      type: FieldType.Link,
      options: {
        foreignTableId: 'foreignTable',
      },
    };
    await service.createField(tableId, plainToInstance(LinkFieldDto, fieldRaw));

    // verify the behaviors
    expect(transactionService.getTransaction).toHaveBeenCalled();
    expect(fieldSupplementService.supplementByCreate).toHaveBeenCalled();
    expect(fieldSupplementService.createReference).toHaveBeenCalled();
    expect(createDoc).toHaveBeenCalledTimes(2);
  });
});
