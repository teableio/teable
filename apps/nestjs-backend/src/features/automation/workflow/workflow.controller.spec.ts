/* eslint-disable @typescript-eslint/no-explicit-any */
import { Test } from '@nestjs/testing';
import type { MockFunctionMetadata } from 'jest-mock';
import { ModuleMocker } from 'jest-mock';
import { WorkflowController } from './workflow.controller';

const moduleMocker = new ModuleMocker(global);

describe('WorkflowController', () => {
  let controller: WorkflowController;

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [WorkflowController],
    })
      .useMocker((token) => {
        if (typeof token === 'function') {
          const mockMetadata = moduleMocker.getMetadata(token) as MockFunctionMetadata<any, any>;
          const mock = moduleMocker.generateFromMetadata(mockMetadata);
          return new mock();
        }
      })
      .compile();

    controller = moduleRef.get<WorkflowController>(WorkflowController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
