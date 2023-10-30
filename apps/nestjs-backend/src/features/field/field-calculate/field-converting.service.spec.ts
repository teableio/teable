import type { TestingModule } from '@nestjs/testing';
import { Test } from '@nestjs/testing';
import { GlobalModule } from '../../../global/global.module';
import { FieldOpenApiModule } from '../open-api/field-open-api.module';
import { FieldConvertingService } from './field-converting.service';

describe('FieldConvertingService', () => {
  let service: FieldConvertingService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      imports: [GlobalModule, FieldOpenApiModule],
    }).compile();

    service = module.get<FieldConvertingService>(FieldConvertingService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('should return the correct changes', () => {
    expect(
      service['getOptionsChanges'](
        {
          formatting: 'italic',
          showAs: 'number',
          anotherKey: 'anotherKey',
        },
        {
          formatting: 'bold',
          showAs: 'text',
          otherKey: 'otherKey',
        }
      )
    ).toEqual({
      anotherKey: 'anotherKey',
      otherKey: null,
    });

    expect(
      service['getOptionsChanges'](
        {
          formatting: 'italic',
          showAs: 'number',
          anotherKey: 'anotherKey',
        },
        {
          formatting: 'bold',
          showAs: 'text',
          otherKey: 'otherKey',
        },
        true
      )
    ).toEqual({
      anotherKey: 'anotherKey',
      otherKey: null,
      formatting: null,
      showAs: null,
    });

    expect(
      service['getOptionsChanges'](
        {
          formatting: 'italic',
          showAs: 'number',
          otherKey: 'newOtherKey',
        },
        {
          formatting: 'bold',
          showAs: 'text',
          otherKey: 'oldOtherKey',
        }
      )
    ).toEqual({
      otherKey: 'newOtherKey',
    });
  });
});
