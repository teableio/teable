import type { TestingModule } from '@nestjs/testing';
import { Test } from '@nestjs/testing';
import { ViewController } from './view.controller';

describe('ViewController', () => {
  let controller: ViewController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [ViewController],
    }).compile();

    controller = module.get<ViewController>(ViewController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
