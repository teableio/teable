/* eslint-disable @typescript-eslint/no-explicit-any */
import type { TestingModule } from '@nestjs/testing';
import { Test } from '@nestjs/testing';
import type { MockFunctionMetadata } from 'jest-mock';
import { ModuleMocker } from 'jest-mock';
import { RecordOpenApiController } from './record-open-api.controller';

const moduleMocker = new ModuleMocker(global);

describe('RecordOpenApiController', () => {
  let controller: RecordOpenApiController;

  beforeAll(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [RecordOpenApiController],
    })
      .useMocker((token) => {
        if (typeof token === 'function') {
          const mockMetadata = moduleMocker.getMetadata(token) as MockFunctionMetadata<any, any>;
          const mock = moduleMocker.generateFromMetadata(mockMetadata);
          return new mock();
        }
      })
      .compile();

    controller = module.get<RecordOpenApiController>(RecordOpenApiController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
